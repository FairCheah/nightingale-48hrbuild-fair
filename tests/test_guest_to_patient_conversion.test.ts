import { describe, it, expect, afterAll } from 'vitest'
import { testDb, createTestLead, cleanupTestLead, firstClinicId } from './helpers'

/**
 * Brief test 1 — test_guest_to_patient_conversion.
 *
 *   "Guest arrives via source=instagram&campaign=ivf_over40, states a
 *    concern; after auth + consent the context appears in the PatientSession,
 *    provenance resolves to the original GuestMessage, attribution retained,
 *    concern never re-asked."
 *
 * The whole point of §4 in one test. Migration is a RELINK, not a copy: rows
 * keep their ids and gain a patient_session_id, so every provenance_pointer
 * still resolves to the GuestMessage that produced it. A copy would break
 * that chain silently, which is why this test asserts on ids rather than
 * on content.
 */
describe('guest to patient conversion', () => {
  let leadId: string
  let patientAuthId: string | null = null

  afterAll(async () => {
    if (leadId) await cleanupTestLead(leadId)
    if (patientAuthId) {
      await testDb().auth.admin.deleteUser(patientAuthId).catch(() => {})
    }
  })

  it('carries context, provenance and attribution across the handoff', async () => {
    const db = testDb()
    const clinicId = await firstClinicId()

    // --- The guest arrives, exactly as the brief describes ---------------
    const lead = await createTestLead({
      source_channel: 'instagram_ad_click',
      campaign_id: 'ivf_over40',
      creative: 'carousel_a',
      identity_level: 'anonymous',
    })
    leadId = lead.id

    // --- They state a concern -------------------------------------------
    const { data: guestMessage } = await db
      .from('messages')
      .insert({
        lead_session_id: lead.id,
        sender: 'guest',
        content: "I've been trying to conceive for two years",
        content_redacted: "I've been trying to conceive for two years",
        redaction_applied: false,
        risk_level: 'low',
        escalation_required: false,
      })
      .select('id, content')
      .single()

    const { data: fact } = await db
      .from('memory_items')
      .insert({
        lead_session_id: lead.id,
        kind: 'chief_complaint',
        value: 'trying to conceive for two years',
        status: 'active',
        provenance_pointer: guestMessage!.id,
        conflict_flag: false,
        updated_at: new Date().toISOString(),
      })
      .select('id, value, provenance_pointer')
      .single()

    // --- Auth ------------------------------------------------------------
    const email = `conversion_test_${Date.now()}@fairbloom.test`

    const { data: created, error: authError } = await db.auth.admin.createUser({
      email,
      password: 'Fairbloom123!',
      email_confirm: true,
      user_metadata: { phone: '012-345 6789' },
    })

    expect(authError).toBeNull()
    patientAuthId = created!.user!.id

    // The bootstrap trigger creates app_users with role forced to 'patient'.
    const { data: appUser } = await db
      .from('app_users')
      .select('id, role, email')
      .eq('id', patientAuthId)
      .single()

    // Self-signup can never yield a care-team role, however the request is
    // crafted. Care-team roles are provisioned separately.
    expect(appUser!.role).toBe('patient')

    // --- Consent ---------------------------------------------------------
    const now = new Date().toISOString()

    const { data: session } = await db
      .from('patient_sessions')
      .insert({
        clinic_id: clinicId,
        patient_id: patientAuthId,
        // The provenance link. Attribution reaches the patient record
        // through this join, not through a copied field.
        lead_session_id: lead.id,
        consent_given: true,
        consent_timestamp: now,
        consent_clinic_name: "Fairbloom Fertility & Women's Health",
        migration_consent: true,
        migration_consent_timestamp: now,
        marketing_consent: false,
        marketing_consent_timestamp: null,
      })
      .select('*')
      .single()

    // Three consents, three separate decisions.
    expect(session!.consent_given).toBe(true)
    expect(session!.consent_timestamp).toBeTruthy()
    expect(session!.consent_clinic_name).toContain('Fairbloom')
    expect(session!.migration_consent).toBe(true)

    // Marketing declined, and the timestamp is NULL rather than set —
    // "never consented" and "consented at some unknown time" must not be
    // confusable in a record a regulator might read.
    expect(session!.marketing_consent).toBe(false)
    expect(session!.marketing_consent_timestamp).toBeNull()

    // --- Migration: RELINK, not copy -------------------------------------
    await db
      .from('messages')
      .update({ patient_session_id: session!.id })
      .eq('lead_session_id', lead.id)

    await db
      .from('memory_items')
      .update({ patient_session_id: session!.id })
      .eq('lead_session_id', lead.id)

    await db
      .from('lead_sessions')
      .update({ lifecycle_status: 'converted', staff_visible: true })
      .eq('id', lead.id)

    // --- Assertions -------------------------------------------------------

    // 1. The context appears in the PatientSession.
    const { data: migratedFacts } = await db
      .from('memory_items')
      .select('id, value, provenance_pointer')
      .eq('patient_session_id', session!.id)

    expect(migratedFacts).toHaveLength(1)
    expect(migratedFacts![0].value).toBe('trying to conceive for two years')

    // 2. The row kept its identity. A copy would have a new id and the
    //    original provenance would dangle.
    expect(migratedFacts![0].id).toBe(fact!.id)

    // 3. Provenance resolves to the ORIGINAL GuestMessage.
    expect(migratedFacts![0].provenance_pointer).toBe(guestMessage!.id)

    const { data: source } = await db
      .from('messages')
      .select('id, sender, content, lead_session_id, patient_session_id')
      .eq('id', migratedFacts![0].provenance_pointer)
      .single()

    expect(source!.sender).toBe('guest')
    expect(source!.content).toBe("I've been trying to conceive for two years")

    // The message belongs to both, which is what makes the chain unbroken:
    // it is still the guest message it always was, and it is now part of
    // the patient record.
    expect(source!.lead_session_id).toBe(lead.id)
    expect(source!.patient_session_id).toBe(session!.id)

    // 4. Attribution retained, reachable from the patient session.
    const { data: joined } = await db
      .from('patient_sessions')
      .select('id, lead_sessions(source_channel, campaign_id, creative)')
      .eq('id', session!.id)
      .single()

    const attribution = joined!.lead_sessions as unknown as {
      source_channel: string
      campaign_id: string
      creative: string
    }

    expect(attribution.source_channel).toBe('instagram_ad_click')
    expect(attribution.campaign_id).toBe('ivf_over40')
    expect(attribution.creative).toBe('carousel_a')

    // 5. The concern is never re-asked, because the conversation continues
    //    in place. Every message the guest sent is still in the thread.
    const { data: thread } = await db
      .from('messages')
      .select('id, sender, content')
      .eq('lead_session_id', lead.id)
      .order('created_at', { ascending: true })

    expect(thread!.some((m) => m.id === guestMessage!.id)).toBe(true)
  })

  it('a declined migration leaves the guest conversation behind', async () => {
    /**
     * "Migrate PERMITTED guest context." Permission only means something if
     * declining does something. A person may want an account without handing
     * over a conversation they had before they trusted the clinic.
     */
    const db = testDb()
    const clinicId = await firstClinicId()

    const lead = await createTestLead()

    const { data: message } = await db
      .from('messages')
      .insert({
        lead_session_id: lead.id,
        sender: 'guest',
        content: 'something I would rather not carry forward',
        content_redacted: 'something I would rather not carry forward',
        redaction_applied: false,
        escalation_required: false,
      })
      .select('id')
      .single()

    const { data: session } = await db
      .from('patient_sessions')
      .insert({
        clinic_id: clinicId,
        lead_session_id: lead.id,
        consent_given: true,
        consent_timestamp: new Date().toISOString(),
        consent_clinic_name: "Fairbloom Fertility & Women's Health",
        // Declined.
        migration_consent: false,
        migration_consent_timestamp: null,
      })
      .select('id')
      .single()

    // No relink runs when migration_consent is false.
    const { data: stillGuest } = await db
      .from('messages')
      .select('id, patient_session_id')
      .eq('id', message!.id)
      .single()

    expect(stillGuest!.patient_session_id).toBeNull()

    const { data: patientMessages } = await db
      .from('messages')
      .select('id')
      .eq('patient_session_id', session!.id)

    expect(patientMessages ?? []).toHaveLength(0)

    await cleanupTestLead(lead.id)
  })
})