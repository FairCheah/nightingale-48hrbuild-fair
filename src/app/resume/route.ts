import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { GUEST_COOKIE, GUEST_COOKIE_MAX_AGE } from '@/lib/retention'

/**
 * WHERE YOU GO AFTER SIGNING IN.
 *
 * login/page.tsx sent everyone to /staff/referral, which the proxy then
 * bounced for anyone who was not staff. So a patient who signed up on her
 * phone and later logged in on a laptop was ejected from her own account
 * with "denied=staff_area". She could not reach her own conversation from
 * any device except the one she started on.
 *
 * The deeper problem was not the redirect. /chat resolves a person ONLY by
 * the guest cookie, so logging in did not help her at all — the browser had
 * nothing to resolve. Being authenticated and being recognised were two
 * different things, and only one of them was implemented.
 *
 * This mints the cookie from her identity. She proves who she is with a
 * password, we look up the LeadSession her PatientSession points at, and set
 * the same cookie /start would have set. From there every existing code path
 * works unchanged — the thread, the profile, the escalation, all of it.
 *
 * Deliberately server-side and deliberately a route handler: only handlers
 * and server actions may set cookies in Next.js, and the lookup must never
 * be something a browser can ask for on someone else's behalf.
 */
export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.redirect(new URL('/login?next=/resume', request.url))
  }

  const admin = createAdminClient()

  const { data: me } = await admin
    .from('app_users')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()

  const role = me?.role ?? 'patient'

  // Care team goes to their console. Clinical roles land on the queue,
  // because someone waiting is more urgent than a lead.
  if (['nurse', 'clinician'].includes(role)) {
    return NextResponse.redirect(new URL('/staff/triage', request.url))
  }
  if (role === 'staff') {
    return NextResponse.redirect(new URL('/staff/leads', request.url))
  }

  /**
   * A patient. Find the conversation that belongs to her.
   *
   * Newest first: a person can convert more than once over time, and the
   * most recent session is the one she is coming back to.
   */
  const { data: session } = await admin
    .from('patient_sessions')
    .select('lead_session_id')
    .eq('patient_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!session?.lead_session_id) {
    return NextResponse.redirect(
      new URL('/link-invalid?reason=nosession', request.url),
    )
  }

  const { data: lead } = await admin
    .from('lead_sessions')
    .select('recovery_token, lifecycle_status')
    .eq('id', session.lead_session_id)
    .maybeSingle()

  /**
   * A converted session is excluded from the purge, so its recovery token
   * should still exist. If it does not, say so honestly rather than dropping
   * her on an empty chat that looks like her history was lost.
   */
  if (!lead?.recovery_token) {
    return NextResponse.redirect(
      new URL('/link-invalid?reason=notfound', request.url),
    )
  }

  const response = NextResponse.redirect(new URL('/chat', request.url))

  response.cookies.set(GUEST_COOKIE, lead.recovery_token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: GUEST_COOKIE_MAX_AGE,
  })

  await admin.from('audit_logs').insert({
    actor_id: user.id,
    actor_role: role,
    action: 'session.resumed',
    resource_type: 'lead_session',
    resource_id: session.lead_session_id,
    metadata: { via: 'login' },
  })

  return response
}