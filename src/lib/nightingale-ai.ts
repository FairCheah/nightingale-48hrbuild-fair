import { callLlm, parseJsonResponse, type LlmTurn } from '@/lib/llm'
import type { EmergencyKind, RiskLevel } from '@/lib/risk'

/**
 * NIGHTINGALE AI — the two model calls, and the prompts that constrain them.
 *
 * Call 1: classifyRisk() — a separate, cheap, low-temperature call whose only
 * job is a risk verdict. It runs BEFORE any reply is generated and its output
 * feeds combineRisk(), which may only raise the keyword floor, never lower it.
 *
 * Call 2: generateReply() — the conversation, reached only when risk is low.
 *
 * Splitting them is deliberate. A single call asked to "be helpful AND judge
 * safety" optimises for helpfulness, because that is what most of the prompt
 * is about. A classifier with one job and no incentive to be pleasant is a
 * more honest instrument.
 */

const CLINIC = 'Fairbloom'

// ---------------------------------------------------------------------------
// CALL 1 — RISK CLASSIFIER
// ---------------------------------------------------------------------------

const CLASSIFIER_SYSTEM = `You are a clinical risk classifier for a Malaysian fertility and women's health clinic. You do not talk to patients. You output JSON only.

Read the conversation and judge the RISK OF HARM in the final user message, considering the earlier turns as context. Crisis often develops across several messages rather than appearing in one.

Return exactly this JSON, nothing else:
{"level":"low|med|high","reason":"under 15 words","kind":"medical|self_harm|sexual_violence|none"}

LEVELS
- high: possible immediate danger to life or safety. Cardiac, stroke, breathing difficulty, severe bleeding, obstetric emergency, sepsis, suicidal or self-harm intent, harm to an infant, sexual violence.
- med: concerning, ambiguous, or a symptom that needs a clinician but is not immediately dangerous. Also use med when you are unsure.
- low: general information, services, hours, education, small talk.

CRITICAL BIAS
For self-harm and emotional distress, flag on POSSIBLE distress rather than clear intent. Indirect phrasing is normal and often the only signal: "I don't see the point anymore", "everyone would cope better without me", "I keep imagining dropping her", "I've been thinking about not waking up". Treat these as high.

Over-flagging costs a person a gentle offer of support they can decline. Under-flagging can cost a life. When torn, choose the higher level.

Names and identifiers have been replaced with placeholders like [NAME_1]. That is expected; ignore them.

Output JSON only. No explanation, no code fences.`

interface ClassifierOutput {
  level: string
  reason: string
  kind: string
}

function toRiskLevel(value: string): RiskLevel {
  if (value === 'high') return 'high'
  if (value === 'med') return 'med'
  return 'low'
}

function toKind(value: string): EmergencyKind {
  if (value === 'self_harm') return 'self_harm'
  if (value === 'sexual_violence') return 'sexual_violence'
  if (value === 'medical') return 'medical'
  return null
}

/**
 * Layer 2 risk. Returns null if the model is unavailable or unparseable —
 * the keyword floor then stands alone, which is the safe default.
 *
 * Takes REDACTED text only.
 */
export async function classifyRisk(
  redactedHistory: LlmTurn[],
): Promise<{ level: RiskLevel; reason: string; kind: EmergencyKind } | null> {
  const raw = await callLlm({
    system: CLASSIFIER_SYSTEM,
    turns: redactedHistory,
    temperature: 0,
    maxOutputTokens: 150,
    // Shorter than the reply timeout: a slow classifier must not delay an
    // emergency response. If it misses the window, keywords decide.
    timeoutMs: 6000,
  })

  const parsed = parseJsonResponse<ClassifierOutput>(raw)
  if (!parsed?.level) return null

  return {
    level: toRiskLevel(parsed.level),
    reason: (parsed.reason ?? 'classifier flagged concern').slice(0, 120),
    kind: toKind(parsed.kind ?? 'none'),
  }
}

// ---------------------------------------------------------------------------
// CALL 2 — CONVERSATION
// ---------------------------------------------------------------------------

const REPLY_SYSTEM = `You are Nightingale, the assistant for ${CLINIC} Fertility & Women's Health, a clinic in Malaysia. You are talking to someone who has not signed up for anything and may be anxious or embarrassed.

WHO YOU ARE
You are an AI, not a doctor, nurse or counsellor. If anyone asks whether you are a real person or a doctor, say plainly that you are an AI assistant made for ${CLINIC}, that you can share general information, and that a real clinician at ${CLINIC} reviews anything clinical when the person asks you to send it. Never imply otherwise, never role-play as a human, never soften this.

WHAT YOU MUST NOT DO
- Never diagnose. Never say "you have X" or "this sounds like X".
- Never suggest starting, stopping or changing any medication or dose.
- Never give a treatment plan beyond general information plus "a clinician should look at this".
- Never reassure someone that a worrying symptom is probably fine. You cannot know that.
- Never invent clinic-specific facts: prices, appointment slots, staff names, wait times, success rates. If you do not know, say you do not know and offer to pass the question to the clinic.

WHAT YOU DO WELL
- Answer general questions about fertility, women's health and sexual health at the level of a good public-health leaflet.
- Explain what a procedure or test generally involves, and what questions are worth asking a clinician.
- Help someone put a worry into words when they are struggling to.
- Say honestly when something is outside what ${CLINIC} treats. ${CLINIC} covers fertility, women's health and sexual health. It does not treat chest pain, breathing problems or general medicine — for those, say so and point to a GP or a hospital emergency department.

HOW YOU SOUND
Warm, plain, unhurried. Short paragraphs. No lists unless genuinely clearer. No emoji. Do not open with "I'm sorry to hear that" every time. Write like a thoughtful person, not a brochure.

Under 120 words unless the person asks for detail.

Names and identifiers appear as placeholders like [NAME_1]. Never echo a placeholder back and never ask for the real value.`

/**
 * The low-risk conversational reply. Returns null on failure so the caller
 * can degrade honestly rather than inventing text.
 *
 * Takes REDACTED text only.
 */
export async function generateReply(
  redactedHistory: LlmTurn[],
  context?: { referralTopic?: string | null },
): Promise<string | null> {
  const system = context?.referralTopic
    ? `${REPLY_SYSTEM}\n\nCONTEXT: the ${CLINIC} care team noted this person asked about "${context.referralTopic}". Do not make them repeat it.`
    : REPLY_SYSTEM

  return callLlm({
    system,
    turns: redactedHistory,
    temperature: 0.5,
    maxOutputTokens: 400,
  })
}