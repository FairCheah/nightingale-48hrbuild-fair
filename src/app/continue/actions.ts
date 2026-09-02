'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { getGuestSession, CLINIC_FULL_NAME } from '@/lib/guest'

/**
 * GUEST -> PATIENT CONVERSION — brief §4.
 *
 * The explainable handoff. A LeadSession becomes a PatientSession, and every
 * thread back to the original guest messages and acquisition source stays
 * intact. The patient never repeats what they already said.
 *
 * THREE SEPARATE CONSENTS, three separate timestamps:
 *
 *   1. consent_given — share healthcare information with the named clinic.
 *      Required. Without it there is no patient relationship.
 *   2. migration_consent — move THIS conversation into the record. Required
 *      to migrate, but a person may create an account and leave the
 *      anonymous conversation behind. Consenting to be a patient and
 *      surrendering what you said before you trusted us are different
 *      decisions, and the brief's phrase "migrate PERMITTED guest context"
 *      only means something if the person can say no.
 *   3. marketing_consent — optional, unticked, separately timestamped.
 *      Everything else the clinic sends is transactional.
 *
 * Migration is a RELINK, not a copy. Messages and memory items keep their
 * original rows and gain a patient_session_id. Their provenance_pointers
 * still resolve to the GuestMessage that produced them, which is what
 * test_guest_to_patient_conversion asserts.
 */

export interface ConversionInput {
  email: string
  phone: string
  password: string
  consentShare: boolean
  consentMigrate: boolean
  consentMarketing: boolean
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function convertGuestToPatient(input: ConversionInput) {
  const lead = await getGuestSession()
  if (!lead) return { error: 'expired' }

  const email = input.email.trim().toLowerCase()
  const phone = input.phone.trim()

  if (!EMAIL_SHAPE.test(email)) {
    return { error: 'Please enter an email address we can reach you at.' }
  }
  if (phone.length < 7) {
    return { error: 'Please enter a phone number.' }
  }
  if (input.password.length < 8) {
    return { error: 'Please choose a password of at least 8 characters.' }
  }
  if (!input.consentShare) {
    return {
      error:
        'We cannot create your record without your consent to share it with the clinic.',
    }
  }

  const admin = createAdminClient()
  const now = new Date().toISOString()

  // Funnel event: auth attempt started. Emitted before the account exists so
  // abandonment between here and success is visible in the metrics.
  await admin.from('events').insert({
    clinic_id: lead.clinic_id,
    lead_session_id: lead.id,
    event_type: 'auth_started',
    event_detail: {
      source_channel: lead.source_channel,
      identity_level: lead.identity_level,
    },
  })

  /**
   * Account creation. email_confirm is set true because this is a synthetic
   * build with no mail transport; in production this is a verification link,
   * and the brief's "verified email as login identifier" depends on it.
   */
  const { data: created, error: signUpError } =
    await admin.auth.admin.createUser({
      email,
      password: input.password,
      email_confirm: true,
      user_metadata: { phone },
    })

  if (signUpError || !created?.user) {
    const already = signUpError?.message?.toLowerCase().includes('already')
    return {
      error: already
        ? 'An account already exists for that email. Please sign in instead.'
        : 'We could not create your account. Please try again.',
    }
  }

  const patientId = created.user.id

  // The auth trigger creates the app_users row with role='patient'.
  // We fill in the contact point and clinic.
  await admin
    .from('app_users')
    .update({
      clinic_id: lead.clinic_id,
      email,
      email_verified: true,
      phone,
      social_handle_source: null,
      updated_at: now,
    })
    .eq('id', patientId)

  const { data: session, error: sessionError } = await admin
    .from('patient_sessions')
    .insert({
      clinic_id: lead.clinic_id,
      patient_id: patientId,
      // The provenance link. Attribution reaches the escalation payload
      // through this join, not through a copied field.
      lead_session_id: lead.id,
      consent_given: true,
      consent_timestamp: now,
      consent_clinic_name: CLINIC_FULL_NAME,
      migration_consent: input.consentMigrate,
      migration_consent_timestamp: input.consentMigrate ? now : null,
      marketing_consent: input.consentMarketing,
      // Separately timestamped, per the brief. Null when not given, so
      // "never consented" and "consented at some unknown time" cannot
      // be confused.
      marketing_consent_timestamp: input.consentMarketing ? now : null,
    })
    .select('id')
    .single()

  if (sessionError || !session) {
    return { error: 'We could not set up your record. Please try again.' }
  }

  let migratedMessages = 0
  let migratedFacts = 0

  if (input.consentMigrate) {
    // Relink, not copy. Rows keep their ids, so every provenance_pointer
    // still resolves and the original GuestMessage remains the source.
    const { data: msgs } = await admin
      .from('messages')
      .update({ patient_session_id: session.id })
      .eq('lead_session_id', lead.id)
      .select('id')

    migratedMessages = msgs?.length ?? 0

    const { data: facts } = await admin
      .from('memory_items')
      .update({ patient_session_id: session.id })
      .eq('lead_session_id', lead.id)
      .select('id')

    migratedFacts = facts?.length ?? 0

    /**
     * Any open escalation gains the patient session, which is what makes the
     * confirmation message's promise true: the nurse can now reply to a
     * person who was anonymous when they sent it.
     */
    await admin
      .from('escalations')
      .update({ patient_session_id: session.id })
      .eq('lead_session_id', lead.id)
      .in('status', ['pending', 'in_review'])
  }

  await admin
    .from('patient_sessions')
    .update({
      migrated_summary: {
        messages: migratedMessages,
        memory_items: migratedFacts,
        migrated_at: input.consentMigrate ? now : null,
        source_channel: lead.source_channel,
        campaign_id: lead.campaign_id,
      },
    })
    .eq('id', session.id)

  await admin
    .from('lead_sessions')
    .update({ lifecycle_status: 'converted', last_active_at: now })
    .eq('id', lead.id)

  for (const type of ['consented', 'patient_created']) {
    await admin.from('events').insert({
      clinic_id: lead.clinic_id,
      lead_session_id: lead.id,
      patient_session_id: session.id,
      event_type: type,
      event_detail: {
        source_channel: lead.source_channel,
        campaign_id: lead.campaign_id,
        migrated: input.consentMigrate,
        marketing_consent: input.consentMarketing,
      },
    })
  }

  await admin.from('audit_logs').insert({
    actor_id: patientId,
    actor_role: 'patient',
    action: 'patient.created',
    resource_type: 'patient_session',
    resource_id: session.id,
    metadata: {
      lead_session_id: lead.id,
      source_channel: lead.source_channel,
      migration_consent: input.consentMigrate,
      marketing_consent: input.consentMarketing,
      messages_migrated: migratedMessages,
      facts_migrated: migratedFacts,
    },
  })

  // Sign them in so /chat resolves them as a patient on the next request.
  const supabase = await createClient()
  await supabase.auth.signInWithPassword({ email, password: input.password })

  return { ok: true }
}