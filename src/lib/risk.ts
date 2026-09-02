/**
 * RISK GATING — computed BEFORE any reply is generated.
 *
 * Brief §6: every patient message gets risk_level (low/med/high), risk_reason,
 * confidence, and risk_provenance. Med/High stops advice and offers escalation.
 *
 * ARCHITECTURE — two independent detectors, combined asymmetrically:
 *
 *   Layer 1 (this file): deterministic phrase matching. Offline, instant,
 *   cannot fail through a network timeout. Guarantees the four phrases the
 *   brief names can never be missed.
 *
 *   Layer 2 (nightingale-ai.ts): an LLM classifier that reads meaning,
 *   catching phrasing no list anticipates — "I don't see the point anymore",
 *   "my baby is in danger".
 *
 * THE SAFETY RULE: final = max(keyword, llm). The model may only RAISE risk,
 * never lower it. A hallucinating model cannot downgrade an emergency, and if
 * the API is down the keyword floor still stands. The failure mode is
 * over-escalation, which costs a clinician five minutes; under-escalation
 * costs a life. That asymmetry is deliberate.
 *
 * Scope note: this clinic is fertility and women's health, but a person with
 * crushing chest pain who happens to be on our page is still a person with
 * crushing chest pain. A clinic does not choose which emergency arrives, so
 * cardiac, stroke and respiratory phrases are included in full.
 */

export type RiskLevel = 'low' | 'med' | 'high'
export type Confidence = 'low' | 'med' | 'high'

/**
 * Distinct emergencies need distinct responses. Telling someone who typed
 * "I don't see the point anymore" to go to an emergency department reads as
 * a brush-off and asks a person with flattened executive function to perform
 * logistics. Telling a parent describing danger to their baby "do not drive
 * yourself" is answering a question they did not ask. Telling someone with a
 * haemorrhage to "sit with this feeling" would be lethal.
 *
 * Same urgency, four different scripts.
 */
export type EmergencyKind =
  | 'medical'
  | 'self_harm'
  | 'sexual_violence'
  | 'safeguarding'
  | null

/**
 * Can THIS clinic act on this concern?
 *
 * Fairbloom is fertility, women's health and sexual health. A nurse here
 * cannot triage chest pain, and offering one implies a safety net that does
 * not exist — which may delay the person seeking care that can help.
 *
 * This deliberately departs from the brief, which treats "Send to Nurse/Clinic"
 * as the universal Med/High action. That assumes the clinic can help with
 * whatever arrives. Routing out-of-scope symptoms to our own nurses would be
 * self-serving rather than safe.
 */
export type Scope = 'in_scope' | 'out_of_scope' | 'unclear'

export interface RiskAssessment {
  level: RiskLevel
  reason: string
  confidence: Confidence
  emergencyKind: EmergencyKind
  escalationRequired: boolean
  /** Whether Fairbloom can actually act on this. Drives the routing offer. */
  scope: Scope
  /** Which detector fired. Recorded for provenance and for the demo. */
  source: 'keyword' | 'llm' | 'combined' | 'none'
  /** Matched category labels only — never the patient's raw words. */
  matched: string[]
  assessedAt: string
}

interface Rule {
  label: string
  kind: EmergencyKind
  scope: Scope
  patterns: RegExp[]
}

/**
 * TIER 1 — HIGH. Immediate danger to life or safety.
 * The four phrases the brief mandates are marked; they must never regress.
 *
 * Every high-risk path offers 999 where relevant — that is correct no matter
 * who we are. Scope governs whether we additionally offer a Fairbloom nurse.
 */
