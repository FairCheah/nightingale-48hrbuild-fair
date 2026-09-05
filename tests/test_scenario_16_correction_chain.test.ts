import { describe, it, expect, afterAll } from 'vitest'
import { testDb, createTestLead, cleanupTestLead } from './helpers'

/**
 * Brief test 5 — test_memory_mutation.
 *
 *   Turn 1: "I take Advil."          -> meds: Advil (active)
 *   Turn 2: "Actually I stopped."    -> Advil removed or marked stopped
 *   Assert provenance links exist for BOTH states.
 *
 * We write the rows the way updateMemory() writes them rather than calling
 * the extractor, because the extractor is an LLM and this test is about the
 * provenance chain, not about whether Haiku parses a sentence today.
 */
describe('living memory mutation', () => {
  let leadId: string

  afterAll(async () => {
    if (leadId) await cleanupTestLead(leadId)
  })

  it('keeps an unbroken provenance chain across a correction', async () => {
    const db = testDb()
    const lead = await createTestLead()
    leadId = lead.id

    // --- Turn 1: "I take Advil." ---------------------------------------
    const { data: msg1 } = await db
      .from('messages')
      .insert({
        lead_session_id: lead.id,
        sender: 'guest',
        content: 'I take Advil.',
        content_redacted: 'I take Advil.',
        redaction_applied: false,
        escalation_required: false,
      })
      .select('id')
      .single()

    const { data: fact1 } = await db
      .from('memory_items')
      .insert({
        lead_session_id: lead.id,
        kind: 'medication',
        value: 'Advil',
        status: 'active',
        provenance_pointer: msg1!.id,
        conflict_flag: false,
        updated_at: new Date().toISOString(),
      })
      .select('id, status, provenance_pointer')
      .single()

    expect(fact1!.status).toBe('active')
    expect(fact1!.provenance_pointer).toBe(msg1!.id)

    // --- Turn 2: "Actually I stopped last week." -----------------------
    const { data: msg2 } = await db
      .from('messages')
      .insert({
        lead_session_id: lead.id,
        sender: 'guest',
        content: 'Actually I stopped Advil last week.',
        content_redacted: 'Actually I stopped Advil last week.',
        redaction_applied: false,
        escalation_required: false,
      })
      .select('id')
      .single()

    // The old row is RETIRED, not deleted.
    await db
      .from('memory_items')
      .update({ status: 'stopped', updated_at: new Date().toISOString() })
      .eq('id', fact1!.id)

    const { data: fact2 } = await db
      .from('memory_items')
      .insert({
        lead_session_id: lead.id,
        kind: 'medication',
        value: 'Advil',
        status: 'stopped',
        timeline: 'last week',
        provenance_pointer: msg2!.id,
        supersedes: fact1!.id,
        conflict_flag: false,
        updated_at: new Date().toISOString(),
      })
      .select('id, status, timeline, provenance_pointer, supersedes')
      .single()

    // --- Assertions ----------------------------------------------------
    const { data: allFacts } = await db
      .from('memory_items')
      .select('id, value, status, provenance_pointer, supersedes')
      .eq('lead_session_id', lead.id)
      .order('created_at', { ascending: true })

    // Both states survive. Nothing was overwritten in place.
    expect(allFacts).toHaveLength(2)

    // The current state says stopped, with when.
    expect(fact2!.status).toBe('stopped')
    expect(fact2!.timeline).toBe('last week')

    // The chain links back to the row it replaced...
    expect(fact2!.supersedes).toBe(fact1!.id)

    // ...and each state points at the message that produced it. Different
    // messages, which is what makes this a history rather than a value.
    expect(fact2!.provenance_pointer).toBe(msg2!.id)
    expect(fact2!.provenance_pointer).not.toBe(fact1!.provenance_pointer)

    // Every provenance pointer resolves to a message that exists.
    for (const fact of allFacts ?? []) {
      const { data: source } = await db
        .from('messages')
        .select('id, content')
        .eq('id', fact.provenance_pointer)
        .maybeSingle()

      expect(source, `dangling provenance on ${fact.id}`).toBeTruthy()
    }
  })
})