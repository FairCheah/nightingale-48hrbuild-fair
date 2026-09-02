import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { getGuestSession, CLINIC_FULL_NAME } from '@/lib/guest'
import ChatThread, { type ChatMessage } from './ChatThread'
import { type MemoryItem } from './ProfilePanel'

/**
 * Neutral title by design. The clinic is named prominently inside the
 * conversation, but "Fairbloom Fertility" sitting in a shared device's
 * browser history or tab strip is a privacy leak the visitor never chose.
 */
export const metadata = {
  title: 'Secure message',
}

export default async function ChatPage() {
  /**
   * After conversion the guest cookie still resolves, and the messages were
   * relinked rather than copied — so this same lead_session_id query returns
   * the full history. The thread simply continues. That is the point of §4:
   * the patient never repeats what they already said.
   */
  const lead = await getGuestSession()

  if (!lead) {
    redirect('/link-invalid?reason=notfound')
  }

  const admin = createAdminClient()

  const { data } = await admin
    .from('messages')
    .select(
      'id, sender, content, created_at, risk_level, escalation_required, risk_reason',
    )
    .eq('lead_session_id', lead.id)
    .order('created_at', { ascending: true })

  const messages = (data ?? []) as ChatMessage[]

  // Live profile, oldest first within each kind, so a superseded item sits
  // next to the one that replaced it.
  const { data: memoryRows } = await admin
    .from('memory_items')
    .select('id, kind, value, status, timeline, supersedes')
    .eq('lead_session_id', lead.id)
    .order('created_at', { ascending: true })

  // The banner reflects the most recent assessment, not the whole history —
  // a resolved scare should not leave a red bar pinned forever.
  const latest = [...messages].reverse().find((m) => m.sender === 'guest')

  // Has a case already been opened? A second press must not create a second.
  const { data: openCase } = await admin
    .from('escalations')
    .select('id')
    .eq('lead_session_id', lead.id)
    .in('status', ['pending', 'in_review'])
    .limit(1)
    .maybeSingle()

  /**
   * Who is this now? After conversion the same cookie resolves, but the
   * person is a patient and the interface should say so. Someone who has
   * just handed over their details deserves to see that it registered.
   */
  const { data: patientSession } = await admin
    .from('patient_sessions')
    .select('id, patient_id')
    .eq('lead_session_id', lead.id)
    .limit(1)
    .maybeSingle()

  let patientEmail: string | null = null

  if (patientSession?.patient_id) {
    const { data: patientUser } = await admin
      .from('app_users')
      .select('email')
      .eq('id', patientSession.patient_id)
      .maybeSingle()

    patientEmail = patientUser?.email ?? null
  }

  return (
    <ChatThread
      initialMessages={messages}
      clinicFullName={CLINIC_FULL_NAME}
      activeRisk={latest?.risk_level ?? null}
      memoryItems={(memoryRows ?? []) as MemoryItem[]}
      canEscalate={Boolean(latest?.escalation_required) && !openCase}
      alreadyEscalated={Boolean(openCase)}
      patientEmail={patientEmail}
      /* Trigger per §4: real value delivered, not page landing. Gone once
         they have converted — there is nothing left to invite them to. */
      showInvite={
        !patientSession &&
        (messages.filter((m) => m.sender === 'ai').length >= 2 ||
          Boolean(openCase))
      }
      activeScope={
        latest?.risk_reason?.includes('ambiguous_cardiac') ||
        latest?.risk_reason?.includes('ambiguous_neuro')
          ? 'out_of_scope'
          : latest?.risk_reason?.includes('severe_pain')
            ? 'unclear'
            : 'in_scope'
      }
    />
  )
}