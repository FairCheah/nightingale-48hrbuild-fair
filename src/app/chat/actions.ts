'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getGuestSession, checkRateLimit } from '@/lib/guest'

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
 *   4. redact                   <- STEP 2 of the build, not yet wired
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

  // 3. Persist what the guest actually said.
  //    content_redacted stays null until the redaction pipeline lands;
  //    redaction_applied is false so we can never mistake an unredacted
  //    row for a redacted one.
  const { data: guestMessage, error: insertError } = await admin
    .from('messages')
    .insert({
      lead_session_id: lead.id,
      sender: 'guest',
      content: text,
      redaction_applied: false,
      escalation_required: false,
    })
    .select('id')
    .single()

  if (insertError || !guestMessage) {
    return { error: 'Something went wrong saving your message. Please try again.' }
  }

  // 4-6. Redaction, risk gating and the LLM reply land here next.
  //      Until then the assistant is honest about being incomplete rather
  //      than improvising clinical-sounding text.
  const reply =
    'Thanks for telling me that. My conversational replies are still being ' +
    'connected — for now I am recording what you say so nothing gets lost. ' +
    'If anything feels urgent, please use the emergency guidance below.'

  const { data: aiMessage } = await admin
    .from('messages')
    .insert({
      lead_session_id: lead.id,
      sender: 'ai',
      content: reply,
      redaction_applied: false,
      risk_level: 'low',
      risk_reason: 'placeholder reply; risk gating not yet wired',
      confidence: 'low',
      risk_provenance: now.toISOString(),
      escalation_required: false,
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
      reply_id: aiMessage?.id ?? null,
    },
  })

  revalidatePath('/chat')
  return { ok: true }
}