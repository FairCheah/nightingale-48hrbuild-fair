'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getGuestSession, checkRateLimit } from '@/lib/guest'
import { safeRedact } from '@/lib/redaction'
import { assessKeywordRisk, combineRisk, EMERGENCY_SCRIPTS } from '@/lib/risk'
import { classifyRisk, generateReply } from '@/lib/nightingale-ai'
import type { LlmTurn } from '@/lib/llm'

/**
 * SEND MESSAGE — the single write path for guest conversation.
 *
 * Everything funnels through this one server action, deliberately.
 * No INSERT is granted to the client, so PHI redaction and risk gating
 * cannot be bypassed by anyone talking to the API directly.
 *
 * Order of operations is fixed and will not change as features land:
 *   1. authorise (valid guest session)
 *   2. rate limit
 *   3. persist the raw message  <- encrypted at rest by Postgres
 *   4. redact                   <- DONE: src/lib/redaction.ts, fails closed
 *   5. risk gate                <- STEP 3, runs BEFORE any reply exists
 *   6. generate reply           <- STEP 4, only reached if risk is low
 *   7. persist reply + audit
 */

const MAX_MESSAGE_LENGTH = 2000

export async function sendGuestMessage(content: string) {
  const text = content.trim()

  if (!text) return { error: 'Please type a message.' }
  if (text.length > MAX_MESSAGE_LENGTH) {
    return { error: 'That message is a little long — could you shorten it?' }
  }

  const lead = await getGuestSession()
  if (!lead) {
    return { error: 'expired' }
  }

  const now = new Date()
  const { allowed, count } = checkRateLimit(lead, now)

  if (!allowed) {
    return {
      error:
        'You are sending messages very quickly. Please wait a moment and try again.',
    }
  }

  const admin = createAdminClient()

  // 4. Redact BEFORE anything leaves this server. safeRedact fails closed:
  //    if the pipeline throws, the model receives a withheld marker rather
  //    than raw text. Storing both columns is deliberate — the patient sees
  //    their own words, the model only ever sees content_redacted.
  const redaction = safeRedact(text)

  const { data: guestMessage, error: insertError } = await admin
    .from('messages')
    .insert({
      lead_session_id: lead.id,
      sender: 'guest',
      content: text,
      content_redacted: redaction.redacted,
      redaction_applied: redaction.applied,
      escalation_required: false,
    })
    .select('id')
    .single()

  if (insertError || !guestMessage) {
    return { error: 'Something went wrong saving your message. Please try again.' }
  }

  // 5. RISK GATE — before any reply exists.
  //
  //    Layer 1 runs on the RAW text: keyword matching is local, instant, and
  //    placeholders must not break a phrase match.
  //    Layer 2 sends only REDACTED text to the model.
  //    combineRisk() takes the higher of the two — the model can raise the
  //    floor but never lower it, and a null (timeout, outage, bad JSON)
  //    leaves the keyword verdict standing.
  const keywordRisk = assessKeywordRisk(text)

  const history = await loadRedactedHistory(admin, lead.id, redaction.redacted)

  const llmRisk = await classifyRisk(history)
  const risk = combineRisk(keywordRisk, llmRisk)

  // The risk verdict is stamped on the GUEST message, because it describes
  // what the patient said. This is what test_risk_escalation asserts on.
  await admin
    .from('messages')
    .update({
      risk_level: risk.level,
      risk_reason: risk.reason,
      confidence: risk.confidence,
      risk_provenance: risk.assessedAt,
      escalation_required: risk.escalationRequired,
    })
    .eq('id', guestMessage.id)

  // 6. REPLY. On high risk the AI stops: no education, no reassurance, no
  //    hedging — only the script for that emergency kind. Brief §6 forbids
  //    advice and false reassurance once risk is high.
  let reply: string

  if (risk.level === 'high' && risk.emergencyKind) {
    reply = EMERGENCY_SCRIPTS[risk.emergencyKind].body
  } else if (risk.level === 'med') {
    const honest =
      'Thank you for telling me — I want to be honest with you rather than guess. ' +
      'What you have described could mean several different things, and I am not ' +
      'able to tell you which without a clinician looking at it properly.\n\n'

    if (risk.scope === 'out_of_scope') {
      // We will not imply a safety net we cannot provide. Naming our own
      // limits is safer than a referral that delays real care.
      reply =
        honest +
        'I should be straight with you about one thing: Fairbloom is a fertility ' +
        'and women\u2019s health clinic, so this is not something our nurses can assess. ' +
        'Please see a GP, or go to a hospital emergency department if it worsens or ' +
        'you feel unwell with it.\n\n' +
        'I am still here if you have questions about anything we do cover.'
    } else if (risk.scope === 'unclear') {
      reply =
        honest +
        'If this is related to your periods, pregnancy, fertility or sexual health, ' +
        'I can pass it to a nurse at Fairbloom. If it is something else, a GP or an ' +
        'emergency department is the better place. Which sounds closer?'
    } else {
      reply =
        honest +
        'This is something Fairbloom can help with. I would rather pass it to a nurse ' +
        'here than give you an answer that sounds confident and turns out to be wrong. ' +
        'Would you like me to?'
    }
  } else {
    const generated = await generateReply(history, {
      referralTopic: lead.referral_topic,
    })

    // Honest degradation. If the model is down we say so rather than
    // improvising clinical-sounding text from a template.
    reply =
      generated ??
      'I am having trouble reaching my language service just now, so I would ' +
        'rather not guess at an answer. Your message is saved. Please try ' +
        'again in a moment, or I can pass this to the clinic for you.'
  }

  const { data: aiMessage } = await admin
    .from('messages')
    .insert({
      lead_session_id: lead.id,
      sender: 'ai',
      content: reply,
      redaction_applied: false,
      risk_level: risk.level,
      risk_reason: risk.reason,
      // On a scripted emergency response we are highly confident, because we
      // wrote it. On the low-risk placeholder we are not.
      confidence: risk.level === 'low' ? 'low' : 'high',
      risk_provenance: risk.assessedAt,
      escalation_required: risk.escalationRequired,
    })
    .select('id')
    .single()

  // 7. Counters + audit. Metadata only — never the message text.
  await admin
    .from('lead_sessions')
    .update({
      last_active_at: now.toISOString(),
      last_request_at: now.toISOString(),
      request_count: count,
    })
    .eq('id', lead.id)

  await admin.from('audit_logs').insert({
    actor_id: null,
    actor_role: 'guest',
    action: 'message.created',
    resource_type: 'message',
    resource_id: guestMessage.id,
    metadata: {
      lead_session_id: lead.id,
      source_channel: lead.source_channel,
      content_length: text.length,
      redaction_applied: redaction.applied,
      // Counts only, e.g. { ic: 1, name: 1 }. Never the values.
      redacted_kinds: redaction.summary,
            risk_level: risk.level,
      risk_matched: risk.matched,
      risk_source: risk.source,
      llm_classifier_available: llmRisk !== null,
      reply_id: aiMessage?.id ?? null,
    },
  })

  revalidatePath('/chat')
  return { ok: true }
}

