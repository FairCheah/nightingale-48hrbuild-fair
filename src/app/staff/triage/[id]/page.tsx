import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import ReplyBox from './ReplyBox'
import CloseCase from './CloseCase'


/**
 * ONE ESCALATION, READ COLD.
 *
 * Scenario 18: Sister Aminah has eleven minutes before rounds and needs the
 * presenting complaint, risk level and why, medications with corrections
 * intact, contradiction flags, and the triggering excerpt — without asking
 * the patient to repeat herself.
 *
 * The ordering on this page is that list, in that order, because it is the
 * order she needs it in and not the order the schema stores it in.
 *
 * CORRECTIONS ARE SHOWN, NOT RESOLVED AWAY.
 *
 * Scenario 16: "Advil, stopped last week" is one clinical fact — NSAID
 * trialled, discontinued — and it changes the prescription. Showing only the
 * current state throws away the half that matters. So the superseded values
 * are rendered next to what replaced them.
 *
 * CONTRADICTIONS ARE FLAGGED, NOT PICKED.
 *
 * Scenario 19: "no known allergies at 14:02, penicillin gave me a rash at
 * 14:09". Last-write-wins is safe in that order and lethal in the reverse.
 * In the risk-bearing kinds — allergy, medication, bleeding — this page
 * refuses to decide. It shows both and says a human must resolve it. Anywhere
 * else, the latest value stands.
 */

type Fact = {
  id: string
  kind: string
  value: string
  status: string
  timeline?: string | null
  provenance_pointer?: string | null
}

type Snapshot = {
  captured_at?: string
  current?: Fact[]
  superseded?: Fact[]
}

type Acquisition = {
  source_channel?: string | null
  campaign_id?: string | null
  creative?: string | null
  identity_level?: string | null
  referral_topic?: string | null
  page_context?: string | null
  landing_timestamp?: string | null
}

const KIND_LABEL: { [key: string]: string } = {
  chief_complaint: 'Presenting complaint',
  symptom: 'Symptoms',
  medication: 'Medications',
  allergy: 'Allergies',
}

// Kinds where a wrong resolution injures. Nothing here is auto-resolved.
const RISK_BEARING = ['allergy', 'medication', 'symptom']

