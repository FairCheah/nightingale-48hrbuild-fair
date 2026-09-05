'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getGuestSession } from '@/lib/guest'
import { callLlm, parseJsonResponse, type LlmTurn } from '@/lib/llm'

/**
 * SEND TO CLINIC — brief §8.
 *
 * Persists a complete escalation: triggering message, triage summary,
 * profile snapshot, provenance pointers, and the acquisition context from §1.
 * The record must let a clinician begin a structured review without the
 * patient repeating their story.
 *
 * GUESTS MAY ESCALATE WITHOUT AN ACCOUNT. This departs from the brief's
 * implied order (auth -> consent -> intake -> escalate). Someone describing
 * heavy bleeding at 2am should not have to create an account before a nurse
 * can see it. The clinic receives the clinical content; it receives no way to
 * contact the person, and the confirmation says so plainly. Conversion is
 * offered AFTER the safety action, never as a toll gate in front of it.
 *
 * Everything in the payload is REDACTED text. A clinician who needs the raw
 * words can open the linked messages under their own RBAC role; the escalation
 * record itself carries no unredacted identifiers.
 */

const SUMMARY_SYSTEM = `You write a triage note for a nurse at a fertility and women's health clinic. You output JSON only.

Return exactly:
{"summary":["bullet","bullet"],"top_concern":"under 8 words"}

RULES
- Between 1 and 5 bullets. Fewer is better. Each under 20 words.
- Report only what the patient said, in the terms they used. This is stricter than it sounds:

  Do NOT add anatomical detail they did not give. "Bleeding heavily" stays "bleeding heavily" — not "vaginal bleeding" — even at a women's health clinic, even when the inference seems obvious. If the site is unstated, write "site not stated".

  Do NOT infer cause or effect between two facts. If they mention a symptom and separately mention stopping a medication, those are two facts, not one causal story. "Stopped Advil" does not become "Advil ineffective".

  Do NOT resolve ambiguity in the patient's favour or against it. Leave it ambiguous and say so.

  A nurse can ask the patient a question. She cannot un-read a detail you invented, and a plausible invention is more dangerous than an obvious one because nobody checks it.

- Never diagnose, never speculate on cause, never suggest management.
- Lead with the reason this was escalated.
- Include timeline and duration when the patient gave one.
- Note explicitly if something important is unknown, e.g. "Duration not stated".
- Write for a clinician skimming a queue: plain, specific, no padding.
- top_concern is a short label for a triage list, e.g. "Heavy bleeding, 2 days".

Identifiers appear as placeholders like [NAME_1]. Never include them.

Output JSON only. No code fences.`

interface SummaryOutput {
  summary: string[]
  top_concern: string
}

