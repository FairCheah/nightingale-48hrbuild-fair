import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

/**
 * Signs the current user out and returns to the login page.
 * Needed for testing role separation without clearing cookies by hand.
 */
export async function GET(request: Request) {
  const supabase = await createClient()
  await supabase.auth.signOut()

  const url = new URL('/login', request.url)
  return NextResponse.redirect(url)
}