/**
 * Build the model's view of the conversation: REDACTED text only, ever.
 *
 * The last ~10 turns are included because crisis frequently develops across
 * messages rather than appearing in one — the classifier needs trajectory,
 * not a single line. The message just written is appended from memory since
 * the row may not have replicated yet.
 */
async function loadRedactedHistory(
  admin: ReturnType<typeof createAdminClient>,
  leadSessionId: string,
  latestRedacted: string,
): Promise<LlmTurn[]> {
  const { data } = await admin
    .from('messages')
    .select('sender, content, content_redacted, created_at')
    .eq('lead_session_id', leadSessionId)
    .order('created_at', { ascending: false })
    .limit(11)

  const rows = (data ?? []).reverse()

  const turns: LlmTurn[] = rows
    // Drop the row we just inserted; it is appended below from memory.
    .slice(0, -1)
    .map((row) => ({
      role: row.sender === 'ai' ? ('model' as const) : ('user' as const),
      // Guest text uses the redacted column. Assistant text was never PHI.
      text:
        row.sender === 'ai'
          ? (row.content ?? '')
          : (row.content_redacted ?? '[withheld]'),
    }))
    .filter((turn) => turn.text.length > 0)

  turns.push({ role: 'user', text: latestRedacted })

  // Gemini rejects a history that does not start with a user turn.
  while (turns.length > 0 && turns[0].role !== 'user') turns.shift()

  return turns
}