import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { getGuestSession, CLINIC_FULL_NAME } from '@/lib/guest'
import ChatThread, { type ChatMessage } from './ChatThread'

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
    .select('id, sender, content, created_at')
    .eq('lead_session_id', lead.id)
    .order('created_at', { ascending: true })

  return (
    <ChatThread
      initialMessages={(data ?? []) as ChatMessage[]}
      clinicFullName={CLINIC_FULL_NAME}
    />
  )
}