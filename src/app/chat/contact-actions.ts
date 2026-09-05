'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getGuestSession } from '@/lib/guest'

/**
 * How she wants to be reached, asked AFTER the case is already sent.
 *
 * Nothing here gates the escalation. If she declines, the nurse's reply
 * still lands in her conversation and she still returns by link — that path
 * always existed, it was just never explained to her.
 */
export async function saveContactPreference(input: {
  preference: string
  email?: string
  phone?: string
}) {
  const valid = ['email', 'whatsapp', 'in_conversation']
  if (!valid.includes(input.preference)) {
    return { error: 'Choose how you would like to be reached.' }
  }

  const lead = await getGuestSession()
  if (!lead) return { error: 'expired' }

  const email = (input.email ?? '').trim()
  const phone = (input.phone ?? '').trim()

  // Only require a detail for the routes that need one. "I'll check back
  // here" is a complete answer on its own.
  if (input.preference === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { error: 'That email address does not look right.' }
  }
  if (input.preference === 'whatsapp' && phone.replace(/\D/g, '').length < 8) {
    return { error: 'That number does not look right.' }
  }

  const admin = createAdminClient()

  await admin
    .from('lead_sessions')
    .update({
      volunteered_email: input.preference === 'email' ? email : null,
      volunteered_phone: input.preference === 'whatsapp' ? phone : null,
      contact_preference: input.preference,
      contact_preference_at: new Date().toISOString(),
      /**
       * Giving an email raises her identity level, which is what the warm-lead
       * view and the channel rules read. Choosing the conversation does not:
       * she is still anonymous, and the system should keep treating her that
       * way.
       */
      identity_level:
        input.preference === 'email' ? 'email_known' : lead.identity_level,
    })
    .eq('id', lead.id)

  // PHI-free. Which route she chose, never the address or number.
  await admin.from('audit_logs').insert({
    actor_id: null,
    actor_role: 'guest',
    action: 'contact_preference.set',
    resource_type: 'lead_session',
    resource_id: lead.id,
    metadata: { preference: input.preference },
  })

  revalidatePath('/chat')
  return { ok: true }
}