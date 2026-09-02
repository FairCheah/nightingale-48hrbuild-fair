'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getGuestSession, checkRateLimit } from '@/lib/guest'
import { safeRedact } from '@/lib/redaction'
import { assessKeywordRisk, EMERGENCY_SCRIPTS } from '@/lib/risk'

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

  // 5. RISK GATE — computed on the raw text, before any reply exists.
  //    Keyword floor only for now; the LLM classifier joins via combineRisk()
  //    in the next step and may only ever raise this level, never lower it.
  const risk = assessKeywordRisk(text)

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
    reply =
      'Thanks for telling me that. My conversational replies are still being ' +
      'connected — for now I am recording what you say so nothing gets lost. ' +
      'If anything feels urgent, please use the emergency guidance below.'
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
      reply_id: aiMessage?.id ?? null,
    },
  })

  revalidatePath('/chat')
  return { ok: true }
}