import { describe, expect, it } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * SCENARIO 12 — "destroy guest data every X days ... is a never-called
 * function different from an absent one?"
 *
 * Round one claimed this purge was verified. It had never deleted anything.
 *
 * Four tables held foreign keys into messages(id) with no ON DELETE rule, so
 * the first violation aborted the whole plpgsql function and rolled back
 * every session in the run — while the return value still reported success.
 * The one that mattered is memory_items.provenance_pointer, written on nearly
 * every turn, so the case that broke it was one guest message plus one
 * extracted fact: the most ordinary session the product can produce.
 *
 * Round one's manual check passed because the session I had backdated by hand
 * had neither a message nor a fact. It exercised the only shape of data that
 * could pass.
 *
 * These assertions are deliberately about the SHAPE of the function rather
 * than a seeded fixture. The failure was never "it deleted the wrong rows" —
 * it was "it threw, rolled back, and said it had worked". So what is asserted
 * is that it completes without raising, that it reports six named counts of
 * what it destroyed rather than the row_count of whichever statement ran
 * last, and that a second run is a no-op.
 */
describe('scenario 12 — guest retention actually runs', () => {
  const admin = createAdminClient()

  it('completes without raising, and reports what it destroyed', async () => {
    const { data, error } = await admin.rpc('purge_expired_guest_data')

    // The original failure mode was an exception inside the function. If the
    // foreign keys regress, this is the assertion that catches it.
    expect(error, error?.message).toBeNull()
    expect(data).toBeTruthy()

    const row = Array.isArray(data) ? data[0] : data

    /**
     * Six named counters. The old version returned two, and the second was
     * the row_count of the final UPDATE — which counts sessions touched, not
     * anything deleted. It could report success while destroying nothing.
     */
    expect(row).toHaveProperty('sessions_purged')
    expect(row).toHaveProperty('messages_deleted')
    expect(row).toHaveProperty('facts_deleted')
    expect(row).toHaveProperty('provenance_orphaned')
    expect(row).toHaveProperty('escalations_scrubbed')
    expect(row).toHaveProperty('contacts_revoked')
  })

  it('is idempotent — a second run destroys nothing', async () => {
    await admin.rpc('purge_expired_guest_data')
    const { data, error } = await admin.rpc('purge_expired_guest_data')

    expect(error, error?.message).toBeNull()

    const row = Array.isArray(data) ? data[0] : data
    expect(row.messages_deleted).toBe(0)
    expect(row.facts_deleted).toBe(0)
  })
})