export async function sendToClinic() {
  const lead = await getGuestSession()
  if (!lead) return { error: 'expired' }

  const admin = createAdminClient()

  /**
   * The triggering message: the FIRST guest turn the risk gate flagged.
   *
   * If nothing was flagged, fall back to her most recent message. Brief §8
   * escalates on Med/High risk OR when the patient wants clarity or a human,
   * and only the first half was built here — so a person on a low-risk
   * conversation who asked for a nurse was told there was nothing to send.
   *
   * The nurse still sees the real risk level, which will read low. That is
   * accurate and useful: it distinguishes "the system flagged this" from
   * "she asked for us", and those deserve different attention.
   */
  const { data: flagged } = await admin
    .from('messages')
    .select('id, content, content_redacted, risk_level, risk_reason, created_at')
    .eq('lead_session_id', lead.id)
    .eq('sender', 'guest')
    .eq('escalation_required', true)
    /**
     * OLDEST flagged message, not newest.
     *
     * The intake questions mean she often answers two or three follow-ups
     * before pressing send, and those answers are flagged too. Taking the
     * newest put "yes, i have nausea and breast pain" at the top of the
     * queue - her answer to a question, with the question invisible, and
     * her actual concern nowhere on the card.
     *
     * The first flagged message is the one that brought her here. The
     * answers are in the summary and the profile, which is where a nurse
     * expects detail rather than a headline.
     */
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  let trigger = flagged

  if (!trigger) {
    const { data: latest } = await admin
      .from('messages')
      .select('id, content, content_redacted, risk_level, risk_reason, created_at')
      .eq('lead_session_id', lead.id)
      .eq('sender', 'guest')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    trigger = latest
  }

  if (!trigger) {
    return { error: 'Tell me a little about what is going on first.' }
  }

  // Refuse a duplicate: a second press should not create a second case.
  const { data: openCase } = await admin
    .from('escalations')
    .select('id')
    .eq('lead_session_id', lead.id)
    .in('status', ['pending', 'in_review'])
    .limit(1)
    .maybeSingle()

  if (openCase) {
    return { ok: true, alreadySent: true }
  }

  // Profile snapshot: the live facts, frozen at the moment of sending.
  // Stored as JSONB rather than a join, so the escalation still stands alone
  // after guest data is purged at 14 days.
  const { data: memoryRows } = await admin
    .from('memory_items')
    .select('id, kind, value, status, timeline, provenance_pointer')
    .eq('lead_session_id', lead.id)
    .order('created_at', { ascending: true })

  const items = memoryRows ?? []
  const supersededIds = new Set(
    items.map((i: { id: string }) => i.id).filter(() => false),
  )

  const { data: allRows } = await admin
    .from('memory_items')
    .select('supersedes')
    .eq('lead_session_id', lead.id)

  for (const row of allRows ?? []) {
    if (row.supersedes) supersededIds.add(row.supersedes)
  }

  const profileSnapshot = {
    captured_at: new Date().toISOString(),
    current: items.filter((i: { id: string }) => !supersededIds.has(i.id)),
    superseded: items.filter((i: { id: string }) => supersededIds.has(i.id)),
  }

  // Conversation for the summariser: redacted only.
  const { data: historyRows } = await admin
    .from('messages')
    .select('sender, content, content_redacted, created_at')
    .eq('lead_session_id', lead.id)
    .order('created_at', { ascending: false })
    .limit(12)

  const turns: LlmTurn[] = (historyRows ?? [])
    .reverse()
    .map((row: { sender: string; content: string; content_redacted: string | null }) => ({
      role: row.sender === 'ai' ? ('model' as const) : ('user' as const),
      text:
        row.sender === 'ai'
          ? (row.content ?? '')
          : (row.content_redacted ?? '[withheld]'),
    }))
    .filter((t: LlmTurn) => t.text.length > 0)

  while (turns.length > 0 && turns[0].role !== 'user') turns.shift()

  /**
   * The transcript is passed as ONE user turn, not as a conversation.
   *
   * Sending it as alternating turns invites the model to continue the chat
   * instead of summarising it — when the last turn was an assistant message,
   * Haiku produced the next reply rather than JSON. Flattening removes the
   * conversational shape entirely, so the only instruction in play is the
   * system prompt.
   */
  const transcript = turns
    .map((t) => `${t.role === 'model' ? 'NIGHTINGALE' : 'PATIENT'}: ${t.text}`)
    .join('\n\n')

  const raw = await callLlm({
    system: SUMMARY_SYSTEM,
    turns: [
      {
        role: 'user',
        text: `Summarise this conversation for the nurse.\n\n---\n${transcript}\n---\n\nReturn the JSON object now.`,
      },
    ],
    temperature: 0,
    maxOutputTokens: 600,
    timeoutMs: 20_000,
  })

  const parsed = parseJsonResponse<SummaryOutput>(raw)

  /**
   * If the summariser fails, the escalation still goes through. A nurse
   * reading the raw messages is far better than a patient told "try again
   * later" after asking for human help.
   */
  const bullets =
    parsed?.summary && Array.isArray(parsed.summary) && parsed.summary.length > 0
      ? parsed.summary.slice(0, 5).map((b) => String(b).slice(0, 160))
      : ['Automatic summary unavailable — please read the conversation directly.']

  const topConcern = parsed?.top_concern
    ? String(parsed.top_concern).slice(0, 80)
    : (trigger.risk_reason ?? 'Escalated by patient request')

  // Provenance: every id a clinician needs to reconstruct this record.
  const provenance = {
    triggering_message_id: trigger.id,
    lead_session_id: lead.id,
    memory_item_ids: items.map((i: { id: string }) => i.id),
    memory_provenance_pointers: items
      .map((i: { provenance_pointer: string | null }) => i.provenance_pointer)
      .filter(Boolean),
    risk_assessed_at: trigger.created_at,
    summary_generated: parsed !== null,
  }

  // Acquisition context from §1 — attribution surviving end to end.
  const acquisition = {
    source_channel: lead.source_channel,
    campaign_id: lead.campaign_id,
    creative: lead.creative,
    identity_level: lead.identity_level,
    referral_topic: lead.referral_topic,
    page_context: lead.page_context,
    landing_timestamp: lead.landing_timestamp,
  }

  /**
   * If this session has ALREADY converted, the escalation belongs to the
   * PatientSession as well as the LeadSession.
   *
   * This was missing, and it made half of escalations_read dead code. That
   * policy lets a patient read her own escalation via
   *   patient_sessions.id = escalations.patient_session_id
   * and the column was never written here, so the branch could not match for
   * anyone. A well-formed RLS policy that can never fire is scenario 20's
   * complaint in miniature: isolation that reads as enforced and is not.
   *
   * The opposite order is already handled — continue/actions.ts relinks
   * escalations at conversion for a guest who escalated first. The gap was a
   * patient who converts and THEN escalates: conversion had already run, so
   * nothing came back to fill it in.
   */
  const { data: patientSession } = await admin
    .from('patient_sessions')
    .select('id')
    .eq('lead_session_id', lead.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  const { data: escalation, error } = await admin
    .from('escalations')
    .insert({
      clinic_id: lead.clinic_id,
      lead_session_id: lead.id,
      patient_session_id: patientSession?.id ?? null,
      triggering_message_id: trigger.id,
      // Snapshot of the text, so the record survives message purging.
      triggering_message_text: trigger.content_redacted ?? '[withheld]',
      triage_summary: bullets.map((b) => `• ${b}`).join('\n'),
      profile_snapshot: profileSnapshot,
      acquisition_context: acquisition,
      provenance_points: provenance,
      risk_level_at_send: trigger.risk_level,
      status: 'pending',
      response_expectation: 'A nurse will review this within 12 to 18 hours.',
    })
    .select('id')
    .single()

  if (error || !escalation) {
    return { error: 'Could not send this to the clinic. Please try again.' }
  }

  await admin
    .from('lead_sessions')
    .update({
      top_concern: topConcern,
      last_active_at: new Date().toISOString(),
      // Asking for a human is consent to be read by one.
      staff_visible: true,
    })
    .eq('id', lead.id)

  /**
   * The confirmation used to tell her the clinic had no way to reply. That
   * was true until the nurse's reply started landing in her thread, and then
   * it was a lie the product told every escalating guest.
   *
   * It now says where the reply arrives, that she needs no account for it,
   * and that leaving a contact is optional. The offer comes after the safety
   * action, never as a toll gate in front of it.
   */
  const confirmation =
    'Sent. A nurse at Fairbloom now has this, and will review it within 12 to ' +
    '18 hours.\n\n' +
    'Their reply will appear here, in this conversation. You do not need an ' +
    'account for that, and you do not need to tell them who you are.\n\n' +
    'If you would rather they reached you directly, you can leave an email or ' +
    'a number below — but that is entirely up to you.\n\n' +
    'If anything changes or gets worse before then, please call 999 or go to a ' +
    'hospital emergency department. I am still here in the meantime.'

  await admin.from('messages').insert({
    lead_session_id: lead.id,
    sender: 'ai',
    content: confirmation,
    redaction_applied: false,
    risk_level: trigger.risk_level,
    risk_reason: 'escalation confirmation',
    confidence: 'high',
    risk_provenance: new Date().toISOString(),
    escalation_required: false,
  })

  await admin.from('events').insert({
    clinic_id: lead.clinic_id,
    lead_session_id: lead.id,
    event_type: 'escalation_sent',
    event_detail: {
      source_channel: lead.source_channel,
      risk_level: trigger.risk_level,
      identity_level: lead.identity_level,
    },
  })

  await admin.from('audit_logs').insert({
    actor_id: null,
    actor_role: 'guest',
    action: 'escalation.sent',
    resource_type: 'escalation',
    resource_id: escalation.id,
    metadata: {
      lead_session_id: lead.id,
      risk_level: trigger.risk_level,
      bullet_count: bullets.length,
      memory_item_count: items.length,
      summary_generated: parsed !== null,
    },
  })

  revalidatePath('/chat')
  return { ok: true }
}