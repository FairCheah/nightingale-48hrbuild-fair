'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { sendGuestMessage } from './actions'
import ProfilePanel, { type MemoryItem } from './ProfilePanel'
import { sendToClinic } from './escalate'

export interface ChatMessage {
  id: string
  sender: string
  content: string
  created_at: string
  risk_level: string | null
  risk_reason: string | null
  escalation_required: boolean
}

/**
 * A source the assistant actually used, per §6. Only ids the model was given
 * are ever stored, so a citation here always resolves to a real span.
 */
export interface Citation {
  message_id: string
  source_title: string
  source_org: string
  source_url: string | null
}

/**
 * Banner copy lives here rather than in risk.ts because risk.ts is a
 * server module; importing it into a client component would pull the
 * whole rule set into the browser bundle.
 */
const HIGH_BANNER = 'Call 999 or visit the nearest HOSPITAL EMERGENCY DEPARTMENT'

/**
 * The medium banner must agree with what the assistant just said. Offering a
 * Fairbloom nurse under a message explaining that Fairbloom cannot help would
 * be the same false safety net, moved to a different part of the screen.
 */
const MED_BANNERS: Record<string, string> = {
  in_scope: 'This needs a clinician to look at — I can pass it to a Fairbloom nurse.',
  out_of_scope:
    'This is outside of what Fairbloom treats. Please see a GP, or a hospital emergency department if it worsens.',
  unclear: 'This needs a clinician. Tell me a little more so I can point you to the right one.',
}

