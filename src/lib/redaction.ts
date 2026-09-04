/**
 * PHI REDACTION — the only gate between patient text and the LLM.
 *
 * Brief requirement: "You must redact names, IC/ID numbers, and phones
 * before sending text to the LLM."
 *
 * Deliberately deterministic regex, not a model. Using an LLM to find PHI
 * means sending the raw PHI to an LLM to discover what the PHI was, which
 * defeats the purpose. Regex is auditable, testable, offline, and cannot
 * fail open through a network timeout.
 *
 * Placeholders are typed ([NAME_1], [IC_1]) rather than a flat [REDACTED]
 * so the model still understands sentence structure: "call [PHONE_1]" is
 * comprehensible where "call [REDACTED]" is ambiguous. Both satisfy the
 * test's assertion on bracketed markers.
 *
 * The raw text is never discarded — messages.content keeps what the patient
 * actually said, because they must see their own words and a clinician needs
 * the real thing. Only content_redacted travels to the LLM.
 */

export type PhiKind = 'NAME' | 'IC' | 'PHONE' | 'EMAIL' | 'HANDLE'

export interface RedactionHit {
  kind: PhiKind
  placeholder: string
  start: number
  end: number
}

export interface RedactionResult {
  redacted: string
  hits: RedactionHit[]
  /** True if anything was found. Drives messages.redaction_applied. */
  applied: boolean
  /** PHI-free counts, safe for audit_logs. Never the values themselves. */
  summary: Record<string, number>
}

/**
 * Malaysian IC: YYMMDD-PB-###G, with or without dashes/spaces.
 * Listed first because an IC can otherwise be partly eaten by the phone rule.
 */
const IC_PATTERN = /\b\d{6}[-\s]?\d{2}[-\s]?\d{4}\b/g

/** Singapore/foreign-style ID (S1234567A) — the brief's own test case. */
const FOREIGN_ID_PATTERN = /\b[A-Z]\d{7}[A-Z]\b/g

/**
 * Malaysian mobile and landline. Allows optional whitespace or dash after
 * the +60 country code, which people type constantly (+60 12 345 6789).
 * Requires a leading 0 or +60 so it cannot swallow ages, dates or dosages.
 */
const PHONE_PATTERN = /(?:\+?60[-\s]?|0)\d{1,2}[-\s]?\d{3,4}[-\s]?\d{4}\b/g

const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g
/**
 * Social handles. Not PHI in the strict sense — a handle is a public name the
 * person chose — but it identifies them, and pairing an identifier with a
 * health interest is the whole risk. We know their handle only because they
 * commented publicly; that is not a reason to hand it to a model.
 *
 * Requires a leading @ so it cannot swallow ordinary words.
 */
const HANDLE_PATTERN = /@[A-Za-z0-9._]{2,30}\b/g

/**
 * Names are the hard case: there is no reliable pattern for "a name", and
 * over-matching capitalised words would destroy clinical text ("I take
 * Advil", "Fairbloom", "Monday"). We therefore match only explicit
 * self-identification, which is how names actually enter an intake chat.
 *
 * Honest limitation, stated in the brief: a bare "John Doe" with no
 * introducing phrase is not caught. Mitigations: the LLM is instructed
 * never to echo identifiers, and staff-visible guest content is gated
 * behind consent regardless.
 */
/**
 * NO /i FLAG. This is the whole point.
 *
 * These patterns previously carried /gi. The `i` made them case-INSENSITIVE,
 * which meant [A-Z][a-z]+ matched any lowercase word — the capitalisation
 * requirement, the only thing distinguishing a name from an ordinary word,
 * did nothing at all.
 *
 * Observed in production data:
 *
 *   "i am heavily bleeding and i am feeling faint"
 *      became
 *   "i am [NAME_1] i am [NAME_2]"
 *
 * The capture takes up to three capitalised words, so "heavily bleeding and"
 * was swallowed as one name. The redactor deleted the word BLEEDING from a
 * message about bleeding, and FAINT from a report of feeling faint. Every
 * downstream consumer — the LLM classifier, the triage summariser, memory
 * extraction, and the nurse reading the payload — saw the mangled version.
 *
 * The 999 script still fired only because assessKeywordRisk runs on the RAW
 * text before redaction (chat/actions.ts). That ordering is what stopped this
 * from being an emergency the system missed. Scenario 10 asks which clinical
 * phrase redaction would mangle: this one, and it was already mangling it.
 *
 * Trigger casings are enumerated instead, so "I am" and "i am" both match
 * while the captured name must be genuinely capitalised.
 */
