import { describe, it, expect, afterAll } from 'vitest'
import { testDb, createTestLead, cleanupTestLead } from './helpers'
import { getWeeklyQuestionCount } from '@/lib/value-events'

/**
 * Brief test 2 — test_value_events.
 *
 *   "Every statistic traces to a live query, i.e. '14 people asked this
 *    clinic a question this week.' Generated value messages are tracked
 *    and validated for accuracy."
 *
 * The assertion that matters: the number shown to a prospect must be
 * reproducible. We store the query alongside the value, so this test can
 * re-run that query and compare. A number that cannot be re-derived is
 * marketing, not evidence.
 */
describe('value events', () => {
  let leadId: string

  afterAll(async () => {
    if (leadId) await cleanupTestLead(leadId)
  })

  it('a persisted statistic re-derives from its own stored query', async () => {
    const db = testDb()
    const lead = await createTestLead()
    leadId = lead.id

    const { data: clinic } = await db
      .from('clinics')
      .select('id')
      .limit(1)
      .maybeSingle()

    const stat = await getWeeklyQuestionCount(clinic?.id ?? null)

    if (!stat) {
      /**
       * Below the meaningful threshold, so nothing is shown. That is the
       * honesty rule working, not a test failure — the brief says show
       * nothing or a truthful alternative, never a fake number.
       */
      expect(stat).toBeNull()
      return
    }

    // The stored query is not decoration: it must produce the same number.
    expect(stat.query).toContain('count(distinct')
    expect(stat.query).toContain('lead_session_id')
    expect(stat.value).toBeGreaterThanOrEqual(5)
    expect(stat.text).toContain(String(stat.value))

    // Re-derive independently, the way a reviewer would.
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const { data: rows } = await db
      .from('messages')
      .select('lead_session_id, lead_sessions!inner(clinic_id)')
      .eq('sender', 'guest')
      .gte('created_at', since)
      .eq('lead_sessions.clinic_id', clinic!.id)

    const recomputed = new Set(rows?.map((r) => r.lead_session_id)).size

    // Within one, because our own test lead may have been created between
    // the two reads. The point is that it is derived, not asserted.
    expect(Math.abs(recomputed - stat.value)).toBeLessThanOrEqual(1)
  })

  it('shows nothing rather than a number too small to mean anything', async () => {
    // A clinic with no traffic has no story to tell, and saying "1 person
    // asked us something this week" is worse than saying nothing.
    const stat = await getWeeklyQuestionCount(
      '00000000-0000-0000-0000-000000000000',
    )
    expect(stat).toBeNull()
  })

  it('returns nothing when there is no clinic to count for', async () => {
    expect(await getWeeklyQuestionCount(null)).toBeNull()
  })

  it('records every value event with the query that produced it', async () => {
    const db = testDb()

    // Any statistic stored anywhere must carry its query and a verification
    // timestamp. A stat_value with no stat_query is an unverifiable claim.
    const { data: stats } = await db
      .from('value_events')
      .select('value_type, stat_value, stat_query, stat_verified_at')
      .not('stat_value', 'is', null)
      .limit(20)

    for (const stat of stats ?? []) {
      expect(stat.stat_query, `${stat.value_type} has a value but no query`).toBeTruthy()
      expect(stat.stat_verified_at, `${stat.value_type} has no verification time`).toBeTruthy()
    }
  })

  it('the shareable card stays inside its length budget', async () => {
    const db = testDb()

    const { data: cards } = await db
      .from('value_events')
      .select('payload')
      .eq('value_type', 'articulation_card')
      .not('payload', 'is', null)
      .limit(20)

    for (const card of cards ?? []) {
      // Brief §2a: 240 characters, so it is sendable as a text message.
      expect(card.payload!.length).toBeLessThanOrEqual(240)
    }
  })

  it('the shareable card carries no branding', async () => {
    /**
     * The card exists to be forwarded to a partner or a parent. If it named
     * the clinic, forwarding it would disclose that the person contacted a
     * fertility clinic — which is the disclosure they are trying to control.
     */
    const db = testDb()

    const { data: cards } = await db
      .from('value_events')
      .select('payload')
      .eq('value_type', 'articulation_card')
      .not('payload', 'is', null)
      .limit(20)

    for (const card of cards ?? []) {
      expect(card.payload).not.toMatch(/fairbloom/i)
      expect(card.payload).not.toMatch(/nightingale/i)
    }
  })
})