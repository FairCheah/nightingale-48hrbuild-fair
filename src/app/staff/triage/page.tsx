import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

/**
 * THE TRIAGE QUEUE.
 *
 * Scenario 18: "07:00, a nurse opens your escalation payload cold. Sister
 * Aminah has eleven minutes before rounds."
 *
 * Before this page existed, escalations were written by escalate.ts and read
 * by nothing. The payload was persisted and unreachable — a record with no
 * reader is not a handoff, it is a filing cabinet nobody has the key to.
 *
 * TWO DELIBERATE CHOICES
 *
 * 1. This page reads through the NURSE'S OWN SESSION, not service_role.
 *    escalations_read already restricts to is_clinical() and
 *    clinic_id = my_clinic_id(), so the database is doing the enforcing and
 *    this page is a live demonstration that the policy is load-bearing rather
 *    than decoration. If RLS were wrong, this page would be empty.
 *
 * 2. Clinical roles only. Staff can see the warm-lead view and act on it
 *    commercially; a receptionist has no business reading someone's
 *    escalation about a lump. This matches clinician_responses_write, which
 *    already restricts replies to is_clinical().
 *
 * ORDERING
 *
 * By response_due_at, soonest first, unresolved before resolved. Not by
 * created_at: the question a nurse with eleven minutes is asking is "who am I
 * closest to failing", and that is a deadline, not an arrival time.
 */
export const metadata = { title: 'Triage queue' }

type Acquisition = {
  source_channel?: string | null
  campaign_id?: string | null
  identity_level?: string | null
  referral_topic?: string | null
}

const RISK_STYLE: { [key: string]: { bg: string; fg: string } } = {
  high: { bg: '#f7e3e1', fg: 'var(--fb-danger)' },
  med: { bg: '#fdeee6', fg: '#a9613f' },
  low: { bg: '#e9f0ec', fg: 'var(--fb-safe)' },
}