const NAME_PATTERNS: RegExp[] = [
  /(?:[Mm]y name is|[Mm]y name's|[Ii] am|[Ii]'m|[Tt]his is)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/g,
  /\b(?:[Mm]r|[Mm]rs|[Mm]s|[Mm]iss|[Dd]r|[Pp]uan|[Ee]ncik|[Cc]ik)\.?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/g,
]

/**
 * Second layer, for a patient who types in title case or shouts.
 * "I am Bleeding Heavily" is correctly capitalised and still not a name.
 *
 * Deliberately small and clinical. This is a stoplist, not a dictionary: an
 * unfamiliar word is still treated as a name, so an unusual real name is
 * redacted rather than leaked. It fails toward privacy.
 */
const NOT_A_NAME = new Set([
  'Bleeding', 'Heavily', 'Feeling', 'Having', 'Pregnant', 'Worried',
  'Scared', 'Spotting', 'Cramping', 'Trying', 'Still', 'Not', 'So',
  'Very', 'Really', 'Just', 'Also', 'Sorry', 'Fine', 'Okay', 'Ok',
  'Unsure', 'Confused', 'Tired', 'Late', 'Sure', 'Afraid', 'Struggling',
  'Experiencing', 'Concerned', 'Nauseous', 'Dizzy', 'Faint', 'Anxious',
  'Depressed', 'Bloated', 'Itchy', 'Sore', 'Weak', 'Numb', 'Breathless',
])

interface Match {
  kind: PhiKind
  start: number
  end: number
}

function collect(text: string, pattern: RegExp, kind: PhiKind): Match[] {
  const found: Match[] = []
  const re = new RegExp(pattern.source, pattern.flags)
  let m: RegExpExecArray | null

  while ((m = re.exec(text)) !== null) {
    // Capture group 1 when present (name patterns), else the whole match.
    const value = m[1] ?? m[0]

    // A capture made entirely of clinical or filler words is not a name.
    // Only applies to the NAME patterns, which are the only ones with a
    // capture group.
    if (
      kind === 'NAME' &&
      m[1] &&
      m[1].split(/\s+/).every((word) => NOT_A_NAME.has(word))
    ) {
      if (m.index === re.lastIndex) re.lastIndex++
      continue
    }
    const start = m[1] ? m.index + m[0].indexOf(m[1]) : m.index
    found.push({ kind, start, end: start + value.length })
    if (m.index === re.lastIndex) re.lastIndex++
  }

  return found
}

/**
 * Redact PHI from text.
 * Order matters: identifiers first, so a phone rule cannot consume part of
 * an IC. Overlapping matches are resolved by keeping the earliest, longest.
 */
export function redactPhi(text: string): RedactionResult {
  const matches: Match[] = [
    ...collect(text, IC_PATTERN, 'IC'),
    ...collect(text, FOREIGN_ID_PATTERN, 'IC'),
    ...collect(text, PHONE_PATTERN, 'PHONE'),
    ...collect(text, EMAIL_PATTERN, 'EMAIL'),
        ...collect(text, HANDLE_PATTERN, 'HANDLE'),
    ...NAME_PATTERNS.flatMap((p) => collect(text, p, 'NAME')),
  ]

  matches.sort((a, b) => a.start - b.start || b.end - a.end)

  const kept: Match[] = []
  let cursor = -1
  for (const match of matches) {
    if (match.start >= cursor) {
      kept.push(match)
      cursor = match.end
    }
  }

  const counters: Record<PhiKind, number> = {
    NAME: 0,
    IC: 0,
    PHONE: 0,
    EMAIL: 0,
    HANDLE: 0,
  }
  const hits: RedactionHit[] = []
  let out = ''
  let last = 0

  for (const match of kept) {
    counters[match.kind] += 1
    const placeholder = `[${match.kind}_${counters[match.kind]}]`
    out += text.slice(last, match.start) + placeholder
    hits.push({
      kind: match.kind,
      placeholder,
      start: match.start,
      end: match.end,
    })
    last = match.end
  }

  out += text.slice(last)

  const summary: Record<string, number> = {}
  for (const [kind, count] of Object.entries(counters)) {
    if (count > 0) summary[kind.toLowerCase()] = count
  }

  return { redacted: out, hits, applied: hits.length > 0, summary }
}

/**
 * FAIL CLOSED.
 *
 * If redaction throws for any reason, the caller must not fall back to the
 * raw text. This returns a safe stand-in so the conversation degrades
 * instead of leaking. Documented in the brief's failure-modes section.
 */
export function safeRedact(text: string): RedactionResult {
  try {
    return redactPhi(text)
  } catch {
    return {
      redacted: '[REDACTION_FAILED — message withheld from model]',
      hits: [],
      applied: true,
      summary: { error: 1 },
    }
  }
}