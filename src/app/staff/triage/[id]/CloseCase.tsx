'use client'

import { useState, useTransition } from 'react'
import { closeEscalation } from '../actions'
import { CLOSURE_REASONS } from '../closure-reasons'

/**
 * Closing is a clinician's decision, and a nurse should be told that plainly
 * rather than shown a button that will fail. The database refuses either way
 * (enforce_clinician_close, migration 04); this is only the explanation.
 *
 * The note is the internal handover: "seen 8 Sep, scan booked 15 Sep". It is
 * never shown to the patient, which is why it lives here and not in a reply.
 */
export default function CloseCase({
  escalationId,
  isClinician,
}: {
  escalationId: string
  isClinician: boolean
}) {
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()

  if (!isClinician) {
    return (
      <p className="mt-5 text-xs" style={{ color: 'var(--fb-text-soft)' }}>
        Only a clinician can close this case. You can reply and mark it as
        seen.
      </p>
    )
  }

  function close() {
    setError('')
    startTransition(async () => {
      const r = await closeEscalation(escalationId, reason, note)
      if (!r.ok) setError(r.error)
    })
  }

  return (
    <section
      className="mt-6 rounded border px-3 py-3"
      style={{
        borderColor: 'var(--fb-border)',
        backgroundColor: 'var(--fb-surface)',
      }}
    >
      <h2
        className="text-xs font-semibold uppercase"
        style={{ color: 'var(--fb-text-soft)' }}
      >
        Close this case
      </h2>

      <select
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className="mt-2 w-full rounded border px-2 py-2 text-sm"
        style={{
          borderColor: 'var(--fb-border)',
          backgroundColor: 'var(--fb-bg)',
          color: 'var(--fb-text)',
        }}
      >
        <option value="">Why is this closing?</option>
        {CLOSURE_REASONS.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
      </select>

      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={3}
        placeholder="Handover note for the team - what was done, what happens next. The patient never sees this."
        className="mt-2 w-full rounded border px-3 py-2 text-sm"
        style={{
          borderColor: 'var(--fb-border)',
          backgroundColor: 'var(--fb-bg)',
          color: 'var(--fb-text)',
        }}
      />

      <button
        onClick={close}
        disabled={pending || !reason}
        className="mt-2 rounded border px-3 py-2 text-sm disabled:opacity-40"
        style={{
          borderColor: 'var(--fb-primary)',
          color: 'var(--fb-primary-dk)',
        }}
      >
        {pending ? 'Closing…' : 'Close case'}
      </button>

      {error && (
        <p className="mt-2 text-xs" style={{ color: 'var(--fb-danger)' }}>
          {error}
        </p>
      )}
    </section>
  )
}