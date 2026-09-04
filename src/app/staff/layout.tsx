import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { CLINIC_SHORT_NAME } from '@/lib/guest'

/**
 * Shared chrome for every staff page.
 *
 * The role check is deliberately duplicated here even though proxy.ts already
 * gates /staff/*. Defence in depth: if the proxy matcher were ever narrowed by
 * accident, this layer still refuses, and RLS refuses underneath that. No
 * single layer is trusted alone.
 *
 * Putting the nav here rather than in each page means a new staff page is
 * consistent by default rather than by remembering.
 */
export default async function StaffLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login?next=/staff/leads')

  const { data: profile } = await supabase
    .from('app_users')
    .select('role')
    .eq('id', user.id)
    .single()

  const role = profile?.role ?? 'patient'
  if (!['staff', 'nurse', 'clinician'].includes(role)) {
    redirect('/?denied=staff_area')
  }

  return (
    <div className="min-h-dvh bg-[var(--fb-bg)]">
      <header
        className="border-b"
        style={{
          borderColor: 'var(--fb-border)',
          backgroundColor: 'var(--fb-surface)',
        }}
      >
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div>
            <p
              className="text-sm font-semibold"
              style={{ color: 'var(--fb-text)' }}
            >
              {CLINIC_SHORT_NAME}
            </p>
            <p className="text-xs" style={{ color: 'var(--fb-text-soft)' }}>
              Care team console · signed in as {role}
            </p>
          </div>

          <nav className="flex flex-wrap items-center gap-4 text-xs">
            {['nurse', 'clinician'].includes(role) && (
              <a
                href="/staff/triage"
                className="underline"
                style={{ color: 'var(--fb-text)' }}
              >
                Triage
              </a>
            )}
            <a
              href="/staff/leads"
              className="underline"
              style={{ color: 'var(--fb-text-soft)' }}
            >
              Leads
            </a>
            <a
              href="/staff/referral"
              className="underline"
              style={{ color: 'var(--fb-text-soft)' }}
            >
              Referral
            </a>
            <a
              href="/staff/social"
              className="underline"
              style={{ color: 'var(--fb-text-soft)' }}
            >
              Social
            </a>
            <a
              href="/logout"
              className="underline"
              style={{ color: 'var(--fb-danger)' }}
            >
              Sign out
            </a>
          </nav>
        </div>
      </header>

      {children}
    </div>
  )
}