function waitedFor(fromIso: string, now: number) {
  const mins = Math.max(0, Math.round((now - new Date(fromIso).getTime()) / 60000))
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ${mins % 60}m`
  return `${Math.floor(hrs / 24)}d ${hrs % 24}h`
}

export default async function TriagePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/staff/triage')

  const { data: me } = await supabase
    .from('app_users')
    .select('role')
    .eq('id', user.id)
    .single()

  const role = me?.role ?? 'patient'
  if (!['nurse', 'clinician'].includes(role)) {
    // Staff see the leads view. Clinical content is not theirs to read.
    redirect('/staff/leads?denied=triage_is_clinical')
  }

  /**
   * No .eq('clinic_id', ...) here, on purpose. The filter is in the policy.
   * Adding it in the query too would hide a broken policy behind a correct
   * query, which is exactly how isolation ends up looking enforced while
   * resting on one line of application code.
   */
  const { data: rows } = await supabase
    .from('escalations')
    .select(
      'id, status, risk_level_at_send, created_at, response_due_at, acknowledged_at, first_response_at, triggering_message_text, acquisition_context, lead_session_id, source_purged_at',
    )
    .order('response_due_at', { ascending: true })

  const now = Date.now()
  const all = rows ?? []

  /**
   * 'responded' is not 'finished'. A reply usually starts a conversation
   * rather than ending one, and dropping the case into a collapsed section
   * the moment a nurse answers means nobody is watching when she replies.
   *
   * Only a clinician closing the case takes it out of the queue. That is
   * also why closing is clinician-only: deciding a concern is over is a
   * clinical judgement, not an inbox action.
   */
  const open = all.filter((r) => r.status !== 'closed')
  const done = all.filter((r) => r.status === 'closed')

  const breached = open.filter(
    (r) => r.response_due_at && new Date(r.response_due_at).getTime() < now,
  ).length

  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      <div className="mb-5">
        <h1
          className="text-lg font-semibold"
          style={{ color: 'var(--fb-text)' }}
        >
          Triage queue
        </h1>
        <p className="mt-1 text-xs" style={{ color: 'var(--fb-text-soft)' }}>
          {open.length} open
          {breached > 0 ? (
            <span style={{ color: 'var(--fb-danger)' }}>
              {' '}
              · {breached} past the 18-hour promise
            </span>
          ) : (
            ' · none past the 18-hour promise'
          )}
        </p>
      </div>

      {open.length === 0 && (
        <div
          className="rounded-lg border px-4 py-8 text-center text-sm"
          style={{
            borderColor: 'var(--fb-border)',
            backgroundColor: 'var(--fb-surface)',
            color: 'var(--fb-text-soft)',
          }}
        >
          Nothing waiting. Anything a patient sends to the clinic appears here.
        </div>
      )}

      <ul className="space-y-2">
        {open.map((row) => {
          const acq = (row.acquisition_context ?? {}) as Acquisition
          const due = row.response_due_at
            ? new Date(row.response_due_at).getTime()
            : null
          const isBreached = due !== null && due < now
          const hoursLeft =
            due === null ? null : Math.round((due - now) / 3600000)
          const risk = RISK_STYLE[row.risk_level_at_send ?? 'low'] ?? RISK_STYLE.low

          return (
            <li key={row.id}>
              <a
                href={`/staff/triage/${row.id}`}
                className="block rounded-lg border px-4 py-3 transition hover:opacity-80"
                style={{
                  borderColor: isBreached
                    ? 'var(--fb-danger)'
                    : 'var(--fb-border)',
                  backgroundColor: 'var(--fb-surface)',
                }}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className="rounded px-2 py-0.5 text-xs font-semibold uppercase"
                    style={{ backgroundColor: risk.bg, color: risk.fg }}
                  >
                    {row.risk_level_at_send ?? 'low'} risk
                  </span>

                  {isBreached ? (
                    <span
                      className="text-xs font-semibold"
                      style={{ color: 'var(--fb-danger)' }}
                    >
                      Overdue by {Math.abs(hoursLeft ?? 0)}h
                    </span>
                  ) : (
                    <span
                      className="text-xs"
                      style={{ color: 'var(--fb-text-soft)' }}
                    >
                      {hoursLeft}h left
                    </span>
                  )}

                  {row.acknowledged_at && (
                    <span
                      className="text-xs"
                      style={{ color: 'var(--fb-safe)' }}
                    >
                      · seen
                    </span>
                  )}

                  <span
                    className="ml-auto text-xs"
                    style={{ color: 'var(--fb-text-soft)' }}
                  >
                    waiting {waitedFor(row.created_at, now)}
                  </span>
                </div>

                <p
                  className="mt-2 text-sm"
                  style={{ color: 'var(--fb-text)' }}
                >
                  {row.source_purged_at
                    ? 'Source conversation has been deleted by retention.'
                    : (row.triggering_message_text ?? '[withheld]')}
                </p>

                <p
                  className="mt-1 text-xs"
                  style={{ color: 'var(--fb-text-soft)' }}
                >
                  {acq.source_channel ?? 'unknown channel'}
                  {acq.campaign_id ? ` · ${acq.campaign_id}` : ''}
                  {' · '}
                  {acq.identity_level === 'email_known'
                    ? 'verified patient'
                    : acq.identity_level === 'handle_only'
                      ? 'social handle only'
                      : 'anonymous'}
                </p>
              </a>
            </li>
          )
        })}
      </ul>

      {done.length > 0 && (
        <details className="mt-6">
          <summary
            className="cursor-pointer text-xs"
            style={{ color: 'var(--fb-text-soft)' }}
          >
            {done.length} closed
          </summary>
          <ul className="mt-2 space-y-1">
            {done.map((row) => (
              <li key={row.id}>
                <a
                  href={`/staff/triage/${row.id}`}
                  className="block rounded border px-3 py-2 text-xs"
                  style={{
                    borderColor: 'var(--fb-border)',
                    backgroundColor: 'var(--fb-surface)',
                    color: 'var(--fb-text-soft)',
                  }}
                >
                  {row.status} ·{' '}
                  {row.source_purged_at
                    ? '[source deleted by retention]'
                    : (row.triggering_message_text ?? '[withheld]')}
                </a>
              </li>
            ))}
          </ul>
        </details>
      )}
    </main>
  )
}
