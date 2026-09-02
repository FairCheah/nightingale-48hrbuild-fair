import { createAdminClient } from '@/lib/supabase/admin'
import { callLlm, parseJsonResponse } from '@/lib/llm'

/**
 * VALUE EVENTS — brief §2.
 *
 * A value_event is a turn where the system delivered substantive help. We
 * define and log two, both persisted with the query that produced them so a
 * reviewer can re-run the number and get the same answer.
 *
 * THE HONESTY RULE, stated plainly: a statistic shown to a prospect must
 * resolve to a live query on our own data. If the count is zero or trivial we
 * show nothing, or a truthful alternative. Never a fake number.
 *
 * This is not decoration. A clinic that inflates "14 people asked this week"
 * has taught the visitor that its numbers are marketing, which is exactly the
 * inference you do not want a patient making about a health service.
 */

export type ValueType =
  | 'articulation_card'
  | 'live_statistic'
  | 'service_answer'
  | 'question_prep'

/** Below this, a count is not evidence of anything. Show nothing instead. */
const MIN_MEANINGFUL_COUNT = 5

export interface LiveStatistic {
  text: string
  value: number
  query: string
  verifiedAt: string
}

/**
 * (B) THE HONEST STATISTIC.
 *
 * Counts distinct lead sessions that sent at least one message in the last
 * 7 days. Returns null when the number is too small to mean anything — the
 * caller then shows nothing, which is the truthful alternative.
 *
 * The SQL that produced the number is stored alongside it, so the claim is
 * checkable rather than asserted.
 */
export async function getWeeklyQuestionCount(
  clinicId: string | null,
): Promise<LiveStatistic | null> {
  if (!clinicId) return null

  const admin = createAdminClient()
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await admin
    .from('messages')
    .select('lead_session_id, lead_sessions!inner(clinic_id)')
    .eq('sender', 'guest')
    .gte('created_at', since)
    .eq('lead_sessions.clinic_id', clinicId)

  if (error || !data) return null

  const distinct = new Set(
    data.map((row: { lead_session_id: string | null }) => row.lead_session_id),
  )
  const count = distinct.size

  if (count < MIN_MEANINGFUL_COUNT) return null

  return {
    text: `${count} people asked Fairbloom a question this week.`,
    value: count,
    // Stored verbatim so the number can be independently re-run.
    query:
      'select count(distinct m.lead_session_id) from messages m ' +
      'join lead_sessions ls on ls.id = m.lead_session_id ' +
      `where m.sender = 'guest' and m.created_at >= now() - interval '7 days' ` +
      `and ls.clinic_id = '${clinicId}'`,
    verifiedAt: new Date().toISOString(),
  }
}

const ARTICULATION_SYSTEM = `You write a short message that someone can FORWARD to another person — a partner, a parent, a friend, an employer — to explain what they are going through, when saying it themselves is hard.

You output JSON only. Return exactly:
{"text":"the message, three short sentences","topic":"under 6 words"}

WHO IS WRITING AND WHO IS READING
The message is written in the FIRST PERSON, as if the person themselves wrote it. The reader is someone close to them who does not know yet.

You are not writing to the person. You are writing AS the person, for someone else's eyes.

WRONG (this is you talking to them):
"Trying for two years is hard to name, and you're right to seek help now."

RIGHT (this is them talking to someone else):
"I've been trying to get pregnant for two years and it hasn't happened. Most people conceive within a year, so after two years doctors say it's worth getting checked. I've booked to talk to someone about it."

STRUCTURE
1. What is happening, plainly, in their own words.
2. One fact that makes it legible to the reader — a prevalence figure, a typical timeline, or a correction of a common assumption. This is what stops the reply being "just relax" or "it'll happen".
3. What they are doing about it, or what they need from the reader.

HARD RULES
- Three short sentences. Roughly 35 words. It must be sendable as a text message.
- First person throughout. Never "you", never advice, never encouragement aimed at the sender.
- No diagnosis, no treatment advice, no dosing.
- Only broadly accepted facts. If unsure, use a softer general statement rather than inventing a statistic.
- No clinic name, no branding. Forwarding this must not reveal where it came from.
- Plain and unembarrassed. No emoji, no exclamation marks, no bravery language.

Identifiers appear as placeholders like [NAME_1]. Never include them.

Output JSON only. No code fences.`

interface ArticulationOutput {
  text: string
  topic: string
}

/**
 * (A) THE ARTICULATION CARD.
 *
 * Deliberately unbranded so it can be forwarded to a partner or a parent
 * without disclosing that the person contacted a fertility clinic. The
 * sharing is the value; the attribution would be the cost.
 */
export async function generateArticulationCard(
  redactedContext: string,
): Promise<{ text: string; topic: string } | null> {
  const raw = await callLlm({
    system: ARTICULATION_SYSTEM,
    turns: [
      {
        role: 'user',
        text: `Write the card for this person's situation.\n\n---\n${redactedContext}\n---\n\nReturn the JSON object now.`,
      },
    ],
    temperature: 0.6,
    maxOutputTokens: 400,
    timeoutMs: 15_000,
  })

  const parsed = parseJsonResponse<ArticulationOutput>(raw)
  if (!parsed?.text) return null

  const text = String(parsed.text).trim()

  /**
   * The 240 limit is ours to enforce; models cannot count characters. We
   * truncate at a sentence boundary rather than discarding, because a
   * slightly-long card is still useful and a missing card is not. Only a
   * wildly over-length response is rejected outright.
   */
  if (text.length > 600) return null

  if (text.length > 240) {
    const sentences = text.match(/[^.!?]+[.!?]+/g) ?? []
    let trimmed = ''
    for (const sentence of sentences) {
      if ((trimmed + sentence).length > 240) break
      trimmed += sentence
    }
    const final = trimmed.trim()
    if (final.length < 60) return null
    return { text: final, topic: String(parsed.topic ?? '').slice(0, 60) }
  }

  return { text, topic: String(parsed.topic ?? '').slice(0, 60) }
}

/**
 * Persist a value event. Statistics carry the query and the verification
 * timestamp; that pairing is what test_value_events asserts on.
 */
export async function recordValueEvent(params: {
  clinicId: string | null
  leadSessionId: string
  messageId?: string | null
  valueType: ValueType
  payload?: string | null
  stat?: LiveStatistic | null
}) {
  const admin = createAdminClient()

  const { data } = await admin
    .from('value_events')
    .insert({
      clinic_id: params.clinicId,
      lead_session_id: params.leadSessionId,
      message_id: params.messageId ?? null,
      value_type: params.valueType,
      payload: params.payload ?? null,
      stat_query: params.stat?.query ?? null,
      stat_value: params.stat?.value ?? null,
      stat_verified_at: params.stat?.verifiedAt ?? null,
      shared_publicly: false,
    })
    .select('id')
    .single()

  await admin.from('events').insert({
    clinic_id: params.clinicId,
    lead_session_id: params.leadSessionId,
    event_type: 'value_event',
    event_detail: {
      value_type: params.valueType,
      // The number is metadata, not clinical content — safe to log.
      stat_value: params.stat?.value ?? null,
    },
  })

  return data?.id ?? null
}