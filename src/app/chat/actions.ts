'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getGuestSession, checkRateLimit } from '@/lib/guest'
import { safeRedact } from '@/lib/redaction'
import { assessKeywordRisk, combineRisk, EMERGENCY_SCRIPTS } from '@/lib/risk'
import { classifyRisk, generateReply } from '@/lib/nightingale-ai'
import type { LlmTurn } from '@/lib/llm'
import { extractFacts, type ExistingFact } from '@/lib/memory'
import { generateArticulationCard, recordValueEvent } from '@/lib/value-events'
import type { KnowledgeEntry } from '@/lib/knowledge'
import { screenPatientReply } from '@/lib/output-gate'

/**
 * SEND MESSAGE — the single write path for guest conversation.
 *
 * Everything funnels through this one server action, deliberately.
 * No INSERT is granted to the client, so PHI redaction and risk gating
 * cannot be bypassed by anyone talking to the API directly.
 *
 * Order of operations is fixed and will not change as features land:
 *   1. authorise (valid guest session)
 *   2. rate limit
 *   3. persist the raw message  <- encrypted at rest by Postgres
 *   4. redact                   <- DONE: src/lib/redaction.ts, fails closed
 *   5. risk gate                <- STEP 3, runs BEFORE any reply exists
 *   6. generate reply           <- STEP 4, only reached if risk is low
 *   7. persist reply + audit
 */

const MAX_MESSAGE_LENGTH = 2000

