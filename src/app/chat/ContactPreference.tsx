'use client'

import { useState, useTransition } from 'react'
import { saveContactPreference } from './contact-actions'

/**
 * ASKED AFTER THE CASE IS SENT, NEVER BEFORE IT.
 *
 * The obvious version of this puts a contact form in front of the Send
 * button. That breaks the principle the build rests on — a safety action
 * never requires identifying yourself first — and it breaks worst for the
 * person who needs it most. Someone at 2am who will not type a phone number
 * on a shared device would get no help at all, and the person most afraid to
 * identify herself usually has the most at stake.
 *
 * So the nurse already has her words. This only decides how the reply
 * travels. "I'll check back here" is a complete answer, not a refusal: the
 * reply genuinely does wait in her conversation, and that path existed all
 * along — nothing had ever told her so.
 */
export default function ContactPreference({
  existingPreference,
}: {
  existingPreference: string | null
}) {
  const [choice, setChoice] = useState(existingPreference ?? '')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(Boolean(existingPreference))
  const [pending, startTransition] = useTransition()

  if (saved) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 pt-3">
        <p
          className="rounded-2xl px-4 py-2.5 text-center text-xs"
          style={{
            backgroundColor: 'rgba(146, 172, 126, 0.14)',
            color: 'var(--fb-text)',
          }}
        >
          {choice === 'in_conversation'
            ? 'Noted — their reply will be waiting here when you come back.'
            : 'Noted. They will reach you that way, and the reply will be here too.'}
        </p>
      </div>
    )
  }

  function save() {
    setError('')
    startTransition(async () => {
      const r = await saveContactPreference({
        preference: choice,
        email,
        phone,
      })
      if (r?.error) setError(r.error)
      else setSaved(true)
    })
  }

  const OPTIONS = [
    { value: 'in_conversation', label: "No, I'll check back here" },
    { value: 'email', label: 'Email me' },
    { value: 'whatsapp', label: 'WhatsApp me' },
  ]

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-3">
      <div
        className="rounded-2xl border px-4 py-3"
        style={{
          borderColor: 'var(--fb-border)',
          backgroundColor: 'var(--fb-surface)',
        }}
      >
        <p className="text-sm" style={{ color: 'var(--fb-text)' }}>
          Would you rather they reached you directly?
        </p>
        <p
          className="mt-1 text-xs leading-relaxed"
          style={{ color: 'var(--fb-text-soft)' }}
        >
          Either way the reply will be waiting in this conversation. You do not
          have to leave anything.
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          {OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => setChoice(o.value)}
              className="rounded-full border px-3.5 py-2 text-xs transition"
              style={{
                borderColor:
                  choice === o.value
                    ? 'var(--fb-primary)'
                    : 'var(--fb-border)',
                backgroundColor:
                  choice === o.value
                    ? 'rgba(231, 41, 92, 0.08)'
                    : 'var(--fb-surface)',
                color:
                  choice === o.value
                    ? 'var(--fb-primary-dk)'
                    : 'var(--fb-text)',
              }}
            >
              {o.label}
            </button>
          ))}
        </div>

        {choice === 'email' && (
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="mt-3 w-full rounded-2xl border px-4 py-2.5 text-sm outline-none"
            style={{
              borderColor: 'var(--fb-border)',
              backgroundColor: 'var(--fb-bg)',
              color: 'var(--fb-text)',
            }}
          />
        )}

        {choice === 'whatsapp' && (
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="012 345 6789"
            className="mt-3 w-full rounded-2xl border px-4 py-2.5 text-sm outline-none"
            style={{
              borderColor: 'var(--fb-border)',
              backgroundColor: 'var(--fb-bg)',
              color: 'var(--fb-text)',
            }}
          />
        )}

        {choice && (
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className="mt-3 w-full rounded-2xl px-4 py-2.5 text-sm font-medium text-white transition disabled:opacity-50"
            style={{ backgroundColor: 'var(--fb-primary)' }}
          >
            {pending ? 'Saving…' : 'Save'}
          </button>
        )}

        {error && (
          <p className="mt-2 text-xs" style={{ color: 'var(--fb-danger)' }}>
            {error}
          </p>
        )}
      </div>
    </div>
  )
}