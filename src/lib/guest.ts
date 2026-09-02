import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'
import { GUEST_COOKIE, isGuestSessionExpired } from '@/lib/retention'

/**
 * GUEST SESSION RESOLUTION
 *
 * A guest has no account and no auth.uid(), so RLS cannot protect them.
 * Their identity is an httpOnly cookie holding the recovery_token, and
 * the server acts on their behalf. This file is the single definition of
 * "who is this visitor" — the page and the send action both use it, so
 * they can never disagree.
 */

export const CLINIC_SHORT_NAME = 'Fairbloom'
export const CLINIC_FULL_NAME = 'Fairbloom Fertility & Women\u2019s Health'

/** Guest rate limiting (brief §2: "Rate-limit guest sessions against abuse"). */
export const RATE_WINDOW_MS = 60_000
export const RATE_MAX_PER_WINDOW = 8

export interface GuestSession {
  id: string
  clinic_id: string | null
  source_channel: string
  campaign_id: string | null
  creative: string | null
  identity_level: string
  social_handle: string | null
  referral_topic: string | null
  page_context: string | null
  volunteered_email: string | null
  lifecycle_status: string
  landing_timestamp: string
  destroy_after: string | null
  request_count: number
  last_request_at: string | null
}

/**
 * Kept as one unbroken literal on purpose. The Supabase client parses this
 * string at compile time to infer the row type; a concatenated string is
 * opaque to that parser and collapses the result type to an error.
 */
const GUEST_FIELDS = 'id, clinic_id, source_channel, campaign_id, creative, identity_level, social_handle, referral_topic, page_context, volunteered_email, lifecycle_status, landing_timestamp, destroy_after, request_count, last_request_at'

/**
 * Resolve the current guest, or null if there is no valid session.
 * Expiry is enforced here as well as at /start, because a cookie can
 * outlive the retention window if the browser was left open.
 */
export async function getGuestSession(): Promise<GuestSession | null> {
  const jar = await cookies()
  const token = jar.get(GUEST_COOKIE)?.value

  if (!token) return null

  const admin = createAdminClient()

  const { data, error } = await admin
    .from('lead_sessions')
    .select(GUEST_FIELDS)
    .eq('recovery_token', token)
    .maybeSingle()

  if (error || !data) return null

  const lead = data as unknown as GuestSession

  if (lead.lifecycle_status === 'suppressed') return null
  if (isGuestSessionExpired(lead.landing_timestamp, lead.destroy_after)) return null

  return lead
}

/**
 * Fixed-window rate limit using the counters already on lead_sessions.
 * Returns the new count so the caller can persist it in the same update
 * it uses for last_active_at — one write, not two.
 */
export function checkRateLimit(lead: GuestSession, now: Date = new Date()) {
  const last = lead.last_request_at ? new Date(lead.last_request_at).getTime() : 0
  const withinWindow = now.getTime() - last < RATE_WINDOW_MS
  const count = withinWindow ? lead.request_count + 1 : 1

  return {
    allowed: count <= RATE_MAX_PER_WINDOW,
    count,
  }
}