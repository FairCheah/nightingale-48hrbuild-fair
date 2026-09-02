'use client'

import { useState } from 'react'

/**
 * SOCIAL COMMENT SIMULATOR.
 *
 * Posts a genuine Instagram webhook payload to the genuine webhook route.
 * The only thing bypassed is the HMAC signature, and only because we do not
 * hold Meta's app secret. Payload shape, parsing, identity level, lead
 * creation, deduplication, event emission and audit logging are all real.
 */
export default function SocialSimulator() {
  const [handle, setHandle] = useState('aisyah_kl')
  const [comment, setComment] = useState(
    'is egg freezing something you do here? asking for me 🙈',
  )
  const [postId, setPostId] = useState('ig_post_eggfreezing_sep')
  const [result, setResult] = useState<{
    portalUrl?: string
    reply?: string
    reason?: string
    acted?: boolean
  } | null>(null)
  const [busy, setBusy] = useState(false)

  async function fire() {
    setBusy(true)
    setResult(null)

    // The exact shape Meta sends for a `comments` field subscription.
    const payload = {
      object: 'instagram',
      entry: [
        {
          id: 'ig_business_account_id',
          time: Math.floor(Date.now() / 1000),
          changes: [
            {
              field: 'comments',
              value: {
                from: { username: handle, id: 'ig_user_id' },
                media: { id: postId },
                id: `comment_${Date.now()}`,
                text: comment,
              },
            },
          ],
        },
      ],
    }

    try {
      const response = await fetch('/api/webhooks/instagram', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Development only. In production this header is ignored and an
          // unsigned request is rejected with 403.
          'x-nightingale-simulated': '1',
        },
        body: JSON.stringify(payload),
      })

      setResult(await response.json())
    } catch {
      setResult({ reason: 'request_failed' })
    } finally {
      setBusy(false)
    }
  }

  const field =
    'w-full rounded-xl border px-3 py-2 text-sm outline-none transition'
  const fieldStyle = {
    borderColor: 'var(--fb-border)',
    backgroundColor: 'var(--fb-surface)',
    color: 'var(--fb-text)',
  }

  return (
    <main className="min-h-dvh bg-[var(--fb-bg)] px-4 py-8">
      <div className="mx-auto w-full max-w-xl">
        <h1
          className="text-xl font-semibold"
          style={{ color: 'var(--fb-text)' }}
        >
          Social comment channel
        </h1>
        <p
          className="mt-2 text-sm leading-relaxed"
          style={{ color: 'var(--fb-text-soft)' }}
        >
          Fires a real Instagram webhook payload at the real handler. Everything
          downstream of the signature check runs exactly as it would in
          production.
        </p>

        <div className="mt-6 space-y-3">
          <div>
            <label
              className="mb-1 block text-xs font-medium"
              style={{ color: 'var(--fb-text-soft)' }}
            >
              Commenter handle
            </label>
            <input
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              className={field}
              style={fieldStyle}
            />
          </div>

          <div>
            <label
              className="mb-1 block text-xs font-medium"
              style={{ color: 'var(--fb-text-soft)' }}
            >
              Comment
            </label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={2}
              className={`${field} resize-none`}
              style={fieldStyle}
            />
          </div>

          <div>
            <label
              className="mb-1 block text-xs font-medium"
              style={{ color: 'var(--fb-text-soft)' }}
            >
              Post ID — becomes the campaign attribution
            </label>
            <input
              value={postId}
              onChange={(e) => setPostId(e.target.value)}
              className={field}
              style={fieldStyle}
            />
          </div>
        </div>

        <button
          type="button"
          onClick={fire}
          disabled={busy}
          className="mt-5 w-full rounded-2xl px-4 py-3 text-sm font-semibold text-white transition disabled:opacity-50"
          style={{ backgroundColor: 'var(--fb-primary)' }}
        >
          {busy ? 'Firing webhook…' : 'Simulate comment'}
        </button>

        {result?.acted && (
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
              Private reply prepared
            </p>
            <p
              className="mt-2 text-sm leading-relaxed"
              style={{ color: 'var(--fb-text)' }}
            >
              {result.reply}
            </p>
            <a
              href={result.portalUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-3 block text-xs underline"
              style={{ color: 'var(--fb-primary-dk)' }}
            >
              Open the portal link as the commenter
            </a>
          </div>
        )}

        {result && !result.acted && (
          <p
            className="mt-5 text-sm"
            style={{ color: 'var(--fb-text-soft)' }}
          >
            No action taken: {result.reason}
          </p>
        )}

        <div
          className="mt-8 rounded-xl border px-4 py-3"
          style={{ borderColor: 'var(--fb-border)' }}
        >
          <p
            className="text-xs font-semibold uppercase tracking-wide"
            style={{ color: 'var(--fb-text-soft)' }}
          >
            Where this stops being real
          </p>
          <p
            className="mt-2 text-xs leading-relaxed"
            style={{ color: 'var(--fb-text-soft)' }}
          >
            Sending the DM needs the instagram_manage_messages permission,
            which needs App Review against a live Business account linked to a
            Facebook Page. We build the reply and log it. Point Meta at{' '}
            <code>/api/webhooks/instagram</code> with a valid app secret and
            everything else already works.
          </p>
          <p
            className="mt-2 text-xs leading-relaxed"
            style={{ color: 'var(--fb-text-soft)' }}
          >
            Likes are deliberately not handled. A comment is a question; a like
            is not, and a fertility-clinic DM arriving unprompted on a lock
            screen can out someone.
          </p>
        </div>
      </div>
    </main>
  )
}