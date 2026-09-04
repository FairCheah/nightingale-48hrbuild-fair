'use client'

import { useState, useTransition } from 'react'
import { acknowledgeEscalation, replyToEscalation } from '../actions'

/**
 * The reply box.
 *
 * "Mark as seen" and "Send reply" are separate on purpose. Acknowledging tells
 * the rest of the team that someone has picked this up, which stops two nurses
 * writing the same answer at 07:00. It does NOT stop the response_due_at
 * clock: to the woman waiting, being seen and being answered are not the same
 * thing, and letting an acknowledgement clear the overdue flag would let the
 * clinic mark its own homework.
 */
export default function ReplyBox({
  escalationId,
  acknowledged,
  responderName,
}: {
  escalationId: string
  acknowledged: boolean
  responderName: string
}) {
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [pending, startTransition] = useTransition()

  function ack() {
    setError(null)
    startTransition(async () => {
      const r = await acknowledgeEscalation(escalationId)
      if (!r.ok) setError(r.error)
    })
  }

  function send() {
    setError(null)
    startTransition(async () => {
      const r = await replyToEscalation(escalationId, body)
      if (r.ok) {
        setBody('')
        setSent(true)
      } else {
        setError(r.error)
      }
    })
  }

  return (
    <section className="mt-5">
      <h2
        className="text-xs font-semibold uppercase"
        style={{ color: 'var(--fb-text-soft)' }}
      >
        Reply to the patient
      </h2>
      <p className="mt-1 text-xs" style={{ color: 'var(--fb-text-soft)' }}>
        She will see this under your name and role, in her own conversation.
        Sending as {responderName}.
      </p>

      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={5}
        placeholder="She will see this in her own conversation, under your name."
        className="mt-1 w-full rounded border px-3 py-2 text-sm"
        style={{
          borderColor: 'var(--fb-border)',
          backgroundColor: 'var(--fb-surface)',
          color: 'var(--fb-text)',
        }}
      />

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          onClick={send}
          disabled={pending || body.trim().length < 2}
          className="rounded px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          style={{ backgroundColor: 'var(--fb-primary)' }}
        >
          {pending ? 'Sending…' : 'Send reply'}
        </button>

        {!acknowledged && (
          <button
            onClick={ack}
            disabled={pending}
            className="rounded border px-3 py-2 text-sm disabled:opacity-40"
            style={{
              borderColor: 'var(--fb-border)',
              color: 'var(--fb-text-soft)',
            }}
          >
            Mark as seen
          </button>
        )}

        {acknowledged && (
          <span className="text-xs" style={{ color: 'var(--fb-safe)' }}>
            Marked as seen — the clock is still running until she gets a reply.
          </span>
        )}
      </div>

      {error && (
        <p className="mt-2 text-xs" style={{ color: 'var(--fb-danger)' }}>
          {error}
        </p>
      )}

      {sent && !error && (
        <p className="mt-2 text-xs" style={{ color: 'var(--fb-safe)' }}>
          Sent. Refresh to see it in the thread.
        </p>
      )}
    </section>
  )
}
