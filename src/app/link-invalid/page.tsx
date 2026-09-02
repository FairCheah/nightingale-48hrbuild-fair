const MESSAGES: Record<string, { title: string; body: string }> = {
  expired: {
    title: 'This link has expired',
    body: 'For privacy, we delete anonymous conversations after 14 days. Nothing you wrote is stored any more. You can start a fresh conversation any time.',
  },
  notfound: {
    title: "We couldn't find that conversation",
    body: 'The link may have been mistyped, or it may already have been cleared. You can start a new conversation from the clinic\u2019s page.',
  },
  malformed: {
    title: "That link doesn't look right",
    body: 'It may have been cut short when it was copied. Try opening it again from the original message.',
  },
  suppressed: {
    title: 'This conversation is closed',
    body: 'This link is no longer active. If you need to reach the clinic, please contact them directly.',
  },
}

export const metadata = { title: 'Link unavailable' }

export default async function LinkInvalidPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>
}) {
  const { reason } = await searchParams
  const content = MESSAGES[reason ?? ''] ?? MESSAGES.notfound

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