import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  GUEST_COOKIE,
  GUEST_COOKIE_MAX_AGE,
  isGuestSessionExpired,
} from '@/lib/retention'

/**
 * GUEST LANDING — /start/{recovery_token}
 *
 * Every acquisition channel funnels through here: staff_referral links,
 * social comment DMs, ad clicks, review replies, website widgets.
 *
 * A route handler rather than a page for two reasons:
 *   1. Only handlers and server actions may set cookies in Next.js.
 *   2. It drops the token from the address bar before anything renders.
 *      Recovery tokens in visible URLs leak via referrer headers, shared
 *      links and screenshots — a real exposure for this clinic.
 */

// recovery_token = encode(gen_random_bytes(24), 'hex') -> 48 hex chars.
const TOKEN_SHAPE = /^[a-f0-9]{48}$/i

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params

  const invalid = (reason: string) =>
    NextResponse.redirect(new URL(`/link-invalid?reason=${reason}`, request.url))

  if (!TOKEN_SHAPE.test(token)) return invalid('malformed')

  const admin = createAdminClient()

  const { data: lead, error } = await admin
    .from('lead_sessions')
    .select(
      'id, clinic_id, source_channel, identity_level, lifecycle_status, landing_timestamp, destroy_after',
    )
    .eq('recovery_token', token)
    .maybeSingle()

  if (error || !lead) return invalid('notfound')
  if (lead.lifecycle_status === 'suppressed') return invalid('suppressed')
  if (isGuestSessionExpired(lead.landing_timestamp, lead.destroy_after)) {
    return invalid('expired')
  }

  const now = new Date().toISOString()

  await admin
    .from('lead_sessions')
    .update({ last_active_at: now, lifecycle_status: 'active' })
    .eq('id', lead.id)

  // Funnel event. Metadata only — no message text, topic or handle.
  await admin.from('events').insert({
    clinic_id: lead.clinic_id,
    lead_session_id: lead.id,
    event_type: 'conversation_started',
    event_detail: {
      source_channel: lead.source_channel,
      identity_level: lead.identity_level,
      entry: 'recovery_link',
    },
  })

  await admin.from('audit_logs').insert({
    actor_id: null,
    actor_role: 'guest',
    action: 'lead_session.opened',
    resource_type: 'lead_session',
    resource_id: lead.id,
    metadata: {
      source_channel: lead.source_channel,
      identity_level: lead.identity_level,
    },
  })

  const response = NextResponse.redirect(new URL('/chat', request.url))

  response.cookies.set(GUEST_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: GUEST_COOKIE_MAX_AGE,
  })

  return response
}