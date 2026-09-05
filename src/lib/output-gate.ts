/**
 * OUTPUT-SIDE GATE.
 *
 * Scenario 15: "the prompt said never diagnose, and the model diagnosed
 * anyway... in most submissions the prompt is the entire control."
 *
 * It was the entire control here too. REPLY_SYSTEM forbids diagnosis clearly
 * and at length, and a system prompt is a request, not a guarantee. Nothing
 * stood between a generated sentence and a frightened stranger reading it
 * under the clinic's name.
 *
 * This is deliberately the CHEAP version: deterministic regex, no second
 * model call, runs in microseconds, cannot time out, and cannot itself fail
 * open through a network error. A model asked to check a model is a second
 * thing that can be wrong, and it fails exactly when the first one does.
 *
 * WHAT IT CANNOT DO
 *
 * It catches phrasings, not meanings. A novel way of implying a diagnosis
 * will pass. That is an accepted limit, not an oversight: the value is in
 * removing the common failure modes at zero latency, and in the fact that a
 * blocked reply is RECORDED, so the rate is measurable rather than assumed.
 *
 * WHAT THE PATIENT SEES
 *
 * Not an error. She gets an honest, in-character message that says the
 * assistant cannot answer that safely and offers the nurse. A frightened
 * person should never be shown a system failure; she should be shown a
 * person-shaped route out.
 */

export interface GateResult {
  /** True when the text was withheld and replaced. */
  blocked: boolean
  /** What the patient should be shown. */
  text: string
  /** PHI-free labels, safe for audit_logs. Never the withheld text. */
  reasons: string[]
}

const DIAGNOSTIC_PATTERNS: { label: string; re: RegExp }[] = [
  {
    label: 'names_condition_as_fact',
    re: /\b(you|this|that|it)\s+(have|has|is|are)\s+(likely\s+|probably\s+|most likely\s+)?(a\s+|an\s+)?(gastritis|endometriosis|pcos|fibroids?|infection|cyst|cancer|miscarriage|ectopic|thrush|uti|anaemia|anemia|angina|heart attack)\b/i,
  },
  {
    label: 'sounds_like_diagnosis',
    re: /\b(sounds like|looks like|seems like|consistent with|suggestive of|indicative of)\b.{0,40}\b(gastritis|endometriosis|pcos|fibroids?|infection|cyst|cancer|miscarriage|ectopic|thrush|uti|anaemia|anemia|angina|heart attack)\b/i,
  },
  {
    /**
     * The reviewers' own example: "this is likely gastritis, not cardiac".
     * Ruling a condition OUT is a diagnostic act, and it is the more
     * dangerous half - it is what sends someone back to bed.
     */
    label: 'rules_condition_out',
    re: /\bnot\s+(cardiac|a heart attack|serious|dangerous|anything to worry)/i,
  },
  {
    label: 'false_reassurance',
    re: /\b(probably|most likely|almost certainly|i'?m sure|i am sure)\b[^.!?]{0,25}?\b(nothing|fine|okay|harmless|benign|normal)\b/i,
  },
  {
    label: 'false_reassurance',
    re: /\b(nothing|no need)\s+to\s+worry\b/i,
  },
  {
    label: 'medication_instruction',
    re: /\b(you should|you can|try|i'?d suggest|i recommend)\s+(taking|take|stop|stopping|increase|increasing|reduce|reducing|double)\b.{0,30}\b(dose|tablet|pill|mg|medication|advil|ibuprofen|paracetamol|panadol|metformin|clomid)\b/i,
  },
  {
    label: 'medication_instruction',
    re: /\b(stop|start|increase|reduce|double)\s+(taking\s+)?(your|the)\s+(dose|medication|tablets?|pills?)\b/i,
  },
]

const REPLACEMENT =
  'I started to answer that and stopped, because what I was about to say ' +
  'came too close to telling you what is wrong with you, and I am not able ' +
  'to do that safely. It is a fair question and it deserves a real answer ' +
  'from a person. Would you like me to pass it to a nurse at Fairbloom?'

/**
 * Screen a patient-facing generated reply.
 *
 * Fails CLOSED in the sense that matters: when in doubt the reply is
 * withheld, never softened and shown anyway. A withheld reply costs one
 * conversational turn; a diagnosis under the clinic's name costs more.
 */
export function screenPatientReply(text: string): GateResult {
  const reasons = [
    ...new Set(
      DIAGNOSTIC_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.label),
    ),
  ]

  if (reasons.length === 0) {
    return { blocked: false, text, reasons: [] }
  }

  return { blocked: true, text: REPLACEMENT, reasons }
}