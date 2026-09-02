import { callLlm, parseJsonResponse, type LlmTurn } from '@/lib/llm'

/**
 * LIVING MEMORY — structured fact extraction and mutation.
 *
 * Brief §7 requires a Patient Profile that updates live, holding at minimum:
 * chief complaint, key symptoms (with timeline), current medications, and
 * allergies. Each item carries value, status, provenance_pointer and
 * updated_at — the point being that this is a dynamic medical history, not
 * a static chat log.
 *
 * MUTATION IS THE HARD PART. "I take Advil" then "actually I stopped last
 * week" must leave Advil marked stopped, with an unbroken chain back to both
 * source messages. We never delete: the old row stays, its status changes,
 * and the new row points back through `supersedes`. A clinician reading this
 * later can see what was said, when, and what replaced it.
 *
 * Extraction is LLM-based because corrections are expressed in open language.
 * Regex can find "Advil"; it cannot reliably tell that "I stopped that one"
 * three turns later refers to it.
 */

export type MemoryKind = 'chief_complaint' | 'symptom' | 'medication' | 'allergy'
export type MemoryStatus = 'active' | 'stopped' | 'resolved' | 'corrected'

export interface ExtractedFact {
  kind: MemoryKind
  value: string
  status: MemoryStatus
  /** Free text: "since Tuesday", "3 months", "after my last cycle". */
  timeline?: string | null
  /**
   * The exact `value` of an existing fact this one replaces or updates.
   * Set when the patient corrects themselves.
   */
  supersedesValue?: string | null
}

/** An existing profile item, passed in so the model can spot corrections. */
export interface ExistingFact {
  id: string
  kind: MemoryKind
  value: string
  status: MemoryStatus
}

const EXTRACTION_SYSTEM = `You extract structured clinical facts from a patient conversation at a fertility and women's health clinic. You output JSON only. You never give advice.

Return exactly this shape, nothing else:
{"facts":[{"kind":"chief_complaint|symptom|medication|allergy","value":"short phrase","status":"active|stopped|resolved|corrected","timeline":"optional short phrase or null","supersedesValue":"exact value of the existing fact this replaces, or null"}]}

RULES

Extract only what the patient actually said. Never infer a diagnosis, never add a symptom they did not mention, never expand an abbreviation into a condition.

value must be a short noun phrase in the patient's own terms: "Advil", "irregular periods", "penicillin", "trying to conceive for 2 years". Not a sentence. Not your interpretation.

kind:
- chief_complaint: the main reason they are here. Usually one, occasionally none.
- symptom: something they are experiencing.
- medication: anything they take or have taken, including supplements.
- allergy: only an actual allergy or reaction they state.

status:
- active: current, still true
- stopped: a medication they have ceased
- resolved: a symptom that has gone
- corrected: a fact they have said was wrong

CORRECTIONS ARE THE PRIORITY
You are given the facts already on file. If the latest message changes one of them, output the UPDATED fact with supersedesValue set to the exact value string of the old one.

"I take Advil" then "actually I stopped last week"
-> {"kind":"medication","value":"Advil","status":"stopped","timeline":"stopped last week","supersedesValue":"Advil"}

"I've had cramps for 3 days" then "sorry, it's been more like 3 weeks"
-> {"kind":"symptom","value":"cramps","status":"active","timeline":"3 weeks","supersedesValue":"cramps"}

Do not re-output facts that are already on file and unchanged. Return an empty array when the message adds nothing clinical — greetings, questions about hours, and thanks produce no facts.

Identifiers appear as placeholders like [NAME_1]. Never extract those as facts.

Output JSON only. No explanation, no code fences.`

interface ExtractionOutput {
  facts: ExtractedFact[]
}

const VALID_KINDS: MemoryKind[] = [
  'chief_complaint',
  'symptom',
  'medication',
  'allergy',
]
const VALID_STATUSES: MemoryStatus[] = [
  'active',
  'stopped',
  'resolved',
  'corrected',
]

/**
 * Extract facts from the conversation so far.
 * Returns an empty array on any failure — memory degrades rather than
 * inventing entries, and a missing fact is far safer than a wrong one in
 * a record a clinician will read.
 *
 * Takes REDACTED text only.
 */
export async function extractFacts(
  redactedHistory: LlmTurn[],
  existing: ExistingFact[],
): Promise<ExtractedFact[]> {
  const onFile =
    existing.length > 0
      ? existing
          .map((f) => `- ${f.kind}: ${f.value} (${f.status})`)
          .join('\n')
      : '(nothing on file yet)'

  const system = `${EXTRACTION_SYSTEM}\n\nFACTS ALREADY ON FILE:\n${onFile}`

  const raw = await callLlm({
    system,
    turns: redactedHistory,
    temperature: 0,
    maxOutputTokens: 500,
    timeoutMs: 8000,
  })

  const parsed = parseJsonResponse<ExtractionOutput>(raw)
  if (!parsed?.facts || !Array.isArray(parsed.facts)) return []

  // Validate against the DB check constraints before anything reaches Postgres.
  // A hallucinated kind would fail the insert and lose the whole batch.
  return parsed.facts
    .filter(
      (fact) =>
        fact &&
        typeof fact.value === 'string' &&
        fact.value.trim().length > 0 &&
        fact.value.length <= 120 &&
        VALID_KINDS.includes(fact.kind) &&
        VALID_STATUSES.includes(fact.status),
    )
    .slice(0, 8)
    .map((fact) => ({
      kind: fact.kind,
      value: fact.value.trim(),
      status: fact.status,
      timeline: fact.timeline?.toString().slice(0, 80) ?? null,
      supersedesValue: fact.supersedesValue?.toString().trim() || null,
    }))
}