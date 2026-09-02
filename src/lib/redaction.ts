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

export type PhiKind = 'NAME' | 'IC' | 'PHONE' | 'EMAIL'

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
const NAME_PATTERNS: RegExp[] = [
  /(?:my name is|my name's|i am|i'm|this is)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/gi,
  /\b(?:mr|mrs|ms|miss|dr|puan|encik|cik)\.?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/gi,
]

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

  const counters: Record<PhiKind, number> = { NAME: 0, IC: 0, PHONE: 0, EMAIL: 0 }
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