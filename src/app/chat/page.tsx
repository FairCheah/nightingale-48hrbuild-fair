import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { getGuestSession, CLINIC_FULL_NAME } from '@/lib/guest'
import { getWeeklyQuestionCount } from '@/lib/value-events'
import ChatThread, { type ChatMessage, type Citation } from './ChatThread'
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
    // Not 'notfound': there is no token here to be missing. This is someone
    // with no guest cookie - a first-time visitor who opened /chat directly,
    // or a browser that dropped the cookie. Telling her a conversation was
    // deleted when she never started one is its own small lie.
    redirect('/link-invalid?reason=nosession')
  }

  const admin = createAdminClient()

  const { data } = await admin
    .from('messages')
    .select(
      'id, sender, content, created_at, risk_level, escalation_required, risk_reason, scope',
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

  /**
   * §2b — the live statistic. Returns null when the count is below the
   * meaningful threshold, and the UI then shows nothing at all. Never a
   * fake number, and never a real number too small to mean anything.
   */
  const weeklyStat = await getWeeklyQuestionCount(lead.clinic_id)

  /**
   * Opening chips, read from the channel rule directly rather than cached on
   * the session. One source of truth: editing the rules table changes the
   * chips immediately, with no stale copy to migrate.
   */
  const { data: chipRule } = await admin
    .from('channel_rules')
    .select('opening_chips')
    .eq('active', true)
    .in('source_channel', [lead.source_channel, 'default'])
    .in('identity_level', [lead.identity_level, 'any'])
    .not('opening_chips', 'is', null)
    .order('priority', { ascending: true })
    .limit(1)
    .maybeSingle()

  // §6 — citations, keyed by message so each assistant turn shows its own
  // sources. Only ids the model was actually given are ever stored.
  const { data: citationRows } = await admin
    .from('citations')
    .select('message_id, source_title, source_org, source_url')
    .in(
      'message_id',
      messages.map((m) => m.id),
    )

      /**
   * How she asked to be reached, if she has said. Null means she has not been
   * asked yet, or answered nothing. Read here rather than inferred from
   * whether an email exists — "I'll check back here" is a stated choice, and
   * an absence of contact details cannot express it.
   */
  const { data: leadRow } = await admin
    .from('lead_sessions')
    .select('contact_preference')
    .eq('id', lead.id)
    .maybeSingle()

  // §2a — the most recent articulation card, if one has been generated.
  const { data: cardRow } = await admin
    .from('value_events')
    .select('payload')
    .eq('lead_session_id', lead.id)
    .eq('value_type', 'articulation_card')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return (
    <ChatThread
      initialMessages={messages}
      clinicFullName={CLINIC_FULL_NAME}
      activeRisk={latest?.risk_level ?? null}
      memoryItems={(memoryRows ?? []) as MemoryItem[]}
      /**
       * Brief §8 triggers the handoff on Med/High risk "or when patient is
       * sounding unsure, wanting more clarity or a diagnosis". Only the first
       * half was built, so escalation was something the risk gate decided FOR
       * her and never something she could ask for.
       *
       * The result was worse than a missing feature: the assistant would write
       * "I can pass this to a nurse" on a low-risk turn and no button existed,
       * so a person who answered "yes please" got nothing. A promise broken in
       * the same screen it was made.
       */
      canEscalate={
        !openCase &&
        (Boolean(latest?.escalation_required) ||
          messages.some(
            (m) => m.sender === 'guest' || m.sender === 'patient',
          ))
      }
      alreadyEscalated={Boolean(openCase)}
      contactPreference={leadRow?.contact_preference ?? null}
      patientEmail={patientEmail}
      weeklyStat={weeklyStat?.text ?? null}
      articulationCard={cardRow?.payload ?? null}
      openingChips={(chipRule?.opening_chips ?? []) as string[]}
      citations={(citationRows ?? []) as Citation[]}
      /* Trigger per §4: real value delivered, not page landing. Gone once
         they have converted — there is nothing left to invite them to. */
      showInvite={
        !patientSession &&
        (messages.filter((m) => m.sender === 'ai').length >= 2 ||
          Boolean(openCase))
      }
      /**
       * Read the stored value, do not re-derive it.
       *
       * This used to string-search risk_reason for 'ambiguous_cardiac', a
       * label that only appears on the MEDIUM cardiac rule. A HIGH cardiac
       * match produces "Emergency phrase matched: cardiac", which does not
       * contain it — so the check fell through to in_scope and offered a
       * Fairbloom nurse for crushing chest pain, the exact thing the scope
       * system exists to prevent.
       *
       * risk.ts computed the correct value and it was discarded one line
       * later. Migration 23 stores it. The fallback below covers rows
       * written before that; new rows never reach it.
       */
      activeScope={
        latest?.scope ??
        (latest?.risk_reason?.includes('ambiguous_cardiac') ||
        latest?.risk_reason?.includes('ambiguous_neuro')
          ? 'out_of_scope'
          : latest?.risk_reason?.includes('severe_pain')
            ? 'unclear'
            : 'in_scope')
      }
    />
  )
}