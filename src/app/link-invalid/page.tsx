/**
 * WHAT THE RETURNING GUEST IS TOLD.
 *
 * Scenario 3: "no build tells the returning guest what happened to what she
 * wrote before." This page previously told her two untrue things.
 *
 * The lookup in start/[token]/route.ts finds a session BY recovery_token, and
 * purge_expired_guest_data() sets recovery_token to null. So:
 *
 *   - Between destroy_after passing and the next 03:00 purge, the row still
 *     exists and 'expired' fired while claiming "nothing you wrote is stored
 *     any more" - a deletion promise made up to 24 hours before it was true.
 *
 *   - After the purge the token resolves to nothing, so she landed on
 *     'notfound', which led with "the link may have been mistyped". That
 *     reads as her error. The clinic deleted it, on schedule, as promised.
 *     Blaming the user for our own retention policy is the worse failure of
 *     the two: she will retype the link and fail again.
 *
 *   - 'suppressed' is currently unreachable for the same reason, and is kept
 *     only for a purge that retires a session without clearing its token.
 *
 * The token shape is validated before the lookup, so a well-formed token that
 * resolves to nothing is overwhelmingly a purged session rather than a typo.
 * The copy now says that, and says what she should expect next.
 */
const MESSAGES: { [key: string]: { title: string; body: string } } = {
  expired: {
    title: 'This conversation has expired',
    body: 'Anonymous conversations are kept for 14 days and then deleted. This one has passed that point, so the link no longer opens it, and what you wrote is removed in tonight\u2019s clear-out. Starting again begins a fresh conversation \u2014 nothing carries over, so you would need to tell us again.',
  },
  notfound: {
    title: 'This conversation has been deleted',
    body: 'Anonymous conversations are deleted 14 days after they begin, and this one is gone. That is the policy working, not a fault. If the link is recent, it may instead have been cut short when it was copied \u2014 try opening it from the original message.',
  },
  malformed: {
    title: 'That link does not look right',
    body: 'It may have been cut short when it was copied. Try opening it again from the original message.',
  },
  suppressed: {
    title: 'This conversation is closed',
    body: 'This link is no longer active. If you need to reach the clinic, please contact them directly.',
  },
  nosession: {
    title: 'No conversation open here',
    body: 'This page continues a conversation you have already started. To begin one, open the link from the clinic\u2019s page, post or message.',
  },
}

export const metadata = { title: 'Link unavailable' }

export default async function LinkInvalidPage({
  searchParams,
}: {
  searchParams: Promise <{ reason?: string }>
}) {
  const { reason } = await searchParams
  const content = MESSAGES[reason ?? ''] ?? MESSAGES.nosession

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[var(--fb-bg)] px-6">
      <div className="w-full max-w-sm text-center">
        <h1 className="text-xl font-semibold text-[var(--fb-text)]">
          {content.title}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-[var(--fb-text-soft)]">
          {content.body}
        </p>
        <p className="mt-8 text-xs" style={{ color: 'var(--fb-danger)' }}>
          If this is an emergency, exit Nightingale and dial 999 for Emergency
          Services.
        </p>
      </div>
    </main>
  )
}