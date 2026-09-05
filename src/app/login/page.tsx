'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      // Deliberately generic: never reveal whether an account exists.
      setError('Those details did not match an account.')
      setLoading(false)
      return
    }

    /**
     * /resume decides where to go, because only the server knows the role.
     * This used to default to /staff/referral for everyone, so a patient
     * logging in was immediately bounced by the proxy with denied=staff_area.
     */
    const next = searchParams.get('next') ?? '/resume'
    router.push(next)
    router.refresh()
  }

  return (
    <form onSubmit={handleLogin} className="space-y-4">
      <div>
        <label htmlFor="email" className="block text-sm text-stone-700 mb-1">
          Email
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-lg border border-stone-300 px-3 py-2
                     text-stone-900 focus:outline-none focus:ring-2
                     focus:ring-rose-300"
        />
      </div>

      <div>
        <label htmlFor="password" className="block text-sm text-stone-700 mb-1">
          Password
        </label>
        <input
          id="password"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-lg border border-stone-300 px-3 py-2
                     text-stone-900 focus:outline-none focus:ring-2
                     focus:ring-rose-300"
        />
      </div>

      {error && (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-lg bg-rose-600 px-4 py-2 text-white
                   font-medium hover:bg-rose-700 disabled:opacity-50"
      >
        {loading ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  )
}

export default function LoginPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-stone-50 p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-stone-900">Fairbloom</h1>
          <p className="text-sm text-stone-500 mt-1">
            Fertility &amp; Women&apos;s Health — care team sign in
          </p>
        </div>

        {/* Suspense is required: useSearchParams needs a boundary
            or the production build fails to prerender. */}
        <Suspense fallback={<p className="text-sm text-stone-400">Loading…</p>}>
          <LoginForm />
        </Suspense>

        <p className="mt-8 text-xs text-stone-400">
          Synthetic test environment. No real patient data.
        </p>
      </div>
    </main>
  )
}