export default function ChatThread({
  initialMessages,
  clinicFullName,
  activeRisk,
  activeScope,
  memoryItems,
  canEscalate,
  alreadyEscalated,
  showInvite,
  patientEmail,
  weeklyStat,
  articulationCard,
  openingChips,
  citations,
}: {
  initialMessages: ChatMessage[]
  clinicFullName: string
  activeRisk: string | null
  activeScope: string
  memoryItems: MemoryItem[]
  canEscalate: boolean
  alreadyEscalated: boolean
  showInvite: boolean
  patientEmail: string | null
  weeklyStat: string | null
  articulationCard: string | null
  openingChips: string[]
  citations: Citation[]
}) {
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [pending, startTransition] = useTransition()
    /**
   * The message just sent, shown immediately. The server round-trip runs
   * redaction, two risk layers, an LLM call and memory extraction — several
   * seconds. Watching your own words disappear for that long reads as the
   * app losing them, which is the wrong feeling in a conversation someone
   * found hard to start.
   */
  const [optimistic, setOptimistic] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const router = useRouter()

  const hasSpoken = initialMessages.some(
    (m) => m.sender === 'guest' || m.sender === 'patient',
  )

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [initialMessages.length, pending])

  function escalate() {
    if (sending) return
    setSending(true)
    setError(null)

    startTransition(async () => {
      const result = await sendToClinic()
      if (result?.error === 'expired') {
        router.push('/link-invalid?reason=expired')
        return
      }
      if (result?.error) setError(result.error)
      setSending(false)
    })
  }

  function submit() {
    const text = input.trim()
    if (!text || pending) return

    setError(null)
    setInput('')
    setOptimistic(text)

    startTransition(async () => {
      const result = await sendGuestMessage(text)
      setOptimistic(null)
      if (result?.error === 'expired') {
        router.push('/link-invalid?reason=expired')
        return
      }
      if (result?.error) {
        setError(result.error)
        setInput(text)
      }
    })
  }

  /**
   * A chip sends its text as an ordinary message. It is not a special kind
   * of input: the same redaction, risk gating and extraction run on it, and
   * the transcript reads identically whether they tapped or typed.
   */
  function sendChip(text: string) {
    if (pending) return
    setError(null)
    setOptimistic(text)

    startTransition(async () => {
      const result = await sendGuestMessage(text)
      setOptimistic(null)
      if (result?.error === 'expired') {
        router.push('/link-invalid?reason=expired')
        return
      }
      if (result?.error) setError(result.error)
    })
  }

  async function copyCard() {
    if (!articulationCard) return
    try {
      await navigator.clipboard.writeText(articulationCard)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard can be blocked. Silent failure is fine — the text is
      // visible on screen and selectable.
    }
  }

  return (
    <div className="flex min-h-dvh flex-col bg-[var(--fb-bg)]">
      {/* Header — full clinic name, so the visitor always knows who they
          are talking to. The page <title> stays neutral for discretion. */}
      <header className="sticky top-0 z-10 border-b border-[var(--fb-border)] bg-[var(--fb-surface)]/90 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-[var(--fb-text)]"
            style={{ backgroundColor: 'var(--fb-lilac)' }}
          >
            N
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-[var(--fb-text)]">
              Nightingale AI
            </p>
            <p className="truncate text-xs text-[var(--fb-text-soft)]">
              {clinicFullName}
            </p>
          </div>

          {/* Signed-in state. Someone who has just handed over their details
              should see that it registered, and be able to leave. */}
          {patientEmail && (
            <div className="shrink-0 text-right">
              <p
                className="max-w-[11rem] break-all text-xs font-medium leading-tight sm:max-w-none"
                style={{ color: 'var(--fb-primary-dk)' }}
              >
                {patientEmail}
              </p>
              <a
                href="/logout"
                className="text-xs underline"
                style={{ color: 'var(--fb-text-soft)' }}
              >
                Sign out
              </a>
            </div>
          )}
        </div>
      </header>

      {/* Sits directly under the header so it is reachable on a phone without
          a sidebar, which would not fit. Collapsed until the person opens it. */}
      <div className="pt-3">
        <ProfilePanel items={memoryItems} />
      </div>

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-5">
        <p className="mb-2 text-center text-xs leading-relaxed text-[var(--fb-text-soft)]">
          {patientEmail
            ? 'Your record is with Fairbloom. Nightingale is an AI assistant, not a doctor.'
            : "This conversation is private and you don't need an account. Nightingale is an AI assistant, not a doctor."}
        </p>

        {/* §2b: shown only when the live query returns a meaningful number.
            Below the threshold this renders nothing at all — the truthful
            alternative to a number that would not mean anything. */}
        {weeklyStat && (
          <p
            className="mb-5 text-center text-xs"
            style={{ color: 'var(--fb-primary-dk)' }}
          >
            {weeklyStat}
          </p>
        )}

        <ul className="space-y-3">
          {initialMessages.map((message) => {
            const fromGuest =
              message.sender === 'guest' || message.sender === 'patient'
            const messageCitations = citations.filter(
              (c) => c.message_id === message.id,
            )

            return (
              <li
                key={message.id}
                className={fromGuest ? 'flex justify-end' : 'flex justify-start'}
              >
                <div
                  className="max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed"
                  style={
                    fromGuest
                      ? { backgroundColor: 'var(--fb-muted)', color: 'var(--fb-text)' }
                      : {
                          backgroundColor: 'var(--fb-surface)',
                          color: 'var(--fb-text)',
                          border: '1px solid var(--fb-border)',
                        }
                  }
                >
                  <span className="whitespace-pre-wrap">{message.content}</span>

                  {/* §6: low-risk education comes with its source. Shown
                      under the message rather than inline, so the prose stays
                      readable and the provenance stays visible. */}
                  {!fromGuest && messageCitations.length > 0 && (
                    <span
                      className="mt-2 block border-t pt-2 text-xs"
                      style={{
                        borderColor: 'var(--fb-border)',
                        color: 'var(--fb-text-soft)',
                      }}
                    >
                      {messageCitations.map((citation, i) => (
                        <span key={i} className="block">
                          {citation.source_url ? (
                            <a
                              href={citation.source_url}
                              target="_blank"
                              rel="noreferrer"
                              className="underline"
                            >
                              {citation.source_org} — {citation.source_title}
                            </a>
                          ) : (
                            <>
                              {citation.source_org} — {citation.source_title}
                            </>
                          )}
                        </span>
                      ))}
                    </span>
                  )}
                </div>
              </li>
            )
          })}

          {/* The message just sent, shown immediately at reduced opacity.
              The round-trip runs redaction, two risk layers, an LLM call and
              memory extraction — several seconds. Watching your own words
              vanish for that long reads as the app losing them, which is the
              wrong feeling in a conversation someone found hard to start. */}
          {optimistic && (
            <li className="flex justify-end">
              <div
                className="max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed opacity-60"
                style={{
                  backgroundColor: 'var(--fb-muted)',
                  color: 'var(--fb-text)',
                }}
              >
                <span className="whitespace-pre-wrap">{optimistic}</span>
              </div>
            </li>
          )}

          {pending && (
            <li className="flex justify-start">
              <div className="rounded-2xl border border-[var(--fb-border)] bg-[var(--fb-surface)] px-4 py-2.5 text-sm text-[var(--fb-text-soft)]">
                Nightingale is typing…
              </div>
            </li>
          )}
        </ul>

        {/*
          Opening chips — shown only before the person has said anything.
          This clinic's subject matter is stigmatised and the hardest part is
          often typing the first sentence. A chip is a door, not a menu: the
          text box stays visible throughout, and the wording names a topic
          rather than a symptom, so a tap can never put a clinical claim in
          someone's mouth that then lands in their record.
        */}
        {openingChips.length > 0 && !hasSpoken && !pending && (
          <div className="mt-5 flex flex-wrap gap-2">
            {openingChips.map((chip) => (
              <button
                key={chip}
                type="button"
                onClick={() => sendChip(chip)}
                disabled={pending}
                className="rounded-full border px-3.5 py-2 text-left text-xs transition disabled:opacity-50"
                style={{
                  borderColor: 'var(--fb-border)',
                  backgroundColor: 'var(--fb-surface)',
                  color: 'var(--fb-text)',
                }}
              >
                {chip}
              </button>
            ))}
          </div>
        )}

        {/* §2a: unbranded on purpose. Someone can forward this to a partner
            or a parent without disclosing that they contacted a fertility
            clinic. The sharing is the value; attribution would be the cost. */}
        {articulationCard && (
          <div
            className="mt-5 rounded-2xl border border-dashed px-4 py-3"
            style={{
              borderColor: 'var(--fb-accent)',
              backgroundColor: 'rgba(244, 138, 113, 0.06)',
            }}
          >
            <p
              className="text-xs font-semibold uppercase tracking-wide"
              style={{ color: 'var(--fb-text-soft)' }}
            >
              Words you can borrow, if this is hard to explain
            </p>
            <p
              className="mt-2 text-sm leading-relaxed"
              style={{ color: 'var(--fb-text)' }}
            >
              {articulationCard}
            </p>
            <button
              type="button"
              onClick={copyCard}
              className="mt-2 text-xs underline"
              style={{ color: 'var(--fb-text-soft)' }}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
            <p className="mt-1 text-xs" style={{ color: 'var(--fb-text-soft)' }}>
              Written as if from you. Nothing in it says where it came from.
            </p>
          </div>
        )}

        <div ref={bottomRef} />
      </main>

      <footer className="sticky bottom-0 border-t border-[var(--fb-border)] bg-[var(--fb-surface)]">
        {/* Risk banner sits ABOVE the composer so it cannot be scrolled past.
            Input stays enabled deliberately: a frightened person who cannot
            type feels abandoned. We stop giving advice, not listening. */}
        {activeRisk === 'high' && (
          <div
            className="px-4 py-3 text-center text-sm font-semibold leading-snug text-white"
            style={{ backgroundColor: 'var(--fb-danger)' }}
          >
            {HIGH_BANNER}
          </div>
        )}

        {activeRisk === 'med' && (
          <div
            className="border-b px-4 py-2.5 text-center text-xs leading-snug"
            style={{
              backgroundColor: 'var(--fb-muted)',
              borderColor: 'var(--fb-border)',
              color: 'var(--fb-text)',
            }}
          >
            {MED_BANNERS[activeScope] ?? MED_BANNERS.in_scope}
          </div>
        )}

        {/*
          Brief §8: a SINGLE clear action on Med/High. Scope-gated — we do not
          offer a Fairbloom nurse for chest pain, consistent with the routing
          in the reply above it. Deliberately not styled as an emergency: this
          is a considered step, not a panic button.
        */}
        {canEscalate && activeScope !== 'out_of_scope' && (
          <div className="mx-auto w-full max-w-2xl px-4 pt-3">
            <button
              type="button"
              onClick={escalate}
              disabled={sending || pending}
              className="w-full rounded-2xl px-4 py-3 text-sm font-semibold text-white transition disabled:opacity-50"
              style={{ backgroundColor: 'var(--fb-safe)' }}
            >
              {sending
                ? 'Sending…'
                : activeRisk === 'high'
                  ? 'Also let Fairbloom know'
                  : 'Send this to a nurse at Fairbloom'}
            </button>
            <p
              className="mt-1.5 text-center text-xs leading-snug"
              style={{ color: 'var(--fb-text-soft)' }}
            >
              {activeRisk === 'high'
                ? 'This is not your emergency route — call 999 for that. It lets the clinic know what happened and follow up with you.'
                : 'A real person reviews it within 12–18 hours. You can keep chatting.'}
            </p>
          </div>
        )}

        {/*
          Brief §4: authentication triggers on value or clinical intent, not
          on page landing. This appears only after the person has had a real
          exchange — and after any escalation, never in front of it. The
          framing is about being reachable, not about gaining access, because
          they already have access.
        */}
        {showInvite && (
          <div className="mx-auto w-full max-w-2xl px-4 pt-3">
            <a
              href="/continue"
              className="block w-full rounded-2xl border px-4 py-2.5 text-center text-sm font-medium transition"
              style={{
                borderColor: 'var(--fb-primary)',
                color: 'var(--fb-primary-dk)',
                backgroundColor: 'rgba(124, 139, 127, 0.08)',
              }}
            >
              {alreadyEscalated
                ? 'Add a contact so the clinic can reply'
                : 'Continue securely with Fairbloom'}
            </a>
          </div>
        )}

        {alreadyEscalated && (
          <div className="mx-auto w-full max-w-2xl px-4 pt-3">
            <p
              className="rounded-2xl px-4 py-2.5 text-center text-xs"
              style={{
                backgroundColor: 'rgba(111, 143, 132, 0.12)',
                color: 'var(--fb-primary-dk)',
              }}
            >
              {activeRisk === 'high'
                ? 'Fairbloom has recorded this. It seems like an emergency. Call 999 or go to a hospital emergency department now.'
                : 'A nurse at Fairbloom has this and will review it within 12–18 hours.'}
            </p>
          </div>
        )}

        <div className="mx-auto w-full max-w-2xl px-4 pb-3 pt-3">
          {error && (
            <p className="mb-2 text-xs" style={{ color: 'var(--fb-danger)' }}>
              {error}
            </p>
          )}

          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  submit()
                }
              }}
              rows={1}
              placeholder="Type your message…"
              className="max-h-32 min-h-11 flex-1 resize-none rounded-2xl border border-[var(--fb-border)] bg-[var(--fb-bg)] px-4 py-2.5 text-sm text-[var(--fb-text)] outline-none focus:border-[var(--fb-primary)]"
            />
            <button
              type="button"
              onClick={submit}
              disabled={pending || !input.trim()}
              className="h-11 shrink-0 rounded-2xl px-5 text-sm font-medium text-white transition disabled:opacity-40"
              style={{ backgroundColor: 'var(--fb-primary)' }}
            >
              Send
            </button>
          </div>

          {/* Brief §6 requires this to sit clearly below the text box. */}
          <p
            className="mt-2.5 text-center text-xs"
            style={{ color: 'var(--fb-danger)' }}
          >
            If this is an emergency, exit Nightingale and dial 999 for Emergency
            Services.
          </p>
        </div>
      </footer>
    </div>
  )
}