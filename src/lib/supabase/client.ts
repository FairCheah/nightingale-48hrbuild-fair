import { createBrowserClient } from '@supabase/ssr'

/**
 * Browser-side client. Uses the ANON key, so every query is
 * constrained by RLS. A patient using this can only reach their
 * own rows — enforced by the database, not by app logic.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}