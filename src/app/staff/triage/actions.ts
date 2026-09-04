'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { CLOSURE_REASONS } from './closure-reasons'

/**
 * Clinical actions on an escalation.
 *
 * Every write here goes through the NURSE'S OWN SESSION, never the admin
 * client. escalations_clinical_respond and clinician_responses_write already
 * restrict to is_clinical() and clinic_id = my_clinic_id(), so the database
 * refuses a staff member or a patient without this file needing to check.
 *
 * Using service_role here would have been easier and would have made those
 * two policies decorative — the thing scenario 20 is asking about. The role
 * check below is a second layer for a clearer error message, not the only one.
 */

type Result = { ok: true } | { ok: false; error: string }

async function actingClinician() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { supabase, user: null, profile: null }

  const { data: profile } = await supabase
    .from('app_users')
    .select('role, display_name, email, clinic_id')
    .eq('id', user.id)
    .single()

  return { supabase, user, profile }
}

/**
 * "A nurse has seen this" is not "a nurse has answered", and the person
 * waiting deserves to have those distinguished. Acknowledging does not stop
 * the response_due_at clock — only a reply does.
 */
export async function acknowledgeEscalation(id: string): Promise<Result> {
  const { supabase, user, profile } = await actingClinician()
  if (!user) return { ok: false, error: 'Not signed in.' }
  if (!profile || !['nurse', 'clinician'].includes(profile.role)) {
    return { ok: false, error: 'Only clinical roles can review escalations.' }
  }

  const { error } = await supabase
    .from('escalations')
    .update({ acknowledged_at: new Date().toISOString(), status: 'in_review' })
    .eq('id', id)
    .in('status', ['pending'])

  if (error) return { ok: false, error: error.message }

  revalidatePath('/staff/triage')
  revalidatePath(`/staff/triage/${id}`)
  return { ok: true }
}

export async function replyToEscalation(
  id: string,
  body: string,
): Promise<Result> {
  const trimmed = body.trim()
  if (trimmed.length < 2) return { ok: false, error: 'Write a reply first.' }
  if (trimmed.length > 4000) {
    return { ok: false, error: 'Reply is too long (4000 characters max).' }
  }

  const { supabase, user, profile } = await actingClinician()
  if (!user) return { ok: false, error: 'Not signed in.' }
  if (!profile || !['nurse', 'clinician'].includes(profile.role)) {
    return { ok: false, error: 'Only clinical roles can reply.' }
  }

  // Read the escalation through RLS. If the policy would not show it to this
  // nurse, she cannot reply to it either — no separate authorisation path.
  const { data: esc } = await supabase
    .from('escalations')
    .select('id, clinic_id, first_response_at')
    .eq('id', id)
    .single()

  if (!esc) return { ok: false, error: 'That escalation is not available.' }

  const { error: insertError } = await supabase
    .from('clinician_responses')
    .insert({
      clinic_id: esc.clinic_id,
      escalation_id: esc.id,
      responder_id: user.id,
      /**
       * Snapshot, not a join. The patient is entitled to know who replied to
       * her, and that must survive this person leaving the clinic. Same
       * reasoning as triggering_message_text in migration 17.
       */
      responder_name:
        profile.display_name ?? (profile.email ?? 'Fairbloom').split('@')[0],
      responder_role: profile.role,
      body: trimmed,
    })

  if (insertError) return { ok: false, error: insertError.message }

  const now = new Date().toISOString()

  // first_response_at is set once and never moved: it records whether the
  // 12-18 hour promise was met, so a later follow-up must not overwrite it
  // and quietly turn a missed promise into a kept one.
  const { error: updateError } = await supabase
    .from('escalations')
    .update({
      status: 'responded',
      first_response_at: esc.first_response_at ?? now,
      responded_at: now,
      clinician_id: user.id,
    })
    .eq('id', id)

  if (updateError) return { ok: false, error: updateError.message }

  revalidatePath('/staff/triage')
  revalidatePath(`/staff/triage/${id}`)
  return { ok: true }
}

/**
 * CLOSING A CASE. Clinicians only.
 *
 * The real enforcement is enforce_clinician_close, a trigger written in
 * migration 04 that raises if a non-clinician sets status to 'closed'. That
 * trigger had never fired in the life of this project, because nothing in the
 * application could set that status — there was no Close button for it to
 * guard. The check below is a second layer for a readable error, not the
 * defence: remove it and a nurse still cannot close a case.
 *
 * closure_note is the internal handover record. It is staff-facing and never
 * rendered to the patient, which is why it is written here and not through
 * clinician_responses.
 */
export async function closeEscalation(
  id: string,
  reason: string,
  note: string,
): Promise<Result> {
  if (!CLOSURE_REASONS.some((r) => r.value === reason)) {
    return { ok: false, error: 'Choose why this case is being closed.' }
  }

  const { supabase, user, profile } = await actingClinician()
  if (!user) return { ok: false, error: 'Not signed in.' }

  if (profile?.role !== 'clinician') {
    return {
      ok: false,
      error:
        'Only a clinician can close a case. A nurse can reply and mark it as seen.',
    }
  }

  const { error } = await supabase
    .from('escalations')
    .update({
      status: 'closed',
      closed_at: new Date().toISOString(),
      closed_by: user.id,
      closed_by_name:
        profile.display_name ?? (profile.email ?? 'Clinician').split('@')[0],
      closure_reason: reason,
      closure_note: note.trim().slice(0, 2000) || null,
    })
    .eq('id', id)

  if (error) return { ok: false, error: error.message }

  revalidatePath('/staff/triage')
  revalidatePath(`/staff/triage/${id}`)
  return { ok: true }
}
