import { createClient as createSupabaseClient } from '@supabase/supabase-js'

/**
 * PRIVILEGED, SERVER-ONLY client. Uses the SERVICE ROLE key and
 * BYPASSES all RLS policies.
 *
 * Used only for:
 *   - guest (LeadSession) flows, where no authenticated user exists
 *   - writing messages after PHI redaction + risk gating
 *   - audit log writes
 *
 * Every call site must perform its own authorisation check.
 * The runtime guard makes accidental browser use fail loudly.
 */
export function createAdminClient() {
  if (typeof window !== 'undefined') {
    throw new Error('createAdminClient must never be called in the browser')
  }

  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}