'use client'

export interface ChannelStat {
  channel: string
  visitors: number
  conversations: number
  valueEvents: number
  authStarted: number
  consented: number
  patients: number
  escalations: number
}

export interface LeadRow {
  id: string
  channel: string
  campaign: string | null
  identity: string
  topConcern: string | null
  concernHidden: boolean
  lastActive: string
  score: number
  breakdown: {
    recency: number
    identity: number
    stage: number
    channel: number
  }
  isHighRisk: boolean
  escalationStatus: string | null
  converted: boolean
}

function relative(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export default function LeadsView({
  stats,
  leads,
  role,
}: {
  stats: ChannelStat[]
  leads: LeadRow[]
  role: string
}) {
  const isClinical = role === 'nurse' || role === 'clinician'

  return (
    <main className="px-4 py-8">
      <div className="mx-auto w-full max-w-4xl">
        <h1 className="text-xl font-semibold" style={{ color: 'var(--fb-text)' }}>
          Leads and conversion
        </h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--fb-text-soft)' }}>
          {isClinical
            ? 'You can see clinical concerns where the person consented or asked for a nurse.'
            : 'Clinical content is hidden from this role.'}
        </p>

        {/* ---------------------------------------------- funnel metrics */}
        <section className="mt-8">
          <h2
            className="text-xs font-semibold uppercase tracking-wide"
            style={{ color: 'var(--fb-text-soft)' }}
          >
            Conversion by channel
          </h2>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ color: 'var(--fb-text-soft)' }}>
                  <th className="py-2 text-left text-xs font-medium">Channel</th>
                  <th className="py-2 text-right text-xs font-medium">Arrived</th>
                  <th className="py-2 text-right text-xs font-medium">Talked</th>
                  <th className="py-2 text-right text-xs font-medium">Got value</th>
                  <th className="py-2 text-right text-xs font-medium">
                    Started signup
                  </th>
                  <th className="py-2 text-right text-xs font-medium">Consented</th>
                  <th className="py-2 text-right text-xs font-medium">Escalated</th>
                </tr>
              </thead>
              <tbody>
                {stats.map((stat) => (
                  <tr
                    key={stat.channel}
                    className="border-t"
                    style={{ borderColor: 'var(--fb-border)' }}
                  >
                    <td className="py-2" style={{ color: 'var(--fb-text)' }}>
                      {stat.channel}
                    </td>
                    <td
                      className="py-2 text-right"
                      style={{ color: 'var(--fb-text-soft)' }}
                    >
                      {stat.visitors}
                    </td>
                    <td
                      className="py-2 text-right"
                      style={{ color: 'var(--fb-text)' }}
                    >
                      {stat.conversations}
                    </td>
                    <td
                      className="py-2 text-right"
                      style={{ color: 'var(--fb-text-soft)' }}
                    >
                      {stat.valueEvents}
                    </td>
                    <td
                      className="py-2 text-right"
                      style={{ color: 'var(--fb-text-soft)' }}
                    >
                      {stat.authStarted}
                    </td>
                    <td
                      className="py-2 text-right"
                      style={{ color: 'var(--fb-primary-dk)' }}
                    >
                      {stat.consented}
                    </td>
                    <td
                      className="py-2 text-right"
                      style={{ color: 'var(--fb-text-soft)' }}
                    >
                      {stat.escalations}
                    </td>
                  </tr>
                ))}
                {stats.length === 0 && (
                  <tr>
                    <td
                      colSpan={7}
                      className="py-4 text-center text-xs"
                      style={{ color: 'var(--fb-text-soft)' }}
                    >
                      No events yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <p className="mt-2 text-xs" style={{ color: 'var(--fb-text-soft)' }}>
            Every number is a count of persisted funnel events, not an estimate.
            The gap between &quot;got value&quot; and &quot;started signup&quot;
            is where people leave — that is the number worth watching.
          </p>
        </section>

        {/* ------------------------------------------------- warm leads */}
        <section className="mt-10">
          <h2
            className="text-xs font-semibold uppercase tracking-wide"
            style={{ color: 'var(--fb-text-soft)' }}
          >
            Warm leads
          </h2>

          <ul className="mt-3 space-y-2">
            {leads.map((lead) => (
              <li
                key={lead.id}
                className="rounded-xl border px-4 py-3"
                style={{
                  borderColor: lead.isHighRisk
                    ? 'var(--fb-danger)'
                    : 'var(--fb-border)',
                  backgroundColor: lead.isHighRisk
                    ? 'rgba(180, 84, 74, 0.05)'
                    : 'var(--fb-surface)',
                }}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p
                      className="text-sm font-medium"
                      style={{ color: 'var(--fb-text)' }}
                    >
                      {lead.channel}
                      {lead.campaign && (
                        <span style={{ color: 'var(--fb-text-soft)' }}>
                          {' '}
                          · {lead.campaign}
                        </span>
                      )}
                    </p>

                    <p
                      className="mt-0.5 text-xs"
                      style={{ color: 'var(--fb-text-soft)' }}
                    >
                      {lead.identity} · {relative(lead.lastActive)}
                      {lead.converted && ' · patient'}
                      {lead.escalationStatus &&
                        ` · escalation ${lead.escalationStatus}`}
                    </p>

                    {lead.topConcern && (
                      <p
                        className="mt-1.5 text-sm"
                        style={{ color: 'var(--fb-text)' }}
                      >
                        {lead.topConcern}
                      </p>
                    )}

                    {lead.concernHidden && (
                      <p
                        className="mt-1.5 text-xs italic"
                        style={{ color: 'var(--fb-text-soft)' }}
                      >
                        Concern hidden — this person has not consented to the
                        clinic reading what they wrote.
                      </p>
                    )}
                  </div>

                  <div className="shrink-0 text-right">
                    <p
                      className="text-lg font-semibold"
                      style={{ color: 'var(--fb-primary-dk)' }}
                    >
                      {lead.score}
                    </p>
                    <p
                      className="text-xs"
                      style={{ color: 'var(--fb-text-soft)' }}
                    >
                      {lead.breakdown.recency}r · {lead.breakdown.identity}i ·{' '}
                      {lead.breakdown.stage}s · {lead.breakdown.channel}c
                    </p>
                  </div>
                </div>

                {/*
                  §5 SAFETY RULE. High-risk clinical content routes to
                  escalation and never to a sales touch. The score stays
                  visible — it is a compassion priority, not a sales one —
                  but every contact suggestion is suppressed.
                */}
                {lead.isHighRisk ? (
                  <p
                    className="mt-2 border-t pt-2 text-xs font-medium"
                    style={{
                      borderColor: 'var(--fb-border)',
                      color: 'var(--fb-danger)',
                    }}
                  >
                    Clinical priority. Do not contact for marketing. Handle
                    through the escalation queue.
                  </p>
                ) : (
                  <p
                    className="mt-2 border-t pt-2 text-xs"
                    style={{
                      borderColor: 'var(--fb-border)',
                      color: 'var(--fb-text-soft)',
                    }}
                  >
                    {lead.converted
                      ? 'Contactable — consent on file.'
                      : 'No contact details and no consent. Nothing to send.'}
                  </p>
                )}
              </li>
            ))}

            {leads.length === 0 && (
              <li className="text-xs" style={{ color: 'var(--fb-text-soft)' }}>
                No active leads.
              </li>
            )}
          </ul>

          <p
            className="mt-3 text-xs leading-relaxed"
            style={{ color: 'var(--fb-text-soft)' }}
          >
            Score is recency + identity level + funnel stage + channel, shown
            broken down so anyone can see why a lead ranks where it does. No
            weighting the reader cannot check.
          </p>
        </section>
      </div>
    </main>
  )
}