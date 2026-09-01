import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/**
 * Server-side client bound to the caller's session cookie.
 * Still uses the ANON key, so RLS applies — this is NOT a bypass.
 * Use inside server components and route handlers to read data
 * as the logged-in user.
 */
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Called from a Server Component; middleware refreshes
            // the session, so this is safe to ignore.
          }
        },
      },
    }
  )
}