export default async function EscalationDetail({
  params,
}: {
  params: Promise <{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect(`/login?next=/staff/triage/${id}`)

  const { data: me } = await supabase
    .from('app_users')
    .select('role, display_name')
    .eq('id', user.id)
    .single()

  const role = me?.role ?? 'patient'
  if (!['nurse', 'clinician'].includes(role)) {
    redirect('/staff/leads?denied=triage_is_clinical')
  }

  // Read through RLS. A nurse from another clinic gets nothing here, and that
  // refusal comes from escalations_read, not from this file.
  const { data: esc } = await supabase
    .from('escalations')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (!esc) notFound()

  const { data: replies } = await supabase
    .from('clinician_responses')
    .select('id, responder_name, responder_role, body, created_at, read_at')
    .eq('escalation_id', id)
    .order('created_at', { ascending: true })

  // Contact details, only where a patient exists. An anonymous guest has none,
  // and the page says so rather than showing an empty box.
  let contact: { email: string | null; phone: string | null } | null = null
  if (esc.patient_session_id) {
    const { data: ps } = await supabase
      .from('patient_sessions')
      .select('patient_id')
      .eq('id', esc.patient_session_id)
      .maybeSingle()

    if (ps?.patient_id) {
      const { data: p } = await supabase
        .from('app_users')
        .select('email, phone')
        .eq('id', ps.patient_id)
        .maybeSingle()
      if (p) contact = { email: p.email ?? null, phone: p.phone ?? null }
    }
  }

  const snap = (esc.profile_snapshot ?? {}) as Snapshot
  const acq = (esc.acquisition_context ?? {}) as Acquisition
  const current = snap.current ?? []
  const superseded = snap.superseded ?? []

  const now = Date.now()
  const due = esc.response_due_at ? new Date(esc.response_due_at).getTime() : null
  const overdue = due !== null && due < now && !esc.first_response_at
  const hours = due === null ? null : Math.round(Math.abs(due - now) / 3600000)

  // Contradiction detection: two live values in a kind where being wrong hurts.
  const contradictions = RISK_BEARING.map((kind) => {
    const live = current.filter((f) => f.kind === kind)
    return live.length > 1 ? { kind, values: live } : null
  }).filter(Boolean) as { kind: string; values: Fact[] }[]

  const kinds = ['chief_complaint', 'symptom', 'medication', 'allergy']

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <a
        href="/staff/triage"
        className="text-xs underline"
        style={{ color: 'var(--fb-text-soft)' }}
      >
        Back to queue
      </a>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span
          className="rounded px-2 py-0.5 text-xs font-semibold uppercase"
          style={{
            backgroundColor:
              esc.risk_level_at_send === 'high' ? '#f7e3e1' : '#fdeee6',
            color:
              esc.risk_level_at_send === 'high'
                ? 'var(--fb-danger)'
                : '#a9613f',
          }}
        >
          {esc.risk_level_at_send ?? 'low'} risk
        </span>

        {esc.first_response_at ? (
          <span className="text-xs" style={{ color: 'var(--fb-safe)' }}>
            Answered
          </span>
        ) : overdue ? (
          <span
            className="text-xs font-semibold"
            style={{ color: 'var(--fb-danger)' }}
          >
            Overdue by {hours}h — the patient was promised 12 to 18 hours
          </span>
        ) : (
          <span className="text-xs" style={{ color: 'var(--fb-text-soft)' }}>
            {hours}h left of the 18-hour promise
          </span>
        )}
      </div>

      {esc.source_purged_at && (
        <p
          className="mt-3 rounded border px-3 py-2 text-xs"
          style={{
            borderColor: 'var(--fb-border)',
            backgroundColor: 'var(--fb-muted)',
            color: 'var(--fb-text)',
          }}
        >
          The source conversation has since been deleted under the 14-day
          retention policy. What follows is the snapshot taken when she sent
          it; the original messages no longer exist.
        </p>
      )}

      {contradictions.length > 0 && (
        <div
          className="mt-3 rounded border px-3 py-2"
          style={{
            borderColor: 'var(--fb-danger)',
            backgroundColor: '#f7e3e1',
          }}
        >
          <p
            className="text-xs font-semibold"
            style={{ color: 'var(--fb-danger)' }}
          >
            Unresolved contradiction — needs a human decision
          </p>
          {contradictions.map((c) => (
            <p
              key={c.kind}
              className="mt-1 text-xs"
              style={{ color: 'var(--fb-text)' }}
            >
              {KIND_LABEL[c.kind] ?? c.kind}:{' '}
              {c.values.map((v) => v.value).join('  vs  ')}
            </p>
          ))}
          <p className="mt-1 text-xs" style={{ color: 'var(--fb-text-soft)' }}>
            Nightingale did not pick a winner. In allergies, medications and
            bleeding, resolving by recency is safe in one order and dangerous
            in the other.
          </p>
        </div>
      )}

      {/* 1. What she said, verbatim and redacted. */}
      <section className="mt-5">
        <h2
          className="text-xs font-semibold uppercase"
          style={{ color: 'var(--fb-text-soft)' }}
        >
          What triggered this
        </h2>
        <p
          className="mt-1 rounded border px-3 py-2 text-sm"
          style={{
            borderColor: 'var(--fb-border)',
            backgroundColor: 'var(--fb-surface)',
            color: 'var(--fb-text)',
          }}
        >
          {esc.triggering_message_text ?? '[withheld]'}
        </p>
      </section>

      {/* 2. The summary, generated with anti-inference rules. */}
      {esc.triage_summary && (
        <section className="mt-4">
          <h2
            className="text-xs font-semibold uppercase"
            style={{ color: 'var(--fb-text-soft)' }}
          >
            Triage summary
          </h2>
          <pre
            className="mt-1 whitespace-pre-wrap rounded border px-3 py-2 text-sm"
            style={{
              borderColor: 'var(--fb-border)',
              backgroundColor: 'var(--fb-surface)',
              color: 'var(--fb-text)',
              fontFamily: 'inherit',
            }}
          >
            {esc.triage_summary}
          </pre>
        </section>
      )}

      {/* 3. The profile, with corrections kept visible. */}
      <section className="mt-4">
        <h2
          className="text-xs font-semibold uppercase"
          style={{ color: 'var(--fb-text-soft)' }}
        >
          Profile at the moment she sent it
        </h2>

        <div
          className="mt-1 rounded border px-3 py-2"
          style={{
            borderColor: 'var(--fb-border)',
            backgroundColor: 'var(--fb-surface)',
          }}
        >
          {current.length === 0 && (
            <p className="text-sm" style={{ color: 'var(--fb-text-soft)' }}>
              No structured facts were extracted.
            </p>
          )}

          {kinds.map((kind) => {
            const live = current.filter((f) => f.kind === kind)
            const gone = superseded.filter((f) => f.kind === kind)
            if (live.length === 0 && gone.length === 0) return null

            return (
              <div key={kind} className="mb-2 last:mb-0">
                <p
                  className="text-xs font-semibold uppercase"
                  style={{ color: 'var(--fb-text-soft)' }}
                >
                  {KIND_LABEL[kind] ?? kind}
                </p>

                {live.map((f) => (
                  <p
                    key={f.id}
                    className="text-sm"
                    style={{ color: 'var(--fb-text)' }}
                  >
                    {f.value}
                    {f.timeline ? ` — ${f.timeline}` : ''}
                    {f.status !== 'active' ? ` (${f.status})` : ''}
                  </p>
                ))}

                {gone.map((f) => (
                  <p
                    key={f.id}
                    className="text-xs line-through"
                    style={{ color: 'var(--fb-text-soft)' }}
                  >
                    {f.value}
                    {f.timeline ? ` — ${f.timeline}` : ''} · corrected by the
                    patient
                  </p>
                ))}
              </div>
            )
          })}
        </div>
      </section>

      {/* 4. Where she came from. identity_level is the one a clinician needs. */}
      <section className="mt-4">
        <h2
          className="text-xs font-semibold uppercase"
          style={{ color: 'var(--fb-text-soft)' }}
        >
          How she reached us
        </h2>
        <div
          className="mt-1 rounded border px-3 py-2 text-xs"
          style={{
            borderColor: 'var(--fb-border)',
            backgroundColor: 'var(--fb-surface)',
            color: 'var(--fb-text)',
          }}
        >
          <p>
            {acq.source_channel ?? 'unknown'}
            {acq.campaign_id ? ` · campaign ${acq.campaign_id}` : ''}
            {acq.creative ? ` · ${acq.creative}` : ''}
          </p>
          <p className="mt-1">
            Identity:{' '}
            {acq.identity_level === 'email_known'
              ? 'verified patient — email confirmed at signup'
              : acq.identity_level === 'handle_only'
                ? 'social handle only — not a verified identity'
                : 'anonymous — no verified identity'}
          </p>
          {acq.referral_topic && (
            <p className="mt-1">Staff referral: {acq.referral_topic}</p>
          )}
        </div>
      </section>

      {/* 5. Reaching her. Honest when there is no route. */}
      <section className="mt-4">
        <h2
          className="text-xs font-semibold uppercase"
          style={{ color: 'var(--fb-text-soft)' }}
        >
          Contacting her
        </h2>
        <div
          className="mt-1 rounded border px-3 py-2 text-xs"
          style={{
            borderColor: 'var(--fb-border)',
            backgroundColor: 'var(--fb-surface)',
            color: 'var(--fb-text)',
          }}
        >
          {contact?.email || contact?.phone ? (
            <div className="flex flex-wrap gap-3">
              {contact.email && (
                <a
                  className="underline"
                  style={{ color: 'var(--fb-primary-dk)' }}
                  href={`mailto:${contact.email}`}
                >
                  Email {contact.email}
                </a>
              )}
              {contact.phone && (
                <a
                  className="underline"
                  style={{ color: 'var(--fb-primary-dk)' }}
                  href={`https://wa.me/${contact.phone.replace(/[^0-9]/g, '')}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  WhatsApp {contact.phone}
                </a>
              )}
            </div>
          ) : (
            <p style={{ color: 'var(--fb-text-soft)' }}>
              She has not given a contact route. Replying below reaches her in
              the conversation itself, which is the only channel she agreed to.
            </p>
          )}
        </div>
      </section>

      {/* 6. The thread. */}
      {(replies ?? []).length > 0 && (
        <section className="mt-4">
          <h2
            className="text-xs font-semibold uppercase"
            style={{ color: 'var(--fb-text-soft)' }}
          >
            Replies
          </h2>
          {(replies ?? []).map((r) => (
            <div
              key={r.id}
              className="mt-1 rounded border px-3 py-2"
              style={{
                borderColor: 'var(--fb-border)',
                backgroundColor: 'var(--fb-surface)',
              }}
            >
              <p className="text-xs" style={{ color: 'var(--fb-text-soft)' }}>
                {r.responder_name} · {r.responder_role} ·{' '}
                {new Date(r.created_at).toLocaleString()}
                {r.read_at ? ' · read' : ' · not yet read'}
              </p>
              <p className="mt-1 text-sm" style={{ color: 'var(--fb-text)' }}>
                {r.body}
              </p>
            </div>
          ))}
        </section>
      )}

      {esc.status === 'closed' ? (
        <section
          className="mt-6 rounded border px-3 py-3"
          style={{
            borderColor: 'var(--fb-border)',
            backgroundColor: 'var(--fb-surface)',
          }}
        >
          <p
            className="text-xs font-semibold uppercase"
            style={{ color: 'var(--fb-text-soft)' }}
          >
            Closed
          </p>
          <p className="mt-1 text-sm" style={{ color: 'var(--fb-text)' }}>
            {esc.closure_reason ?? 'no reason recorded'}
            {esc.closed_by_name ? ` · ${esc.closed_by_name}` : ''}
          </p>
          {esc.closure_note && (
            <p className="mt-1 text-sm" style={{ color: 'var(--fb-text)' }}>
              {esc.closure_note}
            </p>
          )}
        </section>
      ) : (
        <>
          <ReplyBox
            escalationId={id}
            acknowledged={Boolean(esc.acknowledged_at)}
            responderName={me?.display_name ?? role}
          />
          <CloseCase escalationId={id} isClinician={role === 'clinician'} />
        </>
      )}
    </main>
  )
}
