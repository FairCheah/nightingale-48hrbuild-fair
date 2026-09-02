'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { convertGuestToPatient } from './actions'

interface Fact {
  kind: string
  value: string
  status: string
  timeline: string | null
}

const KIND_LABELS: Record<string, string> = {
  chief_complaint: 'Main concern',
  symptom: 'Symptom',
  medication: 'Medication',
  allergy: 'Allergy',
}

export default function ContinueForm({
  clinicFullName,
  clinicShortName,
  messageCount,
  facts,
  hasOpenEscalation,
}: {
  clinicFullName: string
  clinicShortName: string
  messageCount: number
  facts: Fact[]
  hasOpenEscalation: boolean
  sourceChannel: string
}) {
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [consentShare, setConsentShare] = useState(false)
  const [consentMigrate, setConsentMigrate] = useState(true)
  const [consentMarketing, setConsentMarketing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function submit() {
    if (pending) return
    setError(null)

    startTransition(async () => {
      const result = await convertGuestToPatient({
        email,
        phone,
        password,
        consentShare,
        consentMigrate,
        consentMarketing,
      })

      if (result?.error === 'expired') {
        router.push('/link-invalid?reason=expired')
        return
      }
      if (result?.error) {
        setError(result.error)
        return
      }
      router.push('/chat')
    })
  }

  const field =
    'w-full rounded-xl border px-4 py-2.5 text-sm outline-none transition'
  const fieldStyle = {
    borderColor: 'var(--fb-border)',
    backgroundColor: 'var(--fb-surface)',
    color: 'var(--fb-text)',
  }

  return (
    <main className="min-h-dvh bg-[var(--fb-bg)] px-4 py-8">
      <div className="mx-auto w-full max-w-md">
        <h1 className="text-xl font-semibold" style={{ color: 'var(--fb-text)' }}>
          {hasOpenEscalation
            ? `So ${clinicShortName} can reply to you`
            : `Continue securely with ${clinicShortName}`}
        </h1>

        <p
          className="mt-2 text-sm leading-relaxed"
          style={{ color: 'var(--fb-text-soft)' }}
        >
          {hasOpenEscalation
            ? 'A nurse already has what you wrote. Right now they have no way to reach you. This takes a moment, and you will not have to repeat anything.'
            : 'This creates your record so a clinician can pick up where we left off. Nothing you have already told me needs saying again.'}
        </p>

        {/* What moves. Permission is not meaningful without visibility. */}
        {(facts.length > 0 || messageCount > 0) && (
          <div
            className="mt-5 rounded-xl border border-dashed px-4 py-3"
            style={{
              borderColor: 'var(--fb-primary)',
              backgroundColor: 'rgba(124, 139, 127, 0.06)',
            }}
          >
            <p
              className="text-xs font-semibold uppercase tracking-wide"
              style={{ color: 'var(--fb-primary-dk)' }}
            >
              What comes with you
            </p>
            <ul className="mt-2 space-y-1">
              {facts.map((fact, i) => (
                <li key={i} className="text-sm" style={{ color: 'var(--fb-text)' }}>
                  <span style={{ color: 'var(--fb-text-soft)' }}>
                    {KIND_LABELS[fact.kind] ?? fact.kind}:{' '}
                  </span>
                  {fact.value}
                  {fact.timeline && (
                    <span style={{ color: 'var(--fb-text-soft)' }}>
                      {' '}
                      — {fact.timeline}
                    </span>
                  )}
                  {fact.status !== 'active' && (
                    <span style={{ color: 'var(--fb-text-soft)' }}>
                      {' '}
                      ({fact.status})
                    </span>
                  )}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs" style={{ color: 'var(--fb-text-soft)' }}>
              Plus our {messageCount} message{messageCount === 1 ? '' : 's'}.
            </p>
          </div>
        )}

        <div className="mt-6 space-y-3">
          <div>
            <label
              className="mb-1 block text-xs font-medium"
              style={{ color: 'var(--fb-text-soft)' }}
            >
              Email — this is how you sign in
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              className={field}
              style={fieldStyle}
            />
          </div>

          <div>
            <label
              className="mb-1 block text-xs font-medium"
              style={{ color: 'var(--fb-text-soft)' }}
            >
              Phone — how the clinic reaches you
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              autoComplete="tel"
              className={field}
              style={fieldStyle}
            />
          </div>

          <div>
            <label
              className="mb-1 block text-xs font-medium"
              style={{ color: 'var(--fb-text-soft)' }}
            >
              Password — at least 8 characters
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              className={field}
              style={fieldStyle}
            />
          </div>
        </div>

        {/* Three separate consents, three separate timestamps. */}
        <div className="mt-6 space-y-3">
          <label className="flex cursor-pointer gap-3">
            <input
              type="checkbox"
              checked={consentShare}
              onChange={(e) => setConsentShare(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0"
            />
            <span className="text-xs leading-relaxed" style={{ color: 'var(--fb-text)' }}>
              I consent to <strong>{clinicFullName}</strong> holding and using my
              health information to provide me with care.
            </span>
          </label>

          <label className="flex cursor-pointer gap-3">
            <input
              type="checkbox"
              checked={consentMigrate}
              onChange={(e) => setConsentMigrate(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0"
            />
            <span className="text-xs leading-relaxed" style={{ color: 'var(--fb-text)' }}>
              Bring this conversation with me. Untick if you would rather start
              fresh — your account will still be created.
            </span>
          </label>

          <label className="flex cursor-pointer gap-3">
            <input
              type="checkbox"
              checked={consentMarketing}
              onChange={(e) => setConsentMarketing(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0"
            />
            <span className="text-xs leading-relaxed" style={{ color: 'var(--fb-text-soft)' }}>
              Optional: {clinicShortName} may send me occasional health
              information and offers. Everything else we send is about your care.
            </span>
          </label>
        </div>

        {error && (
          <p className="mt-4 text-xs" style={{ color: 'var(--fb-danger)' }}>
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="mt-6 w-full rounded-2xl px-4 py-3 text-sm font-semibold text-white transition disabled:opacity-50"
          style={{ backgroundColor: 'var(--fb-primary)' }}
        >
          {pending ? 'Creating your record…' : 'Create my record'}
        </button>

        <p
          className="mt-4 text-center text-xs leading-relaxed"
          style={{ color: 'var(--fb-text-soft)' }}
        >
          You can change your email or phone later without losing your history.
        </p>
      </div>
    </main>
  )
}