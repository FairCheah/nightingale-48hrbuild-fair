import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import LeadsView, { type LeadRow, type ChannelStat } from './LeadsView'

export const metadata = { title: 'Leads — Fairbloom staff' }

/**
 * §5 — funnel metrics per channel, and the warm-lead view.
 *
 * Role-gated twice: the proxy blocks non-staff from /staff/*, and this page
 * reads the caller's role again to decide what it may show. Staff see
 * acquisition data; only nurses and clinicians see clinical content and
 * contact details, and only where the person consented or asked for a human.
 */
export default async function LeadsPage() {
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

  const isClinical = role === 'nurse' || role === 'clinician'

  const admin = createAdminClient()

  // ---- Funnel metrics per channel -------------------------------------
  const { data: events } = await admin
    .from('events')
    .select('event_type, event_detail')

  const byChannel = new Map<string, Record<string, number>>()

  for (const event of events ?? []) {
    const detail = event.event_detail as { source_channel?: string } | null
    const channel = detail?.source_channel ?? 'unknown'
    const row = byChannel.get(channel) ?? {}
    row[event.event_type] = (row[event.event_type] ?? 0) + 1
    byChannel.set(channel, row)
  }

  const stats: ChannelStat[] = [...byChannel.entries()]
    .map(([channel, counts]) => ({
      channel,
      visitors: counts.visitor ?? 0,
      conversations: counts.conversation_started ?? 0,
      valueEvents: counts.value_event ?? 0,
      authStarted: counts.auth_started ?? 0,
      consented: counts.consented ?? 0,
      patients: counts.patient_created ?? 0,
      escalations: counts.escalation_sent ?? 0,
    }))
    .sort((a, b) => b.conversations - a.conversations)

  // ---- Warm leads ------------------------------------------------------
  const { data: leadRows } = await admin
    .from('lead_sessions')
    .select(
      'id, source_channel, identity_level, top_concern, last_active_at, landing_timestamp, lifecycle_status, staff_visible, campaign_id',
    )
    .neq('lifecycle_status', 'suppressed')
    .order('last_active_at', { ascending: false })
    .limit(40)

  const leadIds = (leadRows ?? []).map((l) => l.id)

  const { data: escalationRows } = await admin
    .from('escalations')
    .select('lead_session_id, risk_level_at_send, status')
    .in('lead_session_id', leadIds.length ? leadIds : ['none'])

  const { data: converted } = await admin
    .from('patient_sessions')
    .select('lead_session_id, patient_id, marketing_consent')
    .in('lead_session_id', leadIds.length ? leadIds : ['none'])

  /**
   * Contact details, per §5: "Contact suggestions only where contact info and
   * consent exist." Looked up only for converted sessions — an anonymous
   * guest has no contact point and no consent, so there is nothing to fetch.
   *
   * Restricted to clinical roles. Reception and marketing get the funnel, not
   * the phone number: knowing a lead converted is an acquisition fact, being
   * able to ring them about a fertility enquiry is a clinical one.
   */
  const patientIds = (converted ?? [])
    .map((p) => p.patient_id)
    .filter((id): id is string => Boolean(id))

  const { data: contactRows } =
    isClinical && patientIds.length
      ? await admin.from('app_users').select('id, email, phone').in('id', patientIds)
      : { data: null }

  const contactsByPatient = new Map((contactRows ?? []).map((c) => [c.id, c]))

  const escalated = new Map(
    (escalationRows ?? []).map((e) => [e.lead_session_id, e]),
  )
  const convertedIds = new Set((converted ?? []).map((p) => p.lead_session_id))
  const sessionByLead = new Map(
    (converted ?? []).map((p) => [p.lead_session_id, p]),
  )

  const now = Date.now()

  const leads: LeadRow[] = (leadRows ?? []).map((lead) => {
    const escalation = escalated.get(lead.id)
    const isHighRisk = escalation?.risk_level_at_send === 'high'

    /**
     * A transparent score, deliberately readable rather than clever. Each
     * component is shown in the UI so a staff member can see why a lead
     * ranks where it does.
     */
    const hoursSince =
      (now - new Date(lead.last_active_at).getTime()) / (1000 * 60 * 60)
    const recency =
      hoursSince < 1 ? 40 : hoursSince < 24 ? 25 : hoursSince < 72 ? 10 : 0
    const identity =
      lead.identity_level === 'email_known'
        ? 20
        : lead.identity_level === 'handle_only'
          ? 10
          : 0
    const stage = convertedIds.has(lead.id) ? 30 : escalation ? 25 : 10
    const channel = lead.source_channel === 'staff_referral' ? 15 : 5

    const session = sessionByLead.get(lead.id)
    const contactRow = session?.patient_id
      ? contactsByPatient.get(session.patient_id)
      : undefined

    return {
      id: lead.id,
      channel: lead.source_channel,
      campaign: lead.campaign_id,
      identity: lead.identity_level,
      // Clinical content only for clinical roles, and only where the person
      // consented or asked for a human.
      topConcern: isClinical && lead.staff_visible ? lead.top_concern : null,
      concernHidden:
        Boolean(lead.top_concern) && !(isClinical && lead.staff_visible),
      lastActive: lead.last_active_at,
      score: recency + identity + stage + channel,
      breakdown: { recency, identity, stage, channel },
      /**
       * THE SAFETY RULE (§5). High-risk clinical content routes to
       * escalation and never to a sales touch. This flag suppresses every
       * contact suggestion on the row — a person in crisis is a compassion
       * priority, not a lead.
       */
      isHighRisk,
      escalationStatus: escalation?.status ?? null,
      converted: convertedIds.has(lead.id),
      contact: contactRow
        ? {
            email: (contactRow.email as string | null) ?? null,
            phone: (contactRow.phone as string | null) ?? null,
            marketingConsent: Boolean(session?.marketing_consent),
          }
        : null,
    }
  })

  leads.sort((a, b) => b.score - a.score)

  return <LeadsView stats={stats} leads={leads} role={role} />
}