export async function sendGuestMessage(content: string) {
  const text = content.trim()

  if (!text) return { error: 'Please type a message.' }
  if (text.length > MAX_MESSAGE_LENGTH) {
    return { error: 'That message is a little long — could you shorten it?' }
  }

  const lead = await getGuestSession()
  if (!lead) {
    return { error: 'expired' }
  }

  const now = new Date()
  const { allowed, count } = checkRateLimit(lead, now)

  if (!allowed) {
    return {
      error:
        'You are sending messages very quickly. Please wait a moment and try again.',
    }
  }

  const admin = createAdminClient()

  // 4. Redact BEFORE anything leaves this server. safeRedact fails closed:
  //    if the pipeline throws, the model receives a withheld marker rather
  //    than raw text. Storing both columns is deliberate — the patient sees
  //    their own words, the model only ever sees content_redacted.
  const redaction = safeRedact(text)

  const { data: guestMessage, error: insertError } = await admin
    .from('messages')
    .insert({
      lead_session_id: lead.id,
      sender: 'guest',
      content: text,
      content_redacted: redaction.redacted,
      redaction_applied: redaction.applied,
      escalation_required: false,
    })
    .select('id')
    .single()

  if (insertError || !guestMessage) {
    return { error: 'Something went wrong saving your message. Please try again.' }
  }

  // 5. RISK GATE — before any reply exists.
  //
  //    Layer 1 runs on the RAW text: keyword matching is local, instant, and
  //    placeholders must not break a phrase match.
  //    Layer 2 sends only REDACTED text to the model.
  //    combineRisk() takes the higher of the two — the model can raise the
  //    floor but never lower it, and a null (timeout, outage, bad JSON)
  //    leaves the keyword verdict standing.
  const keywordRisk = assessKeywordRisk(text)

  const history = await loadRedactedHistory(admin, lead.id, redaction.redacted)

  /**
   * When the deterministic floor has already returned high, the classifier
   * cannot change the outcome. combineRisk takes the maximum and nothing
   * ranks above high, so ORDER[llm] <= ORDER[keyword] short-circuits for
   * every possible answer it could give.
   *
   * Calling it anyway put a network round trip in front of the emergency
   * script: 6s timeout, 1.5s backoff, 6s retry. During a provider outage a
   * woman who typed "difficulty breathing" waited 13.5 seconds on a spinner
   * before being told to call 999, for a verdict that was already decided
   * locally in under a millisecond.
   *
   * Skipped rather than made non-blocking, because there is nothing for it
   * to contribute. Every other path still runs both layers, and combineRisk
   * still receives null the same way it does on a timeout.
   */
  const llmRisk =
    keywordRisk.level === 'high' ? null : await classifyRisk(history)

  const risk = combineRisk(keywordRisk, llmRisk)

  // The risk verdict is stamped on the GUEST message, because it describes
  // what the patient said. This is what test_risk_escalation asserts on.
  await admin
    .from('messages')
    .update({
      risk_level: risk.level,
      risk_reason: risk.reason,
      // Stored rather than re-derived. The UI used to guess scope by
      // string-searching risk_reason, which was wrong for every high-risk
      // out-of-scope match.
      scope: risk.scope,
      confidence: risk.confidence,
      risk_provenance: risk.assessedAt,
      escalation_required: risk.escalationRequired,
    })
    .eq('id', guestMessage.id)

  // 6. REPLY. On high risk the AI stops: no education, no reassurance, no
  //    hedging — only the script for that emergency kind. Brief §6 forbids
  //    advice and false reassurance once risk is high.
  let reply: string
  let grounding: KnowledgeEntry[] = []

  if (risk.level === 'high' && risk.emergencyKind) {
    reply = EMERGENCY_SCRIPTS[risk.emergencyKind].body

    /**
     * Say why there is no Fairbloom button.
     *
     * The scope explanation lived only in the medium branch, so on a high-risk
     * out-of-scope message she got the 999 script and then watched the option
     * to reach the clinic simply not appear. A control vanishing without a
     * reason reads as a glitch, and this is the worst possible moment to look
     * broken. Naming the limit is the same honesty as refusing to offer a
     * nurse who cannot help.
     */
    if (risk.scope === 'out_of_scope' && risk.emergencyKind === 'medical') {
      reply +=
        '\n\nI should also be clear about why I am not offering to pass this ' +
        'to Fairbloom: we are a fertility and women\u2019s health clinic, and ' +
        'this is not something our nurses can assess. Emergency care is the ' +
        'right place for it, and sending it to us would only delay you.'
    }
  } else if (risk.level === 'med') {
    const honest =
      'Thank you for telling me — I want to be honest with you rather than guess. ' +
      'What you have described could mean several different things, and I am not ' +
      'able to tell you which without a clinician looking at it properly.\n\n'

    if (risk.scope === 'out_of_scope') {
      // We will not imply a safety net we cannot provide. Naming our own
      // limits is safer than a referral that delays real care.
      reply =
        honest +
        'I should be straight with you about one thing: Fairbloom is a fertility ' +
        'and women\u2019s health clinic, so this is not something our nurses can assess. ' +
        'Please see a GP, or go to a hospital emergency department if it worsens or ' +
        'you feel unwell with it.\n\n' +
        'I am still here if you have questions about anything we do cover.'
    } else if (risk.scope === 'unclear') {
      reply =
        honest +
        'If this is related to your periods, pregnancy, fertility or sexual health, ' +
        'I can pass it to a nurse at Fairbloom. If it is something else, a GP or an ' +
        'emergency department is the better place. Which sounds closer?'
    } else {
      /**
       * In scope and medium risk: gather before offering the handoff.
       *
       * This branch used to return a fixed sentence and go straight to the
       * button, so the nurse received one line — "I found a lump" — and her
       * eleven minutes started with a blank. Two or three plain questions
       * first produce a payload she can act on, and someone who has answered
       * them is more invested than someone shown a button.
       *
       * The fixed text remains as the fallback: if the model is unavailable
       * we still offer the nurse, we just cannot ask anything first.
       */
      const gathered = await generateReply(history, {
        referralTopic: lead.referral_topic,
        gatherIntake: true,
      })

      /**
       * The intake questions are patient-facing generated text too, so they
       * go through the same gate. A model asked to ask questions can still
       * slip a diagnosis into the sentence before them.
       */
      const gatheredScreened = gathered
        ? screenPatientReply(gathered.text)
        : null

      if (gatheredScreened?.blocked) {
        console.warn(
          JSON.stringify({
            event: 'output_gate_blocked',
            lead_session_id: lead.id,
            reasons: gatheredScreened.reasons,
            at: new Date().toISOString(),
          }),
        )
      }

      reply =
        gatheredScreened?.text ??
        honest +
          'This is something Fairbloom can help with. I would rather pass it to a nurse ' +
          'here than give you an answer that sounds confident and turns out to be wrong. ' +
          'Would you like me to?'

      grounding = gathered?.offered ?? []
    }
  } else {
    // Low risk: an ordinary answer. Gathering happens in the medium branch
    // above, where there is actually something for a nurse to receive.
    const generated = await generateReply(history, {
      referralTopic: lead.referral_topic,
    })

    // Honest degradation. If the model is down we say so rather than
    // improvising clinical-sounding text from a template.
        /**
     * Scenario 15: the prompt is not a control. Screen what the model wrote
     * before a stranger reads it under the clinic's name. Runs on the
     * generated text only - the emergency scripts are fixed strings written
     * by us and are not passed through here.
     */
    const screened = generated ? screenPatientReply(generated.text) : null

    if (screened?.blocked) {
      console.warn(
        JSON.stringify({
          event: 'output_gate_blocked',
          lead_session_id: lead.id,
          reasons: screened.reasons,
          at: new Date().toISOString(),
        }),
      )
    }
    reply =
      screened?.text ??
      'I am having trouble reaching my language service just now, so I would ' +
        'rather not guess at an answer. Your message is saved. Please try ' +
        'again in a moment, or I can pass this to the clinic for you.'

    grounding = generated?.offered ?? []
  }
  const { data: aiMessage } = await admin
    .from('messages')
    .insert({
      lead_session_id: lead.id,
      sender: 'ai',
      // Markers are stripped from the visible text; the citations table
      // holds the link. The reader gets prose, the record gets provenance.
      // Strip our id markers, and any markdown link the model produced
      // despite being told not to — a raw URL in a patient-facing message
      // is worse than a missing citation.
      content: reply
        .replace(/\s*\[[a-z]+-\d+\]\([^)]*\)/gi, '')
        .replace(/\s*\[[^\]]+\]\(https?:\/\/[^)]*\)/gi, '')
        .replace(/\s*\[[a-z]+-\d+\]/gi, '')
        .trim(),
      redaction_applied: false,
      risk_level: risk.level,
      risk_reason: risk.reason,
      scope: risk.scope,
      // On a scripted emergency response we are highly confident, because we
      // wrote it. On the low-risk placeholder we are not.
      confidence: risk.level === 'low' ? 'low' : 'high',
      risk_provenance: risk.assessedAt,
      escalation_required: risk.escalationRequired,
    })
    .select('id')
    .single()

      // 6b. LIVING MEMORY. Runs after the reply so a slow extraction never
  //     delays the patient's answer, and never blocks an emergency script.
  //     Failure here degrades the profile, not the conversation.
    /**
   * 6a. CITATIONS.
   *
   * A row per source the model actually used. We parse the [id] markers out
   * of the reply and match them against what we offered — an id we did not
   * supply cannot resolve, so a hallucinated citation is dropped rather than
   * stored. That is what makes "citations resolve to real spans" true rather
   * than asserted.
   *
   * The marker is stripped from the displayed text; the citation is rendered
   * separately, so the person reads prose and the record keeps the link.
   */
  if (aiMessage?.id && grounding.length > 0) {
    const used = new Set(
      [...reply.matchAll(/\[([a-z]+-\d+)\]/gi)].map((m) => m[1].toLowerCase()),
    )

    const cited = grounding.filter((entry) => used.has(entry.id.toLowerCase()))

    for (const entry of cited) {
      await admin.from('citations').insert({
        message_id: aiMessage.id,
        source_title: entry.sourceTitle,
        source_url: entry.sourceUrl,
        source_org: entry.sourceOrg,
        // The exact sentence the claim came from, so a reviewer can compare
        // it against what the assistant wrote.
        quoted_span: entry.text,
        span_start: 0,
        span_end: entry.text.length,
      })
    }
  }
  const memoryResult = await updateMemory(
    admin,
    lead.id,
    guestMessage.id,
    history,
  ).catch(() => ({ extracted: 0, superseded: 0 }))
    /**
   * 6c. VALUE EVENTS (§2).
   *
   * The articulation card is offered once, after the person has said enough
   * that we know what it is about, and only when the conversation is calm.
   * Offering a shareable card to someone mid-emergency would be grotesque.
   */
  /**
   * Offered once, when the conversation is calm and we know enough about
   * what it concerns. Gated on the profile having any content rather than
   * on this turn producing new facts — a person can say something worth a
   * card without adding to the record.
   */
  const { count: factCount } = await admin
    .from('memory_items')
    .select('id', { count: 'exact', head: true })
    .eq('lead_session_id', lead.id)

  if (risk.level === 'low' && (factCount ?? 0) > 0) {
    const { count: alreadyOffered } = await admin
      .from('value_events')
      .select('id', { count: 'exact', head: true })
      .eq('lead_session_id', lead.id)
      .eq('value_type', 'articulation_card')

    if (!alreadyOffered) {
      const context = history
        .slice(-4)
        .map((t) => `${t.role === 'model' ? 'ASSISTANT' : 'PERSON'}: ${t.text}`)
        .join('\n')

      const articulation = await generateArticulationCard(context)

      if (articulation) {
        await recordValueEvent({
          clinicId: lead.clinic_id,
          leadSessionId: lead.id,
          messageId: aiMessage?.id ?? null,
          valueType: 'articulation_card',
          payload: articulation.text,
        })
      }
    }
  }

  // Every substantive low-risk answer is itself a value event, logged
  // explicitly rather than inferred later from message counts.
  if (risk.level === 'low' && aiMessage?.id) {
    await recordValueEvent({
      clinicId: lead.clinic_id,
      leadSessionId: lead.id,
      messageId: aiMessage.id,
      valueType: 'service_answer',
    })
  }

  // 7. Counters + audit. Metadata only — never the message text.
  /**
   * Counters only. Deliberately NOT checked: the message is saved, the risk
   * gate has run and the reply exists. Failing the request here would throw
   * away a completed answer over a rate-limit counter, which is the wrong
   * trade in the wrong direction.
   */
  await admin
    .from('lead_sessions')
    .update({
      last_active_at: now.toISOString(),
      last_request_at: now.toISOString(),
      request_count: count,
    })
    .eq('id', lead.id)

  await admin.from('audit_logs').insert({
    actor_id: null,
    actor_role: 'guest',
    action: 'message.created',
    resource_type: 'message',
    resource_id: guestMessage.id,
    metadata: {
      lead_session_id: lead.id,
      source_channel: lead.source_channel,
      content_length: text.length,
      redaction_applied: redaction.applied,
      // Counts only, e.g. { ic: 1, name: 1 }. Never the values.
      redacted_kinds: redaction.summary,
            risk_level: risk.level,
      risk_matched: risk.matched,
      risk_source: risk.source,
      llm_classifier_available: llmRisk !== null,
      // Counts only — never the fact values, which are clinical content.
      facts_extracted: memoryResult.extracted,
      facts_superseded: memoryResult.superseded,
      reply_id: aiMessage?.id ?? null,
    },
  })

  revalidatePath('/chat')
  return { ok: true }
}

