'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { sendGuestMessage } from './actions'

export interface ChatMessage {
  id: string
  sender: string
  content: string
  created_at: string
}

export default function ChatThread({
  initialMessages,
  clinicFullName,
}: {
  initialMessages: ChatMessage[]
  clinicFullName: string
}) {
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const bottomRef = useRef<HTMLDivElement>(null)
  const router = useRouter()

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [initialMessages.length, pending])

  function submit() {
    const text = input.trim()
    if (!text || pending) return

    setError(null)
    setInput('')

    startTransition(async () => {
      const result = await sendGuestMessage(text)
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
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[var(--fb-text)]">
              Nightingale AI
            </p>
            <p className="truncate text-xs text-[var(--fb-text-soft)]">
              {clinicFullName}
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-5">
        <p className="mb-5 text-center text-xs leading-relaxed text-[var(--fb-text-soft)]">
          This conversation is private and you don&apos;t need an account.
          Nightingale is an AI assistant, not a doctor.
        </p>

        <ul className="space-y-3">
          {initialMessages.map((message) => {
            const fromGuest = message.sender === 'guest' || message.sender === 'patient'
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
                  {message.content}
                </div>
              </li>
            )
          })}

          {pending && (
            <li className="flex justify-start">
              <div className="rounded-2xl border border-[var(--fb-border)] bg-[var(--fb-surface)] px-4 py-2.5 text-sm text-[var(--fb-text-soft)]">
                Nightingale is typing…
              </div>
            </li>
          )}
        </ul>

        <div ref={bottomRef} />
      </main>

      <footer className="sticky bottom-0 border-t border-[var(--fb-border)] bg-[var(--fb-surface)]">
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