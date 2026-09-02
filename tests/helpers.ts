import { createClient } from '@supabase/supabase-js'

/**
 * Test database access.
 *
 * Uses the service role key, same as the application's admin client. These
 * tests verify what the server does, so they need the server's reach — the
 * RBAC test then proves the *client* path is properly constrained, which is
 * the assertion that actually matters.
 *
 * Every row created here carries a marker so a failed run leaves nothing a
 * later run could mistake for real traffic. Synthetic data only, per the brief.
 */
export const TEST_MARKER = 'vitest_synthetic'

export function testDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error(
      'Tests need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local',
    )
  }

  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export async function firstClinicId(): Promise<string | null> {
  const { data } = await testDb().from('clinics').select('id').limit(1).maybeSingle()
  return data?.id ?? null
}

/** Create a lead session for a test to work against. */
export async function createTestLead(overrides: Record<string, unknown> = {}) {
  const { data, error } = await testDb()
    .from('lead_sessions')
    .insert({
      clinic_id: await firstClinicId(),
      source_channel: 'website_widget',
      identity_level: 'anonymous',
      campaign_id: TEST_MARKER,
      ...overrides,
    })
    .select('id, recovery_token, source_channel, campaign_id, identity_level')
    .single()

  if (error) throw error
  return data
}

/**
 * Remove everything a test created. Deletes children before parents so no
 * foreign key blocks the cleanup.
 */
export async function cleanupTestLead(leadSessionId: string) {
  const db = testDb()

  await db.from('citations').delete().in(
    'message_id',
    (
      await db.from('messages').select('id').eq('lead_session_id', leadSessionId)
    ).data?.map((m) => m.id) ?? ['none'],
  )

  await db.from('value_events').delete().eq('lead_session_id', leadSessionId)
  await db.from('escalations').delete().eq('lead_session_id', leadSessionId)
  await db.from('memory_items').delete().eq('lead_session_id', leadSessionId)
  await db.from('messages').delete().eq('lead_session_id', leadSessionId)
  await db.from('events').delete().eq('lead_session_id', leadSessionId)
  await db.from('patient_sessions').delete().eq('lead_session_id', leadSessionId)
  await db.from('audit_logs').delete().eq('resource_id', leadSessionId)
  await db.from('lead_sessions').delete().eq('id', leadSessionId)
}