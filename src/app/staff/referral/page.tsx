'use client'

import { useState } from 'react'
import { createReferralLink } from './actions'

export default function StaffReferralPage() {
  const [topic, setTopic] = useState('')
  const [link, setLink] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setLink(null)
    setCopied(false)

    const result = await createReferralLink(topic)

    if ('error' in result && result.error) {
      setError(result.error)
    } else if ('token' in result) {
      setLink(`${window.location.origin}/start/${result.token}`)
    }
    setLoading(false)
  }

  async function copyLink() {
    if (!link) return
    await navigator.clipboard.writeText(link)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <main>
      <div className="mx-auto max-w-2xl px-6 py-10">
        <h1 className="text-xl font-semibold text-stone-900">
          Create a patient link
        </h1>
        <p className="mt-2 text-sm text-stone-600 leading-relaxed">
          After a visit or a phone call, note what the patient asked about.
          The link opens Nightingale with that topic already loaded, so they
          do not have to explain it again.
        </p>

        <form onSubmit={handleSubmit} className="mt-8 space-y-4">
          <div>
            <label htmlFor="topic" className="block text-sm font-medium text-stone-700 mb-2">
              What did they ask about?
            </label>
            <input
              id="topic"
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="asked about egg freezing at today's visit"
              maxLength={200}
              className="w-full rounded-lg border border-stone-300 px-3 py-2.5 text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-rose-300"
            />
            <p className="mt-1.5 text-xs text-stone-400">
              A short topic, not a sentence. Avoid names, IC numbers, or anything
              identifying — the patient sees this quoted back to them.
            </p>
          </div>

          {error && (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || !topic.trim()}
            className="rounded-lg bg-rose-600 px-4 py-2.5 text-white font-medium hover:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? 'Creating...' : 'Generate patient link'}
          </button>
        </form>

        {link && (
          <div className="mt-8 rounded-xl border border-stone-200 bg-white p-5">
            <p className="text-sm font-medium text-stone-900">Link ready</p>
            <p className="mt-1 text-xs text-stone-500">
              Send this to the patient. It opens already knowing the topic.
            </p>

            <div className="mt-4 flex gap-2">
              <code className="flex-1 truncate rounded-lg bg-stone-100 px-3 py-2 text-xs text-stone-700">
                {link}
              </code>
              <button
                onClick={copyLink}
                className="shrink-0 rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-700 hover:bg-stone-50"
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <a
            
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-block text-sm text-rose-600 hover:underline"
            >
              Open it yourself to check
            </a>
          </div>
        )}
      </div>
    </main>
  )
}