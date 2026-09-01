'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Creates a staff_referral LeadSession and returns its portal link.
 *
 * Authorisation is checked here, server-side, before any write.
 * The admin client is used for the insert because a LeadSession
 * belongs to no authenticated user — the future patient has no
 * account yet. That is the guest model: guests never touch the
 * database directly, the server acts on their behalf.
 */
export async function createReferralLink(topic: string) {
  const trimmed = topic.trim()

  if (!trimmed) {
    return { error: 'Please enter what the patient asked about.' }
  }
  if (trimmed.length > 200) {
    return { error: 'Keep the topic under 200 characters.' }
  }

  // 1. Who is asking?
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Not signed in.' }
  }

  const { data: profile } = await supabase
    .from('app_users')
    .select('id, role, clinic_id')
    .eq('id', user.id)
    .single()

  if (!profile || !['staff', 'nurse', 'clinician'].includes(profile.role)) {
    return { error: 'You do not have permission to create referral links.' }
  }

  // 2. Create the LeadSession with full attribution.
  const admin = createAdminClient()

  const { data: lead, error: leadError } = await admin
    .from('lead_sessions')
    .insert({
      clinic_id: profile.clinic_id,
      source_channel: 'staff_referral',
      identity_level: 'anonymous',
      referral_topic: trimmed,
      referred_by: profile.id,
      campaign_id: 'in_clinic_visit',
    })
    .select('id, recovery_token')
    .single()

  if (leadError || !lead) {
    console.error('LEAD INSERT FAILED:', leadError)
    return { error: 'Could not create the link. Please try again.' }
  }

  // 3. Funnel event: a visitor now exists.
  await admin.from('events').insert({
    clinic_id: profile.clinic_id,
    lead_session_id: lead.id,
    event_type: 'visitor',
    event_detail: { source: 'staff_referral', created_by_role: profile.role },
  })

  // 4. Audit log — PHI-free: ids and metadata only, never the topic text.
  await admin.from('audit_logs').insert({
    actor_id: profile.id,
    actor_role: profile.role,
    action: 'lead_session.created',
    resource_type: 'lead_session',
    resource_id: lead.id,
    metadata: { source_channel: 'staff_referral', topic_length: trimmed.length },
  })

  return {
    token: lead.recovery_token as string,
    leadSessionId: lead.id as string,
  }
}