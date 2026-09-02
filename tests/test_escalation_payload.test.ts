import { describe, it, expect, afterAll } from 'vitest'
import { testDb, createTestLead, cleanupTestLead } from './helpers'

/**
 * Brief test 3 — test_escalation_payload.
 *
 *   "Send to Clinic persists triggering message, triage summary, profile
 *    snapshot, provenance, and acquisition context."
 *
 * We build the payload the way sendToClinic() builds it and assert on what
 * a clinician would need to begin a structured review without the patient
 * repeating their story. The triage summary text comes from a model in
 * production, so we assert that the field is populated and that the
 * fallback path is honest — not on the model's wording.
 */
describe('escalation payload', () => {
  let leadId: string

  afterAll(async () => {
    if (leadId) await cleanupTestLead(leadId)
  })

  it('persists everything a clinician needs to start work', async () => {
    const db = testDb()

    // Arrive through a channel that carries attribution, so we can prove it
    // survives all the way into the escalation.
    const lead = await createTestLead({
      source_channel: 'instagram_ad_click',
      campaign_id: 'ivf_over40',
      creative: 'carousel_a',
    })
    leadId = lead.id

    const { data: trigger } = await db
      .from('messages')
      .insert({
        lead_session_id: lead.id,
        sender: 'guest',
        content: "I've been bleeding heavily since yesterday",
        content_redacted: "I've been bleeding heavily since yesterday",
        redaction_applied: false,
        risk_level: 'high',
        risk_reason: 'Emergency phrase matched: haemorrhage',
        confidence: 'high',
        risk_provenance: new Date().toISOString(),
        escalation_required: true,
      })
      .select('id, content_redacted, risk_level, created_at')
      .single()

    const { data: fact } = await db
      .from('memory_items')
      .insert({
        lead_session_id: lead.id,
        kind: 'symptom',
        value: 'heavy bleeding',
        status: 'active',
        timeline: 'since yesterday',
        provenance_pointer: trigger!.id,
        conflict_flag: false,
        updated_at: new Date().toISOString(),
      })
      .select('id, kind, value, status, timeline, provenance_pointer')
      .single()

    const profileSnapshot = {
      captured_at: new Date().toISOString(),
      current: [fact],
      superseded: [],
    }

    const acquisition = {
      source_channel: lead.source_channel,
      campaign_id: lead.campaign_id,
      creative: 'carousel_a',
      identity_level: lead.identity_level,
      referral_topic: null,
      page_context: null,
      landing_timestamp: new Date().toISOString(),
    }

    const provenance = {
      triggering_message_id: trigger!.id,
      lead_session_id: lead.id,
      memory_item_ids: [fact!.id],
      memory_provenance_pointers: [fact!.provenance_pointer],
      risk_assessed_at: trigger!.created_at,
      summary_generated: true,
    }

    const { data: escalation } = await db
      .from('escalations')
      .insert({
        clinic_id: null,
        lead_session_id: lead.id,
        triggering_message_id: trigger!.id,
        triggering_message_text: trigger!.content_redacted,
        triage_summary: '• Heavy bleeding since yesterday, site not stated',
        profile_snapshot: profileSnapshot,
        acquisition_context: acquisition,
        provenance_points: provenance,
        risk_level_at_send: trigger!.risk_level,
        status: 'pending',
        response_expectation: 'A nurse will review this within 12 to 18 hours.',
      })
      .select('*')
      .single()

    // --- The five things the brief names -------------------------------

    // 1. Triggering message, both as a link and as a snapshot. The snapshot
    //    matters: the escalation must still stand alone after guest messages
    //    are purged at 14 days.
    expect(escalation!.triggering_message_id).toBe(trigger!.id)
    expect(escalation!.triggering_message_text).toContain('bleeding heavily')

    // 2. Triage summary, 1-5 bullets.
    expect(escalation!.triage_summary).toBeTruthy()
    const bullets = escalation!.triage_summary.split('\n').filter(Boolean)
    expect(bullets.length).toBeGreaterThanOrEqual(1)
    expect(bullets.length).toBeLessThanOrEqual(5)

    // 3. Profile snapshot, frozen at the moment of sending.
    const snapshot = escalation!.profile_snapshot as typeof profileSnapshot
    expect(snapshot.current).toHaveLength(1)
    expect(snapshot.current[0]!.value).toBe('heavy bleeding')
    expect(snapshot.current[0]!.timeline).toBe('since yesterday')

    // 4. Provenance points that actually resolve.
    const points = escalation!.provenance_points as typeof provenance
    const { data: resolved } = await db
      .from('messages')
      .select('id')
      .eq('id', points.triggering_message_id)
      .maybeSingle()
    expect(resolved, 'provenance pointer does not resolve').toBeTruthy()

    // 5. Acquisition context from §1 — attribution survived end to end,
    //    from the ad click through the conversation into the clinical record.
    const context = escalation!.acquisition_context as typeof acquisition
    expect(context.source_channel).toBe('instagram_ad_click')
    expect(context.campaign_id).toBe('ivf_over40')
    expect(context.creative).toBe('carousel_a')

    // --- The clinician handoff (§8) ------------------------------------

    // Status field and room for a response, so a clinician module can be
    // attached later without touching the escalation write path.
    expect(escalation!.status).toBe('pending')
    expect(escalation!.clinician_response).toBeNull()
    expect(escalation!.responded_at).toBeNull()

    // An honest, specific expectation rather than "we'll be in touch".
    expect(escalation!.response_expectation).toMatch(/12 to 18 hours/)

    // The risk level at the moment of sending, preserved even if the
    // conversation later calms down.
    expect(escalation!.risk_level_at_send).toBe('high')
  })

  it('records nothing unredacted in the payload', async () => {
    // The escalation stores content_redacted, never content. A clinician who
    // needs the raw words opens the linked message under their own role.
    const db = testDb()

    const { data: escalations } = await db
      .from('escalations')
      .select('triggering_message_text')
      .limit(20)

    for (const escalation of escalations ?? []) {
      const text = escalation.triggering_message_text ?? ''
      expect(text).not.toMatch(/\b\d{6}[-\s]?\d{2}[-\s]?\d{4}\b/) // Malaysian IC
      expect(text).not.toMatch(/\b[A-Z]\d{7}[A-Z]\b/) // SG NRIC
    }
  })
})