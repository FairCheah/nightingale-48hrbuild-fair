import { describe, it, expect } from 'vitest'
import { assessKeywordRisk, combineRisk, EMERGENCY_SCRIPTS } from '@/lib/risk'

/**
 * Brief test 4 — test_risk_escalation.
 *
 * "Input: I have crushing chest pain.
 *  Assert: risk_level == high, AI does not provide advice,
 *  escalation_required == true."
 *
 * Tested against the KEYWORD layer specifically, with no LLM involved. That
 * is the point of the two-layer design: the guarantee must hold when the
 * model is slow, down, or wrong.
 */
describe('risk gating', () => {
  it('never misses the four phrases the brief mandates', () => {
    const mandated = [
      'crushing chest pain',
      'difficulty breathing',
      'heavy bleeding',
      'want to hurt myself',
    ]

    for (const phrase of mandated) {
      const risk = assessKeywordRisk(`I have ${phrase}.`)
      expect(risk.level, `MISSED: ${phrase}`).toBe('high')
      expect(risk.escalationRequired).toBe(true)
      expect(risk.confidence).toBe('high')
    }
  })

  it('gives the brief\u2019s exact input the required verdict', () => {
    const risk = assessKeywordRisk('I have crushing chest pain.')

    expect(risk.level).toBe('high')
    expect(risk.escalationRequired).toBe(true)
    expect(risk.matched).toContain('cardiac')
    expect(risk.assessedAt).toBeTruthy()
  })

  it('gives no advice on a high-risk turn', () => {
    const risk = assessKeywordRisk('I have crushing chest pain.')
    const reply = EMERGENCY_SCRIPTS[risk.emergencyKind!].body

    /**
     * The assertion is about ADVICE, not vocabulary. "Ask someone to take you
     * to hospital" contains the word "take" and is transport instruction, not
     * medical guidance — so we test for the shapes advice actually arrives in:
     * a recommended action on the symptom, a reassurance, or a prevalence
     * claim that implies it is probably fine.
     */
    expect(reply).not.toMatch(/take (a|an|some|your) \w+/i) // "take an aspirin"
    expect(reply).not.toMatch(/\btry (resting|taking|drinking|lying)/i)
    expect(reply).not.toMatch(/(usually|probably|likely|typically) (fine|nothing|harmless|not serious)/i)
    expect(reply).not.toMatch(/it (is|'s) (probably|likely|usually|most likely)/i)
    expect(reply).not.toMatch(/don'?t worry|no need to worry|nothing to worry/i)

    // And it must route to emergency services rather than to us.
    expect(reply).toContain('999')
  })

  it('escalates ambiguity rather than resolving it', () => {
    // Brief §6: "my chest feels funny" must escalate or express uncertainty.
    const risk = assessKeywordRisk('my chest feels funny')

    expect(risk.level).toBe('med')
    expect(risk.escalationRequired).toBe(true)
    // Honest: we matched something concerning but cannot judge severity.
    expect(risk.confidence).toBe('low')
  })

  it('routes out-of-scope symptoms away from the clinic', () => {
    /**
     * Our departure from the brief. Fairbloom is fertility and women's
     * health; offering its nurses for chest pain implies a safety net that
     * does not exist and may delay real care.
     */
    const cardiac = assessKeywordRisk('my chest feels funny')
    expect(cardiac.scope).toBe('out_of_scope')

    const gynae = assessKeywordRisk('I have been spotting for weeks')
    expect(gynae.scope).toBe('in_scope')
  })

  it('routes safeguarding away from the medical script', () => {
    // "Do not drive yourself to A&E" is the wrong sentence for a parent
    // describing danger to their baby.
    const risk = assessKeywordRisk('my baby is in danger')

    expect(risk.level).toBe('high')
    expect(risk.emergencyKind).toBe('safeguarding')
    expect(EMERGENCY_SCRIPTS.safeguarding.body).toContain('15999')
  })

  it('lets ordinary conversation through', () => {
    const risk = assessKeywordRisk('what time do you open on Saturdays?')

    expect(risk.level).toBe('low')
    expect(risk.escalationRequired).toBe(false)
  })

  describe('the combiner', () => {
    it('lets the model raise risk', () => {
      const keyword = assessKeywordRisk('I have been feeling odd lately')
      const combined = combineRisk(keyword, {
        level: 'high',
        reason: 'indirect self-harm signal',
        kind: 'self_harm',
      })

      expect(combined.level).toBe('high')
      expect(combined.escalationRequired).toBe(true)
    })

    it('NEVER lets the model lower risk', () => {
      // The single most important assertion in this file.
      const keyword = assessKeywordRisk('I have crushing chest pain.')
      const combined = combineRisk(keyword, {
        level: 'low',
        reason: 'model thinks this is fine',
        kind: null,
      })

      expect(combined.level).toBe('high')
      expect(combined.escalationRequired).toBe(true)
    })

    it('keeps the keyword floor when the model is unavailable', () => {
      const keyword = assessKeywordRisk('I have crushing chest pain.')
      const combined = combineRisk(keyword, null)

      expect(combined.level).toBe('high')
      expect(combined.escalationRequired).toBe(true)
    })
  })
})