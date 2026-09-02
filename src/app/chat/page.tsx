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
  const lead = await getGuestSession()

  if (!lead) {
    redirect('/link-invalid?reason=notfound')
  }

  const admin = createAdminClient()

  const { data } = await admin
    .from('messages')
    .select('id, sender, content, created_at, risk_level, escalation_required, risk_reason')
    .eq('lead_session_id', lead.id)
    .order('created_at', { ascending: true })

  const messages = (data ?? []) as ChatMessage[]
    // Live profile. Ordered so the oldest fact appears first within each kind,
  // which keeps a superseded item next to the one that replaced it.
  const { data: memoryRows } = await admin
    .from('memory_items')
    .select('id, kind, value, status, timeline, supersedes')
    .eq('lead_session_id', lead.id)
    .order('created_at', { ascending: true })

  // The banner reflects the most recent assessment, not the whole history —
  // a resolved scare should not leave a red bar pinned forever.
  const latest = [...messages].reverse().find((m) => m.sender === 'guest')

  return (
    <ChatThread
      initialMessages={messages}
      clinicFullName={CLINIC_FULL_NAME}
      activeRisk={latest?.risk_level ?? null}
            memoryItems={(memoryRows ?? []) as MemoryItem[]}
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