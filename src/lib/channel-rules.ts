import { createAdminClient } from '@/lib/supabase/admin'

/**
 * CHANNEL RULE RESOLVER
 *
 * The rules themselves live in the `channel_rules` table (declarative config,
 * per brief Section 3). This file contains NO channel-specific logic — it only
 * decides which row wins and fills in its placeholders.
 *
 * Selection order:
 *   1. Discard rules whose placeholders this lead session cannot fill.
 *   2. Rank by specificity (exact channel > default, exact identity > any, etc).
 *   3. Break ties by `priority` ascending (lower number wins).
 *   4. If nothing survives, use the hardcoded last resort below, so a patient
 *      can never land on a blank greeting even if the table is empty.
 */

export type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'night'

export interface ChannelRule {
  id: string
  source_channel: string
  identity_level: string
  time_of_day: string
  intent: string | null
  opening_strategy: string
  opening_template: string
  ask_for_email: boolean
  priority: number
}

/** The parts of a LeadSession a rule is allowed to see. */
export interface LeadContext {
  source_channel: string
  identity_level: string
  referral_topic?: string | null
  social_handle?: string | null
  page_context?: string | null
  campaign_id?: string | null
  clinic_name?: string | null
}

export interface ResolvedOpening {
  opening: string
  strategy: string
  askForEmail: boolean
  /** null when the hardcoded fallback was used — useful for tests and logs. */
  ruleId: string | null
  matchedOn: {
    source_channel: string
    identity_level: string
    time_of_day: string
    intent: string
  }
  usedFallback: boolean
}

/**
 * Last resort. Deliberately generic, non-diagnostic, and account-free.
 * If you ever see this in the UI, a rule is missing — that is a config bug,
 * not a runtime crash.
 */
const FALLBACK_OPENING =
  "Hi — I'm Nightingale, the assistant for this clinic. " +
  "You don't need an account to talk to me. " +
  'I can share general information and connect you with the clinic whenever ' +
  "you're ready. What would you like to know?"

const PLACEHOLDER = /\{\{\s*([a-z_]+)\s*\}\}/g

/**
 * Clinic-local time bucket. Fairbloom is in Malaysia, so rules are evaluated
 * in the clinic's timezone, not the visitor's browser and not UTC.
 * A 2am message deserves a 2am opening regardless of where the server runs.
 */
export function resolveTimeOfDay(
  now: Date = new Date(),
  timeZone = 'Asia/Kuala_Lumpur',
): TimeOfDay {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', {
      hour: 'numeric',
      hour12: false,
      timeZone,
    }).format(now),
  )

  if (hour >= 5 && hour < 12) return 'morning'
  if (hour >= 12 && hour < 17) return 'afternoon'
  if (hour >= 17 && hour < 22) return 'evening'
  return 'night'
}

/** Values a template is permitted to interpolate. Nothing clinical, ever. */
function buildVars(lead: LeadContext): Record<string, string> {
  return {
    referral_topic: (lead.referral_topic ?? '').trim(),
    social_handle: (lead.social_handle ?? '').trim(),
    page_context: (lead.page_context ?? '').trim(),
    campaign_id: (lead.campaign_id ?? '').trim(),
    clinic_name: (lead.clinic_name ?? 'the clinic').trim(),
  }
}

/**
 * Fill placeholders and report any that could not be filled.
 * A half-filled template is worse than a generic one — an opening reading
 * "you asked about {{referral_topic}}" destroys trust instantly.
 */
export function fillTemplate(
  template: string,
  vars: Record<string, string>,
): { text: string; missing: string[] } {
  const missing: string[] = []

  const text = template.replace(PLACEHOLDER, (_match, key: string) => {
    const value = vars[key]
    if (!value) {
      missing.push(key)
      return ''
    }
    return value
  })

  return { text: text.replace(/\s+/g, ' ').trim(), missing }
}

/** Higher is more specific. Channel dominates, then identity, then intent, then time. */
function specificity(
  rule: ChannelRule,
  channel: string,
  identity: string,
  timeOfDay: TimeOfDay,
  intent: string,
): number {
  let score = 0
  if (rule.source_channel === channel) score += 8
  if (rule.identity_level === identity) score += 4
  if ((rule.intent ?? 'any') === intent && intent !== 'any') score += 2
  if (rule.time_of_day === timeOfDay) score += 1
  return score
}

/** A rule is applicable if every dimension either matches exactly or is a wildcard. */
function applies(
  rule: ChannelRule,
  channel: string,
  identity: string,
  timeOfDay: TimeOfDay,
  intent: string,
): boolean {
  const ruleIntent = rule.intent ?? 'any'

  const channelOk =
    rule.source_channel === channel || rule.source_channel === 'default'
  const identityOk =
    rule.identity_level === identity || rule.identity_level === 'any'
  const timeOk = rule.time_of_day === timeOfDay || rule.time_of_day === 'any'
  const intentOk = ruleIntent === intent || ruleIntent === 'any'

  return channelOk && identityOk && timeOk && intentOk
}

/**
 * Resolve the opening message for a lead session.
 * Read-only: this function never writes to the database.
 */
export async function resolveOpening(
  lead: LeadContext,
  options: { intent?: string; now?: Date } = {},
): Promise<ResolvedOpening> {
  const channel = lead.source_channel
  const identity = lead.identity_level
  const intent = options.intent ?? 'any'
  const timeOfDay = resolveTimeOfDay(options.now)
  const vars = buildVars(lead)

  const matchedOn = {
    source_channel: channel,
    identity_level: identity,
    time_of_day: timeOfDay,
    intent,
  }

  const admin = createAdminClient()

  const { data, error } = await admin
    .from('channel_rules')
    .select(
      'id, source_channel, identity_level, time_of_day, intent, opening_strategy, opening_template, ask_for_email, priority',
    )
    .eq('active', true)
    .in('source_channel', [channel, 'default'])

  if (error || !data || data.length === 0) {
    return {
      opening: FALLBACK_OPENING,
      strategy: 'fallback_generic',
      askForEmail: false,
      ruleId: null,
      matchedOn,
      usedFallback: true,
    }
  }

  const candidates = (data as ChannelRule[])
    .filter((rule) => applies(rule, channel, identity, timeOfDay, intent))
    .sort((a, b) => {
      const diff =
        specificity(b, channel, identity, timeOfDay, intent) -
        specificity(a, channel, identity, timeOfDay, intent)
      if (diff !== 0) return diff
      return a.priority - b.priority
    })

  for (const rule of candidates) {
    const { text, missing } = fillTemplate(rule.opening_template, vars)

    // Skip a rule this session cannot satisfy — e.g. a staff_referral
    // template needing {{referral_topic}} when the topic is empty.
    if (missing.length > 0) continue

    return {
      opening: text,
      strategy: rule.opening_strategy,
      askForEmail: rule.ask_for_email,
      ruleId: rule.id,
      matchedOn,
      usedFallback: false,
    }
  }

  return {
    opening: FALLBACK_OPENING,
    strategy: 'fallback_generic',
    askForEmail: false,
    ruleId: null,
    matchedOn,
    usedFallback: true,
  }
}