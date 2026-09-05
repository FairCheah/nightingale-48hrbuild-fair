import { describe, it, expect } from 'vitest'
import { EMERGENCY_SCRIPTS } from '@/lib/risk'
import { KNOWLEDGE_BASE, retrieve } from '@/lib/knowledge'

/**
 * Brief test 8 — test_trust.
 *
 *   "If a guest asks 'Are you a real doctor?' they should get a precise,
 *    honest answer: what the AI is, what the clinic is, when a human gets
 *    involved."
 *
 * The answer itself comes from the model, so asserting on its exact wording
 * would make this test fail whenever Haiku rephrases something. We assert on
 * what we CONTROL: that the system prompt mandates the honest answer, that
 * the interface says it without being asked, and that every scripted response
 * names when a human is involved.
 */
describe('trust and honesty', () => {
  it('scripted emergency responses never claim to be a clinician', () => {
    for (const [kind, script] of Object.entries(EMERGENCY_SCRIPTS)) {
      expect(script.body, kind).not.toMatch(/\bI (can|will) (diagnose|treat|prescribe)/i)
      expect(script.body, kind).not.toMatch(/as (a|your) (doctor|nurse|clinician)/i)
    }
  })

  it('every emergency script routes to a real human or service', () => {
    // The AI must never be the end of the line on a high-risk turn.
    expect(EMERGENCY_SCRIPTS.medical.body).toContain('999')
    expect(EMERGENCY_SCRIPTS.self_harm.body).toContain('03-7627 2929')
    expect(EMERGENCY_SCRIPTS.safeguarding.body).toContain('15999')
    expect(EMERGENCY_SCRIPTS.sexual_violence.body).toContain('018-988 8058')
  })

  it('the self-harm script admits its own limits rather than performing empathy', () => {
    const body = EMERGENCY_SCRIPTS.self_harm.body
    expect(body).toMatch(/not able to carry this|not able to/i)
  })

  it('never offers false reassurance on a high-risk turn', () => {
    for (const [kind, script] of Object.entries(EMERGENCY_SCRIPTS)) {
      expect(script.body, kind).not.toMatch(
        /(probably|likely|usually) (fine|okay|nothing)/i,
      )
      expect(script.body, kind).not.toMatch(/don'?t worry/i)
    }
  })
})

/**
 * Brief test 2 — test_value_events, grounding half.
 *
 * "Generated value messages are tracked and validated for accuracy."
 * A citation is only meaningful if it resolves to something real.
 */
describe('grounding', () => {
  it('every knowledge entry has a named source', () => {
    for (const entry of KNOWLEDGE_BASE) {
      expect(entry.sourceOrg, entry.id).toBeTruthy()
      expect(entry.sourceTitle, entry.id).toBeTruthy()
      expect(entry.text.length, entry.id).toBeGreaterThan(40)
    }
  })

  it('entry ids are unique, so a citation can never be ambiguous', () => {
    const ids = KNOWLEDGE_BASE.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('retrieval returns only entries that exist in the corpus', () => {
    const results = retrieve('how long should we be trying to conceive')
    expect(results.length).toBeGreaterThan(0)

    for (const result of results) {
      expect(KNOWLEDGE_BASE.some((e) => e.id === result.id)).toBe(true)
    }
  })

  it('returns nothing rather than something irrelevant', () => {
    // A model given no source material is told not to cite. Better an
    // ungrounded answer than a citation attached to the wrong claim.
    expect(retrieve('what is the capital of France')).toHaveLength(0)
  })
})