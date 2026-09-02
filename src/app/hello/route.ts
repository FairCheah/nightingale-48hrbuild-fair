import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * OPEN DOOR — /hello
 *
 * The channel for someone who simply arrives: a link on the clinic's website,
 * a QR code in the waiting room, an ad click. No staff member generates it,
 * no webhook fires, and nothing is known about them.
 *
 * Until now every entry point required someone else to act first, which is a
 * strange gap in a product whose premise is catching strangers.
 *
 * Creates a LeadSession on demand and hands off to /start, so this uses the
 * same landing, cookie, expiry and channel-rule machinery as every other
 * channel. Adding a channel is a rule row plus an entry point — never a
 * second code path. That is what §3's "declarative configuration, not
 * scattered if-statements" is actually asking for.
 *
 * Optional query parameters, all attribution, none required:
 *   ?source=instagram_ad_click   which contract this arrival belongs to
 *   ?campaign=ivf_over40         campaign id
 *   ?creative=carousel_a         which creative
 *   ?page=egg-freezing           which page or topic they came from
 *
 * This is also the entry point test_guest_to_patient_conversion uses:
 *   /hello?source=instagram_ad_click&campaign=ivf_over40
 */

/**
 * Only channels we hold rules for. An unrecognised source falls back to
 * website_widget rather than creating a session no rule can open.
 */
const KNOWN_CHANNELS = new Set([
  'website_widget',
  'instagram_ad_click',
  'google_ad_click',
  'google_reviews',
])

export async function GET(request: Request) {
  const url = new URL(request.url)

  const requested = url.searchParams.get('source') ?? 'website_widget'
  const source = KNOWN_CHANNELS.has(requested) ? requested : 'website_widget'

  const admin = createAdminClient()

  const { data: clinic } = await admin
    .from('clinics')
    .select('id')
    .limit(1)
    .maybeSingle()

  const { data: lead, error } = await admin
    .from('lead_sessions')
    .insert({
      clinic_id: clinic?.id ?? null,
      source_channel: source,
      // Attribution captured at the door, per §1. It survives all the way
      // to the escalation payload through the lead_session join.
      campaign_id: url.searchParams.get('campaign')?.slice(0, 80) ?? null,
      creative: url.searchParams.get('creative')?.slice(0, 80) ?? null,
      page_context: url.searchParams.get('page')?.slice(0, 120) ?? null,
      // Nothing is known about this person. Not a handle, not an email.
      identity_level: 'anonymous',
    })
    .select('recovery_token')
    .single()

  if (error || !lead?.recovery_token) {
    return NextResponse.redirect(
      new URL('/link-invalid?reason=notfound', request.url),
    )
  }

  /**
   * Hand off rather than duplicate. /start owns the cookie, the expiry check,
   * the channel-rule opening and the funnel event; this route's only job is
   * deciding that a session should exist at all.
   */
  return NextResponse.redirect(
    new URL(`/start/${lead.recovery_token}`, request.url),
  )
}