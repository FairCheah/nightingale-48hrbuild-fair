import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { getGuestSession, CLINIC_FULL_NAME, CLINIC_SHORT_NAME } from '@/lib/guest'
import ContinueForm from './ContinueForm'

export const metadata = { title: 'Continue securely' }

export default async function ContinuePage() {
  const lead = await getGuestSession()
  if (!lead) redirect('/link-invalid?reason=notfound')

  const admin = createAdminClient()

  // Show them exactly what would move. The brief says "migrate PERMITTED
  // guest context" — permission is not meaningful if the person cannot see
  // what they are permitting.
  const { data: facts } = await admin
    .from('memory_items')
    .select('id, kind, value, status, timeline, supersedes')
    .eq('lead_session_id', lead.id)
    .order('created_at', { ascending: true })

  const { count: messageCount } = await admin
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('lead_session_id', lead.id)

  const { data: openCase } = await admin
    .from('escalations')
    .select('id')
    .eq('lead_session_id', lead.id)
    .in('status', ['pending', 'in_review'])
    .limit(1)
    .maybeSingle()

  const items = facts ?? []
  const supersededIds = new Set(
    items.map((i) => i.supersedes).filter(Boolean),
  )
  const current = items.filter((i) => !supersededIds.has(i.id))

  return (
    <ContinueForm
      clinicFullName={CLINIC_FULL_NAME}
      clinicShortName={CLINIC_SHORT_NAME}
      messageCount={messageCount ?? 0}
      facts={current.map((f) => ({
        kind: f.kind,
        value: f.value,
        status: f.status,
        timeline: f.timeline,
      }))}
      hasOpenEscalation={Boolean(openCase)}
      sourceChannel={lead.source_channel}
    />
  )
}