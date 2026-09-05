'use client'

import ProfilePanel, { type MemoryItem } from './ProfilePanel'

/**
 * THE SIDE DRAWER.
 *
 * The living profile and the articulation card both sat stacked in the
 * conversation column. Every time either grew it pushed the newest message
 * down the page — so the moment the assistant said something useful, the
 * thing covering it was a panel about what she had said earlier.
 *
 * Content that describes the conversation should not compete with it. Both
 * live here now, behind one button, and the thread is only the thread.
 *
 * Right-hand panel on a wide screen, bottom sheet on a phone. Not a fixed
 * sidebar: this clinic's subject matter is stigmatised and phones are shared,
 * so "Main concern: irregular bleeding" should never be permanently on
 * screen. It opens because she opened it.
 */
export default function SidePanel({
  open,
  onClose,
  items,
  articulationCard,
  onCopyCard,
  copied,
}: {
  open: boolean
  onClose: () => void
  items: MemoryItem[]
  articulationCard: string | null
  onCopyCard: () => void
  copied: boolean
}) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-30">
      <button
        type="button"
        aria-label="Close panel"
        onClick={onClose}
        className="absolute inset-0 h-full w-full"
        style={{ backgroundColor: 'rgba(43, 38, 40, 0.28)' }}
      />

      <aside
        className="absolute inset-x-0 bottom-0 max-h-[82vh] overflow-y-auto rounded-t-2xl border-t sm:inset-y-0 sm:left-auto sm:right-0 sm:max-h-none sm:w-[22rem] sm:rounded-none sm:border-l sm:border-t-0"
        style={{
          borderColor: 'var(--fb-border)',
          backgroundColor: 'var(--fb-surface)',
        }}
      >
        <div
          className="sticky top-0 flex items-center justify-between border-b px-4 py-3"
          style={{
            borderColor: 'var(--fb-border)',
            backgroundColor: 'var(--fb-surface)',
          }}
        >
          <p
            className="text-sm font-semibold"
            style={{ color: 'var(--fb-text)' }}
          >
            What I&apos;ve noted
          </p>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-sm"
            style={{ color: 'var(--fb-text-soft)' }}
          >
            Close
          </button>
        </div>

        <div className="px-4 py-4">
          {items.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--fb-text-soft)' }}>
              Nothing noted yet. As we talk, anything I pick up appears here so
              you can correct it.
            </p>
          ) : (
            <ProfilePanel items={items} />
          )}

          {articulationCard && (
            <div
              className="mt-5 rounded-2xl border border-dashed px-4 py-3"
              style={{
                borderColor: 'var(--fb-accent)',
                backgroundColor: 'rgba(252, 169, 162, 0.10)',
              }}
            >
              <p
                className="text-xs font-semibold uppercase tracking-wide"
                style={{ color: 'var(--fb-text-soft)' }}
              >
                Words you can borrow
              </p>
              <p
                className="mt-2 text-sm leading-relaxed"
                style={{ color: 'var(--fb-text)' }}
              >
                {articulationCard}
              </p>
              <button
                type="button"
                onClick={onCopyCard}
                className="mt-2 text-xs underline"
                style={{ color: 'var(--fb-text-soft)' }}
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
              <p
                className="mt-1 text-xs"
                style={{ color: 'var(--fb-text-soft)' }}
              >
                Written as if from you. Nothing in it says where it came from.
              </p>
            </div>
          )}
        </div>
      </aside>
    </div>
  )
}