const HIGH_RULES: Rule[] = [
  {
    label: 'cardiac',
    kind: 'medical',
    scope: 'out_of_scope',
    patterns: [
      /crushing chest pain/i, // BRIEF-MANDATED
      /chest (pain|pressure|tightness|tight|heaviness)/i,
      /pain in (my )?chest/i,
      /(pain|numbness).{0,20}(left arm|jaw|shoulder blade)/i,
      /(arm|jaw) (pain|numb)/i,
      /cold sweat/i,
      /heart attack/i,
    ],
  },
  {
    /**
     * Women's cardiac events present atypically — nausea, jaw or back pain,
     * crushing fatigue, breathlessness — and are diagnosed later as a result.
     * For a women's health service to catch the atypical presentation is the
     * single most defensible clinical decision in this module.
     */
    label: 'cardiac_atypical_female',
    kind: 'medical',
    scope: 'out_of_scope',
    patterns: [
      /(nausea|nauseous|vomiting).{0,30}(sweat|short of breath|breathless|jaw|chest)/i,
      /(sweat|short of breath|breathless|jaw|chest).{0,30}(nausea|nauseous|vomiting)/i,
      /(sudden|extreme|crushing) (fatigue|tiredness|exhaustion)/i,
      /(upper back|between my shoulder) pain.{0,30}(breath|sweat|nausea)/i,
    ],
  },
  {
    label: 'stroke',
    kind: 'medical',
    scope: 'out_of_scope',
    patterns: [
      /face (is )?drooping/i,
      /slurred speech/i,
      /can'?t (move|feel) (one side|my (left|right) side)/i,
      /worst headache (of my life|ever)/i,
      /sudden.{0,15}(severe|worst) headache/i,
      /vision.{0,15}(went|gone) (black|dark)/i,
    ],
  },
  {
    label: 'respiratory',
    kind: 'medical',
    scope: 'out_of_scope',
    patterns: [
      /difficulty breathing/i, // BRIEF-MANDATED
      /(can'?t|cannot|struggling to|hard to) breathe/i,
      /short(ness)? of breath/i,
      /gasping/i,
      /(lips|fingers) (are )?blue/i,
      /choking/i,
    ],
  },
  {
    label: 'haemorrhage',
    kind: 'medical',
    scope: 'in_scope',
    patterns: [
      /heavy bleeding/i, // BRIEF-MANDATED
      /bleeding (heavily|a lot|non.?stop|won'?t stop)/i,
      /soaking (through )?(a )?pad/i,
      /(large|big|golf ball|fist).{0,15}clots?/i,
      /h(a)?emorrhag/i,
      /bleeding (after|since) (delivery|birth|c.?section|surgery)/i,
      /losing (a lot of )?blood/i,
    ],
  },
  {
    label: 'obstetric_emergency',
    kind: 'medical',
    scope: 'in_scope',
    patterns: [
      /ectopic/i,
      /shoulder tip pain/i, // referred pain from internal bleeding
      /severe.{0,20}(one.?sided|abdominal|pelvic) pain/i,
      /sudden severe (pain|cramp)/i,
      /(fainted|passed out|blacked out|collapsed)/i,
      /baby (is )?not moving/i,
      /(no|reduced) (fetal|foetal|baby) movement/i,
      /water (broke|breaking)/i,
      /(seizure|fitting|convulsion)/i,
    ],
  },
  {
    label: 'pre_eclampsia',
    kind: 'medical',
    scope: 'in_scope',
    patterns: [
      /(severe|bad) headache.{0,40}(swell|vision|blurry|spots)/i,
      /(swell|vision|blurry|spots).{0,40}(severe|bad) headache/i,
      /seeing (spots|flashing|stars)/i,
      /(face|hands) (are )?swollen/i,
      /pain under (my )?ribs/i,
    ],
  },
  {
    label: 'sepsis',
    kind: 'medical',
    scope: 'in_scope',
    patterns: [
      /(high )?fever.{0,40}(after|since).{0,20}(procedure|surgery|delivery|birth|miscarriage|abortion|d&c)/i,
      /foul.?smell(ing)? discharge/i,
      /(confused|disoriented).{0,20}fever/i,
      /shaking (chills|uncontrollably)/i,
    ],
  },
  {
    /**
     * In scope deliberately. Perinatal and fertility-related distress is
     * squarely a women's health concern, and a nurse here can genuinely
     * follow up — unlike chest pain.
     */
    label: 'self_harm',
    kind: 'self_harm',
    scope: 'in_scope',
    patterns: [
      /want to hurt myself/i, // BRIEF-MANDATED
      /(hurt|harm|kill|cut) myself/i,
      /(kill|end) (myself|my life)/i,
      /(don'?t|do not) want to (live|be here|wake up|exist)/i,
      /better off (dead|without me)/i,
      /(no point|not worth) (living|going on|anymore)/i,
      /(suicide|suicidal)/i,
      /end it all/i,
      /can'?t (do this|go on) anymore/i,
      /want to disappear/i,
    ],
  },
  {
    /**
     * A child or a person at risk from someone else is neither a medical
     * emergency nor self-harm. "Do not drive yourself to A&E" is the wrong
     * sentence for a parent describing danger to their baby, and it was the
     * sentence this system gave before this category existed.
     */
    label: 'safeguarding',
    kind: 'safeguarding',
    scope: 'in_scope',
    patterns: [
      /(hurt|harm|drop|shake|hit) (my|the) baby/i,
      /(my )?baby (is )?(in danger|not safe|being hurt)/i,
      /(afraid|scared|frightened) (for|of what).{0,20}(baby|child)/i,
      /(being |am )?(abused|beaten|threatened)/i,
      /(he|she|they) (hits?|hurts?|threatens?) (me|us|my baby)/i,
      /not safe at home/i,
    ],
  },
  {
    label: 'sexual_violence',
    kind: 'sexual_violence',
    scope: 'in_scope',
    patterns: [
      /\brape(d)?\b/i,
      /sexual(ly)? (assault|abused|abuse)/i,
      /(forced|made) me (to )?(have sex|do)/i,
      /without (my )?consent/i,
      /(he|she|they) (assaulted|attacked) me/i,
    ],
  },
]

/**
 * TIER 2 — MEDIUM. Ambiguous or concerning; stop advice and offer a clinician.
 * Brief §6: "Ambiguous symptoms ('my chest feels funny') must escalate or
 * honestly express uncertainty."
 */
const MED_RULES: Rule[] = [
  {
    label: 'ambiguous_cardiac',
    kind: 'medical',
    scope: 'out_of_scope',
    patterns: [
      /chest feels (funny|weird|odd|strange|off|tight)/i,
      /(heart|chest).{0,15}(racing|fluttering|pounding|skipping)/i,
      /palpitations/i,
    ],
  },
  {
    label: 'ambiguous_neuro',
    kind: 'medical',
    scope: 'out_of_scope',
    patterns: [
      /(dizzy|dizziness|light.?headed|faint)/i,
      /(numbness|tingling|pins and needles)/i,
      /(blurred|double) vision/i,
    ],
  },
  {
    label: 'severe_pain',
    kind: 'medical',
    scope: 'unclear',
    patterns: [
      /(severe|worst|unbearable|excruciating) pain/i,
      /pain (won'?t|doesn'?t) (go away|stop)/i,
      /(10|nine|ten)\s*(\/|out of)\s*10 pain/i,
    ],
  },
  {
    label: 'gynae_concern',
    kind: 'medical',
    scope: 'in_scope',
    patterns: [
      /(bleeding|spotting) for (weeks|months)/i,
      /(lump|growth|mass)/i,
      /(unusual|abnormal|strange) discharge/i,
      /(positive|pregnant).{0,30}(pain|bleeding|cramping)/i,
      /bleeding (during|after) (sex|intercourse)/i,
    ],
  },
  {
    label: 'medication_risk',
    kind: 'medical',
    scope: 'in_scope',
    patterns: [
      /(pregnant|pregnancy).{0,30}(medication|medicine|drug|tablet|pill)/i,
      /(stop|stopped|change).{0,20}(medication|medicine|prescription)/i,
      /(overdose|took too (many|much))/i,
    ],
  },
  {
    label: 'distress',
    kind: 'self_harm',
    scope: 'in_scope',
    /**
     * Deliberately low threshold. For this category we accept false positives:
     * over-escalating a sad message costs a gentle offer the person can wave
     * off. Under-escalating can cost a life.
     */
    patterns: [
      /(hopeless|worthless|empty inside)/i,
      /(can'?t cope|falling apart|breaking down)/i,
      /(no one|nobody) (would|will) (care|miss|notice)/i,
      /(crying|cry) (all|every) (day|night|the time)/i,
      /(hate|resent) (my|the) baby/i,
    ],
  },
]

function scan(text: string, rules: Rule[]): Rule[] {
  return rules.filter((rule) => rule.patterns.some((p) => p.test(text)))
}

/**
 * When several rules fire at once, the most conservative scope wins.
 * "Chest pain and heavy bleeding" must not be treated as fully in scope
 * just because one of the two is.
 */
function narrowestScope(rules: Rule[]): Scope {
  if (rules.some((r) => r.scope === 'out_of_scope')) return 'out_of_scope'
  if (rules.some((r) => r.scope === 'unclear')) return 'unclear'
  return 'in_scope'
}

/**
 * Layer 1 — the deterministic floor.
 * Runs on the RAW message, not the redacted one: redaction placeholders never
 * overlap clinical language, and a name replaced mid-sentence must not break
 * a phrase match.
 */
export function assessKeywordRisk(text: string): RiskAssessment {
  const now = new Date().toISOString()

  const high = scan(text, HIGH_RULES)
  if (high.length > 0) {
    /**
     * Which script to use when several fire. Self-harm first: a person in
     * crisis who also mentions a symptom needs the crisis response. Then
     * safeguarding, then sexual violence, then medical. Ordering by who is
     * least well served by the generic 999 script.
     */
    const priority =
      high.find((r) => r.kind === 'self_harm') ??
      high.find((r) => r.kind === 'safeguarding') ??
      high.find((r) => r.kind === 'sexual_violence') ??
      high[0]

    return {
      level: 'high',
      reason: `Emergency phrase matched: ${high.map((r) => r.label).join(', ')}`,
      confidence: 'high',
      emergencyKind: priority.kind,
      escalationRequired: true,
      // Non-medical kinds keep their own in-scope routing even when a medical
      // rule also fired, because the support offer differs.
      scope:
        priority.kind === 'medical' ? narrowestScope(high) : priority.scope,
      source: 'keyword',
      matched: high.map((r) => r.label),
      assessedAt: now,
    }
  }

  const med = scan(text, MED_RULES)
  if (med.length > 0) {
    return {
      level: 'med',
      reason: `Ambiguous or concerning symptom: ${med.map((r) => r.label).join(', ')}`,
      // Honest: we matched a concerning pattern but cannot judge severity.
      confidence: 'low',
      emergencyKind: med[0].kind,
      escalationRequired: true,
      scope: narrowestScope(med),
      source: 'keyword',
      matched: med.map((r) => r.label),
      assessedAt: now,
    }
  }

  return {
    level: 'low',
    reason: 'No emergency or ambiguous-symptom phrase matched',
    confidence: 'med',
    emergencyKind: null,
    escalationRequired: false,
    scope: 'in_scope',
    source: 'none',
    matched: [],
    assessedAt: now,
  }
}

const ORDER: Record<RiskLevel, number> = { low: 0, med: 1, high: 2 }

/**
 * THE COMBINER. The model may only raise risk, never lower it.
 * If the LLM layer is unavailable, pass null and the keyword floor stands.
 */
export function combineRisk(
  keyword: RiskAssessment,
  llm: { level: RiskLevel; reason: string; kind: EmergencyKind } | null,
): RiskAssessment {
  if (!llm) return keyword
  if (ORDER[llm.level] <= ORDER[keyword.level]) {
    return { ...keyword, source: keyword.source === 'none' ? 'llm' : 'combined' }
  }

  return {
    level: llm.level,
    reason: `Raised by classifier: ${llm.reason}`,
    confidence: 'med',
    emergencyKind: llm.kind ?? keyword.emergencyKind,
    escalationRequired: llm.level !== 'low',
    // The classifier judges severity, not our clinic's remit. Scope is ours.
    scope: keyword.scope,
    source: keyword.source === 'none' ? 'llm' : 'combined',
    matched: keyword.matched,
    assessedAt: new Date().toISOString(),
  }
}

/**
 * RESPONSE SCRIPTS.
 * On High, the AI says only this. No education, no reassurance, no hedging.
 * Numbers verified against the operators' own published sources.
 */
type EmergencyScript = { body: string; banner: string }

export const EMERGENCY_SCRIPTS: {
  medical: EmergencyScript
  self_harm: EmergencyScript
  safeguarding: EmergencyScript
  sexual_violence: EmergencyScript
} = {
  medical: {
    banner: 'Call 999 or visit the nearest HOSPITAL EMERGENCY DEPARTMENT',
    body:
      'What you have described needs to be seen by a doctor now, not by me. ' +
      'Please call 999, or ask someone to take you to the nearest hospital ' +
      'emergency department straight away. Do not drive yourself. ' +
      'I am not able to assess this safely, and I would rather you were seen than reassured.',
  },
  self_harm: {
    banner: 'You deserve support right now — Befrienders 03-7627 2929, 24 hours',
    body:
      'Thank you for telling me. That took something, and I am glad you said it here ' +
      'rather than keeping it to yourself.\n\n' +
      'I am not able to carry this with you the way a person can. Befrienders is free, ' +
      'confidential, and answers 24 hours a day on 03-7627 2929 — you do not have to be ' +
      'in crisis to call, and you do not have to explain yourself well. ' +
      'The national Heal Line is 15555.\n\n' +
      'If you are in immediate danger, please call 999.\n\n' +
      'I can also pass this to a nurse at Fairbloom so a real person follows up with you. ' +
      'Would you like me to?',
  },
  safeguarding: {
    banner: 'Talian Kasih 15999 — 24 hours, for anyone at risk',
    body:
      'Thank you for telling me. I want to make sure you and your baby are safe.\n\n' +
      'If either of you is in immediate danger right now, please call 999.\n\n' +
      'Talian Kasih is the national helpline for anyone at risk, including children. ' +
      'It answers 24 hours on 15999, or on WhatsApp at 019-261 5999. ' +
      'Women\u2019s Aid Organisation can also help you think through your options and ' +
      'somewhere safe to stay — TINA on SMS or WhatsApp at 018-988 8058, answered ' +
      '24 hours.\n\n' +
      'You do not have to have decided anything to call them.\n\n' +
      'I can also pass this to a nurse at Fairbloom if you would like a real person ' +
      'from the clinic to follow up.',
  },
  sexual_violence: {
    banner: 'Support is available — WAO TINA WhatsApp 018-988 8058, 24 hours',
    body:
      'I believe you, and I am sorry this happened. Nothing about it was your fault, ' +
      'and you do not have to decide anything right now.\n\n' +
      'A few options, in case they help. Government hospitals have One Stop Crisis Centres ' +
      'in their emergency departments — they treat any injury and can preserve evidence, ' +
      'whether or not you ever want to make a police report. That choice stays yours.\n\n' +
      'Women\u2019s Aid Organisation can talk it through with you: TINA on SMS or WhatsApp ' +
      'at 018-988 8058, answered 24 hours, or the hotline on 03-3000 8858 during the day. ' +
      'Talian Kasih is 15999.\n\n' +
      'If you would rather speak to someone at Fairbloom, I can arrange that too.',
  },
}