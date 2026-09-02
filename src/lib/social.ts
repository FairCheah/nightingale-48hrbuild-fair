import crypto from 'crypto'

/**
 * SOCIAL COMMENT CHANNEL — brief §1.
 *
 * A person comments on a clinic post. A webhook fires. We send them a private
 * reply containing a Nightingale portal link, and their conversation begins
 * at handle-only identity: we know @someone, not who they are.
 *
 * WHAT IS REAL HERE AND WHAT IS NOT
 *
 * Real: the endpoint shape, the signature verification, the payload parsing,
 * the identity model, and the reply construction. Point Meta at this URL with
 * a valid app secret and it works.
 *
 * Not real: the outbound DM. Sending it requires the instagram_manage_messages
 * permission, which requires App Review, which requires a live Business account
 * linked to a Facebook Page and a multi-day approval. We stop at the send and
 * log what would have gone out. That boundary is documented in the brief rather
 * than disguised.
 *
 * ON LIKES — the brief asks whether a like could creatively trigger contact.
 * We decided no, and consider the refusal more valuable than the feature.
 * A comment is an utterance; a like is not. Someone who taps a heart on a
 * fertility clinic's post has not asked to be messaged about fertility, and
 * a DM arriving on their lock screen could out them to whoever is nearby.
 * It is also almost certainly outside Meta's messaging policy, which permits
 * private replies to COMMENTS specifically. Technically possible, ethically
 * red, so not built.
 */

export type SocialPlatform =
  | 'instagram_comment'
  | 'tiktok_comment'
  | 'facebook_comment'

export interface SocialCommentEvent {
  platform: SocialPlatform
  /** The public handle. This is ALL we know — no email, no phone, no name. */
  handle: string
  /** The comment text, used only to pick a rule. Never stored raw. */
  commentText: string
  postId: string
  commentId: string
  receivedAt: string
}

/**
 * Meta signs every webhook with HMAC-SHA256 over the raw body using the app
 * secret. Verifying it is what stops anyone who knows the URL from forging
 * inbound leads — or worse, forging a comment from a handle that never
 * commented, which would send a fertility-clinic DM to an uninvolved person.
 *
 * Uses a timing-safe comparison: a plain === leaks signature bytes through
 * response timing.
 */
export function verifyMetaSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string | undefined,
): { valid: boolean; reason?: string } {
  if (!appSecret) {
    return { valid: false, reason: 'app_secret_not_configured' }
  }
  if (!signatureHeader?.startsWith('sha256=')) {
    return { valid: false, reason: 'missing_or_malformed_signature' }
  }

  const expected = crypto
    .createHmac('sha256', appSecret)
    .update(rawBody, 'utf8')
    .digest('hex')

  const provided = signatureHeader.slice('sha256='.length)

  if (expected.length !== provided.length) {
    return { valid: false, reason: 'signature_mismatch' }
  }

  const valid = crypto.timingSafeEqual(
    Buffer.from(expected, 'hex'),
    Buffer.from(provided, 'hex'),
  )

  return valid ? { valid: true } : { valid: false, reason: 'signature_mismatch' }
}

/**
 * Parse Meta's Instagram comment webhook payload.
 * Shape per the Instagram Graph API `comments` field subscription.
 *
 * Returns null for anything that is not a new comment — including likes,
 * which we deliberately do not act on.
 */
export function parseInstagramComment(
  body: unknown,
): SocialCommentEvent | null {
  const payload = body as {
    object?: string
    entry?: Array<{
      changes?: Array<{
        field?: string
        value?: {
          from?: { username?: string; id?: string }
          media?: { id?: string }
          id?: string
          text?: string
        }
      }>
    }>
  }

  if (payload?.object !== 'instagram') return null

  const change = payload.entry?.[0]?.changes?.[0]

  // Only comments. `likes` and other fields are ignored by design.
  if (change?.field !== 'comments') return null

  const value = change.value
  const handle = value?.from?.username
  const text = value?.text

  if (!handle || !text) return null

  return {
    platform: 'instagram_comment',
    handle: handle.replace(/^@/, '').slice(0, 60),
    commentText: text.slice(0, 500),
    postId: value?.media?.id ?? 'unknown',
    commentId: value?.id ?? 'unknown',
    receivedAt: new Date().toISOString(),
  }
}

/**
 * The private reply we would send.
 *
 * Deliberately says almost nothing. This lands as a notification on a lock
 * screen that other people can see, so it must not reveal what the person
 * commented on or that the sender is a fertility clinic — the handle is
 * public, but the interest is not.
 */
export function buildPrivateReply(
  event: SocialCommentEvent,
  portalUrl: string,
): string {
  return (
    `Hi @${event.handle} — thanks for your comment. ` +
    `Here is a private space to ask properly, with no sign-up needed: ${portalUrl} ` +
    `It is just you and our assistant, and nothing you say there is public.`
  )
}