/**
 * LLM PROVIDER — the single outbound path to any language model.
 *
 * Provider-agnostic by design: nothing above this layer knows which model
 * answered. We use Anthropic's Haiku, the cheapest and fastest model in the
 * range, because both jobs here are narrow — classify risk into three
 * buckets, and write short replies inside a tight system prompt. Neither
 * needs a larger model, and cost per conversation matters for a clinic.
 *
 * FAILURE MODE: every call has a hard timeout and returns null rather than
 * throwing. A model that is slow or down must degrade the conversation, never
 * break it, and must never be able to weaken a risk verdict.
 */

const MODEL = 'claude-haiku-4-5-20251001'
const ENDPOINT = 'https://api.anthropic.com/v1/messages'
const API_VERSION = '2023-06-01'

/** Generous enough for a real answer, short enough that nobody stares at a spinner. */
const TIMEOUT_MS = 15_000

export interface LlmTurn {
  /** 'model' is kept for call-site compatibility and mapped to 'assistant'. */
  role: 'user' | 'model'
  text: string
}

export interface LlmOptions {
  system: string
  turns: LlmTurn[]
  /** Low for classification, higher for conversation. */
  temperature?: number
  maxOutputTokens?: number
  timeoutMs?: number
  /** Internal: prevents infinite retry loops. */
  isRetry?: boolean
}

/**
 * Call the model. Returns the text, or null on any failure.
 * Callers must handle null — that is the contract.
 */
export async function callLlm(options: LlmOptions): Promise<string | null> {
  const key = process.env.ANTHROPIC_API_KEY

  if (!key) {
    console.error(
      JSON.stringify({ event: 'llm.misconfigured', reason: 'missing_api_key' }),
    )
    return null
  }

  const controller = new AbortController()
  const timer = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? TIMEOUT_MS,
  )

  const started = Date.now()

  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': API_VERSION,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: MODEL,
        max_tokens: options.maxOutputTokens ?? 600,
        temperature: options.temperature ?? 0.4,
        // A first-class system field, unlike some providers — the medical
        // constraints are guaranteed to apply rather than buried in a turn.
        system: options.system,
        messages: options.turns.map((turn) => ({
          role: turn.role === 'model' ? 'assistant' : 'user',
          content: turn.text,
        })),
      }),
    })

    /**
     * 429 and 5xx are transient: rate limiting or upstream load, not a bad
     * request. One short retry absorbs most spikes. We do not retry 4xx
     * otherwise — a malformed request fails identically the second time.
     */
    if (
      (response.status === 429 || response.status >= 500) &&
      !options.isRetry
    ) {
      clearTimeout(timer)
      await new Promise((resolve) => setTimeout(resolve, 1500))
      return callLlm({ ...options, isRetry: true })
    }

    if (!response.ok) {
      // Structured, PHI-free log: status, timing and the provider's own error
      // message. Never the prompt, never the patient's words.
      const detail = await response.text().catch(() => '')
      console.error(
        JSON.stringify({
          event: 'llm.http_error',
          status: response.status,
          ms: Date.now() - started,
          detail: detail.slice(0, 300),
        }),
      )
      return null
    }

    const data = await response.json()

    // Content is a list of blocks; we only ever request text.
    const text: string | undefined = data?.content
      ?.filter((block: { type: string }) => block.type === 'text')
      ?.map((block: { text: string }) => block.text)
      ?.join('\n')

    if (!text) {
      console.error(
        JSON.stringify({
          event: 'llm.empty_response',
          stop: data?.stop_reason ?? 'unknown',
          ms: Date.now() - started,
        }),
      )
      return null
    }

    console.log(
      JSON.stringify({
        event: 'llm.ok',
        ms: Date.now() - started,
        chars: text.length,
        in_tokens: data?.usage?.input_tokens ?? null,
        out_tokens: data?.usage?.output_tokens ?? null,
      }),
    )

    return text.trim()
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError'
    console.error(
      JSON.stringify({
        event: aborted ? 'llm.timeout' : 'llm.error',
        ms: Date.now() - started,
      }),
    )
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Parse a JSON object out of a model response.
 * Models wrap JSON in prose or code fences no matter how firmly you ask them
 * not to, so we extract rather than trust. Returns null if nothing parses —
 * callers must treat that as "the classifier had no opinion".
 */
export function parseJsonResponse<T>(raw: string | null): T | null {
  if (!raw) return null

  const cleaned = raw
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim()

  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) return null

  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as T
  } catch {
    return null
  }
}