/**
 * Build the model's view of the conversation: REDACTED text only, ever.
 *
 * The last ~10 turns are included because crisis frequently develops across
 * messages rather than appearing in one — the classifier needs trajectory,
 * not a single line. The message just written is appended from memory since
 * the row may not have replicated yet.
 */
async function loadRedactedHistory(
  admin: ReturnType<typeof createAdminClient>,
  leadSessionId: string,
  latestRedacted: string,
): Promise<LlmTurn[]> {
  const { data } = await admin
    .from('messages')
    .select('sender, content, content_redacted, created_at')
    .eq('lead_session_id', leadSessionId)
    .order('created_at', { ascending: false })
    .limit(11)

  const rows = (data ?? []).reverse()

  const turns: LlmTurn[] = rows
    // Drop the row we just inserted; it is appended below from memory.
    .slice(0, -1)
    .map((row) => ({
      role: row.sender === 'ai' ? ('model' as const) : ('user' as const),
      /**
       * Guest text uses the redacted column.
       *
       * Assistant text is redacted too, which is not obvious. Our own channel
       * opening interpolates the person's social handle from the rules table —
       * so an unredacted assistant turn would send @their_handle to the model
       * even though the guest never typed it. Redacting both directions closes
       * that, and costs nothing where there is nothing to redact.
       */
      text:
        row.sender === 'ai'
          ? safeRedact(row.content ?? '').redacted
          : (row.content_redacted ?? '[withheld]'),
    }))
    .filter((turn) => turn.text.length > 0)

  turns.push({ role: 'user', text: latestRedacted })

  // Gemini rejects a history that does not start with a user turn.
  while (turns.length > 0 && turns[0].role !== 'user') turns.shift()

  return turns
}

