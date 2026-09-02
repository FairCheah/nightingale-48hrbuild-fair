import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  verifyMetaSignature,
  parseInstagramComment,
  buildPrivateReply,
} from '@/lib/social'

/**
 * INSTAGRAM COMMENT WEBHOOK — brief §1, social_comment contract.
 *
 * GET  — Meta's subscription handshake. Echoes hub.challenge if the verify
 *        token matches.
 * POST — a comment arrived. Verify the signature, create a LeadSession at
 *        handle_only identity, and prepare the private reply.
 *
 * The person is IDENTIFIED BY HANDLE ONLY. We have no email, no phone, no
 * name, and no consent to contact them anywhere except this one reply. The
 * channel rules treat handle_only as its own identity level for that reason,
 * and nothing here asks them for contact details — the portal does, later,
 * once they have chosen to engage.
 *
 * Comments only. Likes do not reach this handler and must not: see the note
 * in src/lib/social.ts.
 */

/** Meta requires a 200 within 20 seconds or it retries and eventually unsubscribes. */
export const maxDuration = 15

export async function GET(request: Request) {
  const url = new URL(request.url)
  const mode = url.searchParams.get('hub.mode')
  const token = url.searchParams.get('hub.verify_token')
  const challenge = url.searchParams.get('hub.challenge')

  const expected = process.env.META_VERIFY_TOKEN

  if (mode === 'subscribe' && expected && token === expected) {
    return new NextResponse(challenge ?? '', { status: 200 })
  }

  return new NextResponse('Forbidden', { status: 403 })
}

export async function POST(request: Request) {
  // The raw body is needed for signature verification — parsing first would
  // change the bytes and break the HMAC.
  const rawBody = await request.text()

  const signature = request.headers.get('x-hub-signature-256')
  const { valid, reason } = verifyMetaSignature(
    rawBody,
    signature,
    process.env.META_APP_SECRET,
  )

  /**
   * In development we accept a simulated event carrying a shared header, so
   * the channel is demonstrable without Meta App Review. In production this
   * branch is unreachable: NODE_ENV is 'production' and only a real signature
   * passes.
   */
  const simulated =
    process.env.NODE_ENV !== 'production' &&
    request.headers.get('x-nightingale-simulated') === '1'

  if (!valid && !simulated) {
    console.error(
      JSON.stringify({ event: 'webhook.rejected', platform: 'instagram', reason }),
    )
    // 403, not 400: an unsigned request is not a malformed one, it is a
    // forged one, and Meta should not retry it.
    return new NextResponse('Invalid signature', { status: 403 })
  }

  let body: unknown
  try {
    body = JSON.parse(rawBody)
  } catch {
    return new NextResponse('Bad payload', { status: 400 })
  }

  const event = parseInstagramComment(body)

  // Not a comment — a like, an edit, a mention. Acknowledged and ignored.
  // Returning 200 stops Meta retrying something we will never act on.
  if (!event) {
    return NextResponse.json({ ok: true, acted: false, reason: 'not_a_comment' })
  }

  const admin = createAdminClient()

  const { data: clinic } = await admin
    .from('clinics')
    .select('id')
    .limit(1)
    .maybeSingle()

  /**
   * One LeadSession per handle per post. A person who leaves three comments
   * on the same post gets one DM, not three — which is both decent and
   * within platform anti-spam policy.
   */
  const { data: existing } = await admin
    .from('lead_sessions')
    .select('id, recovery_token')
    .eq('source_channel', 'instagram_comment')
    .eq('social_handle', event.handle)
    .eq('campaign_id', event.postId)
    .limit(1)
    .maybeSingle()

  if (existing) {
    return NextResponse.json({
      ok: true,
      acted: false,
      reason: 'already_contacted',
    })
  }

  const { data: lead, error } = await admin
    .from('lead_sessions')
    .insert({
      clinic_id: clinic?.id ?? null,
      source_channel: 'instagram_comment',
      // Attribution: which post produced this lead.
      campaign_id: event.postId,
      creative: event.commentId,
      // The identity level that drives rule selection. We know a handle and
      // nothing else, and the opening must not pretend otherwise.
      identity_level: 'handle_only',
      social_handle: event.handle,
    })
    .select('id, recovery_token')
    .single()

  if (error || !lead) {
    console.error(JSON.stringify({ event: 'webhook.lead_failed' }))
    // 500 so Meta retries — a dropped lead is worse than a duplicate.
    return new NextResponse('Could not create lead', { status: 500 })
  }

  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const portalUrl = `${base}/start/${lead.recovery_token}`
  const reply = buildPrivateReply(event, portalUrl)

  /**
   * WHERE THE INTEGRATION STOPS.
   *
   * Sending this requires POST /{ig-comment-id}/replies with a page access
   * token and the instagram_manage_messages permission, granted only through
   * App Review against a live Business account. We build the reply, log that
   * it was ready, and stop. Everything upstream of this line is production
   * code; this one call is the gap, and it is documented rather than faked.
   */
  console.log(
    JSON.stringify({
      event: 'social.private_reply_prepared',
      platform: event.platform,
      lead_session_id: lead.id,
      // The handle is public by definition, but we still log only its length.
      handle_length: event.handle.length,
      would_send: true,
    }),
  )

  await admin.from('events').insert({
    clinic_id: clinic?.id ?? null,
    lead_session_id: lead.id,
    event_type: 'visitor',
    event_detail: {
      source_channel: 'instagram_comment',
      identity_level: 'handle_only',
      entry: 'comment_webhook',
      post_id: event.postId,
    },
  })

  await admin.from('audit_logs').insert({
    actor_id: null,
    actor_role: 'system',
    action: 'social.comment_received',
    resource_type: 'lead_session',
    resource_id: lead.id,
    metadata: {
      platform: event.platform,
      post_id: event.postId,
      identity_level: 'handle_only',
      // Never the comment text — it is the person's own words, in public,
      // but not ours to copy into a healthcare system's logs.
      comment_length: event.commentText.length,
      signature_verified: valid,
      simulated,
    },
  })

  return NextResponse.json({
    ok: true,
    acted: true,
    portalUrl,
    reply,
  })
}