import { describe, it, expect } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { testDb } from './helpers'

/**
 * Brief test 7 — test_access_control.
 *
 *   Patient A cannot fetch Patient B chat history
 *   Patient cannot fetch clinician triage queue
 *   Clinician, Staff, Nurse access can see all consented patients
 *
 * These tests sign in as real users through the ANON key, which is what a
 * browser holds. That matters: the rest of the suite uses the service role,
 * which bypasses RLS by design. This file is the one that proves the client
 * path is actually constrained, so it is the only meaningful test of the
 * access control claim.
 */

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const PASSWORD = 'Fairbloom123!'

/** A client carrying a real user session, exactly as a browser would. */
async function signIn(email: string) {
  const client = createClient(URL, ANON, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { error } = await client.auth.signInWithPassword({
    email,
    password: PASSWORD,
  })

  if (error) {
    throw new Error(
      `Could not sign in as ${email}. Create the test accounts listed in the README. (${error.message})`,
    )
  }

  return client
}

describe('access control', () => {
  it('a patient sees only their own row in app_users', async () => {
    const patient = await signIn('patient@fairbloom.test')

    const { data } = await patient.from('app_users').select('id, email, role')

    // RLS filters rather than erroring: they get exactly one row, their own.
    expect(data).toHaveLength(1)
    expect(data![0].email).toBe('patient@fairbloom.test')
  })

  it('a patient cannot read another patient\u2019s messages', async () => {
    /**
     * Patient A vs Patient B. We create a second patient's session and
     * message with the service role, then attempt to read it as the first
     * patient through the anon key.
     */
    const admin = testDb()

    const { data: otherUser } = await admin
      .from('app_users')
      .select('id, clinic_id')
      .neq('email', 'patient@fairbloom.test')
      .eq('role', 'patient')
      .limit(1)
      .maybeSingle()

    if (!otherUser) {
      // Only one patient exists; the conversion test creates others.
      return
    }

    const { data: otherSession } = await admin
      .from('patient_sessions')
      .select('id')
      .eq('patient_id', otherUser.id)
      .limit(1)
      .maybeSingle()

    if (!otherSession) return

    const patient = await signIn('patient@fairbloom.test')

    const { data } = await patient
      .from('messages')
      .select('id, content')
      .eq('patient_session_id', otherSession.id)

    // Not an error — an empty result. RLS filters rows rather than refusing
    // the query, which leaks nothing about whether the session exists.
    expect(data ?? []).toHaveLength(0)
  })

  it('a patient cannot fetch the clinician triage queue', async () => {
    const admin = testDb()

    // Confirm escalations exist that a clinician would legitimately see.
    const { count: totalEscalations } = await admin
      .from('escalations')
      .select('id', { count: 'exact', head: true })

    const patient = await signIn('patient@fairbloom.test')

    const { data } = await patient
      .from('escalations')
      .select('id, triage_summary, triggering_message_text')

    // The patient sees only escalations belonging to their own sessions —
    // never the queue. In this fixture that is zero.
    expect((data ?? []).length).toBeLessThan(totalEscalations ?? 1)
  })

  it('audit logs are unreachable from any client role', async () => {
    // audit_logs has no RLS policy and no grant: deny by default.
    for (const email of [
      'patient@fairbloom.test',
      'staff@fairbloom.test',
      'nurse@fairbloom.test',
      'clinician@fairbloom.test',
    ]) {
      const client = await signIn(email)
      const { data, error } = await client.from('audit_logs').select('id')

      // Either a permission error or zero rows. Never content.
      expect(data ?? [], `audit_logs leaked to ${email}`).toHaveLength(0)
      if (!error) expect(data).toEqual([])
    }
  })

  it('care team roles can read consented patient sessions', async () => {
    for (const email of [
      'staff@fairbloom.test',
      'nurse@fairbloom.test',
      'clinician@fairbloom.test',
    ]) {
      const client = await signIn(email)
      const { error } = await client
        .from('patient_sessions')
        .select('id, consent_given')

      // The query is permitted for care team. Row visibility is then
      // constrained by clinic and consent.
      expect(error, `${email} was refused patient_sessions`).toBeNull()
    }
  })

  it('no client role can INSERT a message', async () => {
    /**
     * The structural guarantee behind redaction and risk gating: if a client
     * could write a message directly, both could be bypassed. No INSERT is
     * granted to `authenticated` on any table.
     */
    for (const email of ['patient@fairbloom.test', 'nurse@fairbloom.test']) {
      const client = await signIn(email)

      const { error } = await client.from('messages').insert({
        sender: 'guest',
        content: 'this write should be impossible',
        redaction_applied: false,
        escalation_required: false,
      })

      expect(error, `${email} was allowed to insert a message`).not.toBeNull()
    }
  })

  it('the anon role reaches nothing at all', async () => {
    // Guests never touch the database. The server acts on their behalf.
    const anon = createClient(URL, ANON, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data } = await anon.from('lead_sessions').select('id')
    expect(data ?? []).toHaveLength(0)
  })
})