interface FactRow extends ExistingFact {
  supersedes: string | null
}

/**
 * LIVING MEMORY PERSISTENCE — the provenance chain.
 *
 * Brief §7: memory items carry value, status, provenance_pointer and
 * updated_at, and corrections must leave an unbroken chain.
 *
 * We never delete and never overwrite in place. When a fact is corrected:
 *   1. the old row's status becomes 'corrected' (or 'stopped'/'resolved')
 *   2. a new row is inserted, with `supersedes` pointing at the old row's id
 *   3. both rows keep their own provenance_pointer to the message that
 *      produced them
 *
 * A clinician can therefore reconstruct not just what is true now, but what
 * the patient said, when, and what replaced it. That history is the point —
 * "Advil (stopped last week)" means something different from "no medications".
 */
async function updateMemory(
  admin: ReturnType<typeof createAdminClient>,
  leadSessionId: string,
  sourceMessageId: string,
  history: LlmTurn[],
) {
  /**
   * Current profile: the LEAF rows, the ones nothing else supersedes.
   *
   * This previously selected `supersedes is null`, which returns the row at
   * the START of each chain rather than the end. A correction writes a row
   * whose supersedes is NOT null, so the correction was invisible here. A
   * SECOND correction therefore matched the original row again and inserted
   * a second child of the same parent — two rows both claiming to be current,
   * with nothing to order them.
   *
   * Concretely: "I take Advil", then "actually I stopped it", then "actually
   * I started again" left the profile showing Advil active AND Advil stopped
   * side by side. A nurse reading that payload cannot tell which is true, in
   * the one category where guessing wrong changes a prescription.
   *
   * This is the same leaf rule ProfilePanel uses to render, so what the
   * extractor treats as current and what the patient sees cannot disagree.
   */
  const { data: allRows } = await admin
    .from('memory_items')
    .select('id, kind, value, status, supersedes')
    .eq('lead_session_id', leadSessionId)
    .order('created_at', { ascending: true })

  const rows = (allRows ?? []) as FactRow[]
  const supersededIds = new Set(rows.map((row) => row.supersedes).filter(Boolean))
  const existing = rows.filter((row) => !supersededIds.has(row.id)) as ExistingFact[]

  const facts = await extractFacts(history, existing)
  if (facts.length === 0) return { extracted: 0, superseded: 0 }

  const now = new Date().toISOString()
  let superseded = 0

  /**
   * Two facts in one batch must never supersede the same row: that is the
   * same fork, created inside a single turn instead of across two.
   */
  const claimedTargets = new Set()

  for (const fact of facts) {
    // Find the row this fact replaces. Match on the value the model named,
    // falling back to an exact value match within the same kind.
    const target = fact.supersedesValue
      ? existing.find(
          (row) =>
            row.value.toLowerCase() === fact.supersedesValue!.toLowerCase(),
        )
      : existing.find(
          (row) =>
            row.kind === fact.kind &&
            row.value.toLowerCase() === fact.value.toLowerCase(),
        )

    if (target && claimedTargets.has(target.id)) continue

    if (target) {
      // Skip a no-op: the model occasionally re-reports an unchanged fact.
      const unchanged =
        target.status === fact.status &&
        target.value.toLowerCase() === fact.value.toLowerCase()
      if (unchanged) continue

      /**
       * The old row is retired, not deleted. Its status records HOW it ended:
       * a stopped medication and a mistaken one are clinically different, and
       * flattening both to "removed" would lose that.
       */
      await admin
        .from('memory_items')
        .update({
          status: fact.status === 'active' ? 'corrected' : fact.status,
          updated_at: now,
        })
        .eq('id', target.id)

      claimedTargets.add(target.id)
      superseded += 1
    }

    await admin.from('memory_items').insert({
      lead_session_id: leadSessionId,
      kind: fact.kind,
      value: fact.value,
      status: fact.status,
      timeline: fact.timeline,
      // The exact message that produced this fact. This is what
      // test_memory_mutation resolves to prove the chain is unbroken.
      provenance_pointer: sourceMessageId,
      supersedes: target?.id ?? null,
      conflict_flag: false,
      updated_at: now,
    })
  }

  return { extracted: facts.length, superseded }
}