# NIGHTINGALE: TECHNICAL BRIEF

**Fairbloom Fertility & Women's Health Clinic · Fair Cheah · September 2026**

---

## 1. Premise

Nightingale is Fairbloom Fertility & Women's Health's AI assistant. It connects a first inquiry — an ad click, a comment, or a link a nurse handed over — to a clinician, without asking a stranger to prove she deserves help first.

Fairbloom is fictional. The speciality was chosen because fertility, women's health and sexual health carry stigma, and stigma is often the real obstacle. Someone who suspects an STI may hesitate not because a form is too long, but because saying it out loud costs something. That principle shaped the anonymous guest path, neutral "Secure message" title, fourteen-day guest retention, unbranded shareable card, opening prompts, and the decision that a like alone never triggers contact.

The audience is women seeking reproductive and sexual health care, but the safety scope is anyone who arrives. A person with crushing chest pain on a fertility clinic's page still requires appropriate risk handling; cardiac, stroke and respiratory concerns cannot be ignored simply because they fall outside Fairbloom's speciality.

---

## 2. Architecture

Five runtime dependencies: Next.js, React, React-DOM, two Supabase clients. No auth library, no state manager, no component kit, no ORM. The Anthropic API is called with plain `fetch`. Fewer moving parts, fewer places a safety guarantee can leak.

```text
sendGuestMessage()                    one server action, the only write path
    ├─ resolve session                httpOnly cookie → lead_sessions
    ├─ rate limit                     8/min
    ├─ persist raw                    messages.content
    ├─ REDACT                         → messages.content_redacted
    ├─ RISK GATE
    │   ├─ Layer 1  keywords — offline, deterministic
    │   └─ Layer 2  LLM — redacted text only
    │       └─ combineRisk = max(L1, L2)
    ├─ REPLY
    │   ├─ high  → scripted, no advice
    │   ├─ med   → honest uncertainty, scope-aware routing
    │   └─ low   → grounded reply + resolvable citations
    ├─ MEMORY    extract facts, mutate with provenance
    └─ AUDIT     ids, counts, metadata — never content
```

Three properties hold structurally rather than by convention.

**Every write goes through one server action** — no `INSERT` is granted to authenticated users on any table, so redaction and risk gating cannot be bypassed by talking to the API directly.

**Risk is computed before a reply exists**, not filtered afterwards.

**Access control is three independent layers** — proxy, server component, and Row Level Security — none trusted alone.

---

## 3. Data schema

Thirteen tables, sixteen migrations.

```text
lead_sessions ┬─ messages ── citations
              │      └─ memory_items (provenance_pointer)
              │           └─ supersedes → memory_items
              │
              ├─ value_events
              ├─ escalations
              └─ patient_sessions ── app_users
```

**Messages ↔ Profile.** Each `memory_item` carries `provenance_pointer`, a foreign key to the exact message that produced it. Ask "why does this say she stopped Advil?" and the answer is a row you can open.

**Mutation without loss.** On correction, the old row is retired rather than overwritten — its `status` changes, a new row is inserted with `supersedes` pointing back, and both keep their own provenance to different messages. "Advil, stopped last week" and "no medications" are clinically different pictures; flattening the first into the second loses what a clinician needs.

**Citations** store `source_org`, `source_title`, `source_url` and `quoted_span`. Only ids the model was handed can resolve, so an invented citation is dropped.

**Escalations stand alone.** The payload holds the triggering message ID and its text, a profile snapshot as JSONB, provenance points, and acquisition context. The duplication is deliberate: guest messages are purged at fourteen days, and a clinical record must survive that.

**Attribution survives by join, not copy.** `patient_sessions.lead_session_id` reaches back to the arrival, so channel, campaign and creative are recoverable from any patient record.

**Migration is a relink, not a copy.** Messages and memory items keep their IDs and gain a `patient_session_id`. Copying would create rows whose provenance pointed at originals about to be purged — the chain would break silently.

**A clinician module attaches later** with no change to the escalation write path: `status` (`pending → in_review → responded → closed`), `clinician_response`, `clinician_id` and `responded_at` already exist, and a database trigger enforces that only a clinician may close a case, reading the acting role from `auth.jwt()`.

---

## 4. Channel considerations

Axes: **technically possible · legal under PDPA and Medicine Advertisements Board rules · permitted by platform policy · trust-compatible.**

MAB approval is required for healthcare advertising in Malaysia before publication — which constrains the creative, and is part of why attribution here is campaign-level and never condition-level.

### Implemented, green on all four axes

All six verified end-to-end.

| Channel | Why green |
|---|---|
| `staff_referral` | She was in the room; the note is quoted back verbatim. |
| `instagram_comment` | She commented publicly on this post. A private reply to a public comment is the response she invited, and Meta permits exactly that. Handle-only identity; the DM names no condition. |
| `instagram_ad_click` | She clicked. Campaign-level attribution. |
| `google_ad_click` | As above. |
| `google_reviews` | The clinic's own review reply carries an "ask us" link. Contact flows outward from the clinic's surface; she chooses to follow it. |
| `website_widget` | Already on the clinic's site. Page context, no tracking. |

`tiktok_comment` and `facebook_comment` have rules seeded and share the webhook shape; only the Instagram endpoint is built.

### Refused — red

| Channel | Why red |
|---|---|
| Competitor-review scraping | Public does not mean consent to be processed as a rival clinic's healthcare lead; it also creates platform and trust problems. |
| Health-thread DMs | Posting in a support group is not consent for a healthcare business to infer a condition and contact the author privately. |
| Condition-based retargeting | Inferred health information creates privacy and disclosure risks; an advertisement on a shared device can reveal something the user chose to research privately. |

The distinction is direction of contact: `google_reviews` lets the clinic offer a doorway that the person chooses to enter; scraping makes the clinic find someone who never asked.

### Yellow

`lead_form` is technically straightforward but reverses the value-before-authentication principle, so this build gives value first and allows authentication to trigger later.

Dormant-lead recall is commercially obvious but ethically delicate. The schema supports `active → cooling → dormant → recalled → suppressed`, but recall would require recorded marketing consent, be capped at one attempt, and be suppressed for anyone whose conversation touched high risk.

A low-cost additional green channel is a waiting-room QR code: **"Something you didn't want to say at the counter?"** It requires a printed card rather than a new technical pathway.

---

## 5. Assumptions and first principles

**Stigma, not friction, can be the first drop-off.** The brief emphasises response speed and long forms. For this speciality, an earlier barrier is that saying the concern itself costs something. That produced the anonymous path, neutral title, unbranded sharing and opening prompts.

**A model that can lower risk is a model that can kill someone.** Layer 1 is deterministic and offline; Layer 2 provides semantic understanding. `combineRisk` takes the maximum. If the model times out or returns nonsense, the keyword floor still stands. Over-escalation may cost a clinician minutes; under-escalation can cost a life.

**Not-yet-consented means not-yet-readable.** Guest clinical content is hidden from staff rather than asking the system to decide which words are "sensitive enough." Clinical content becomes visible once a patient session exists or the person explicitly asks for a human.

**Numbers must be re-derivable.** Prospect-facing statistics are generated from live system data and suppressed below a meaningful threshold rather than padded with marketing claims.

**High clinical risk is a compassion priority, not a sales priority.** High-risk leads carry a "do not contact for marketing" state, and contact suggestions are suppressed regardless of warm-lead score.

**Fourteen days, not thirty.** Unconsented free text in a stigma-sensitive setting is a liability, not an asset. The nightly purge removes content while retaining a PHI-free analytical skeleton, allowing abandonment analysis without keeping what visitors typed. Consent is also separated into three independently timestamped decisions: clinic sharing, conversation migration and marketing.

---

## 6. Where we invalidated the brief

The build challenged one important assumption: **"Send to Nurse/Clinic" is not automatically the safest destination.**

Testing produced an ambiguous cardiac concern on a fertility clinic pathway. Routing it to a Fairbloom nurse technically satisfied the escalation requirement but created a false safety net: a fertility clinic cannot meaningfully assess every out-of-scope emergency.

Risk rules therefore carry scope. In-scope concerns may be escalated to Fairbloom; out-of-scope concerns state clearly that Fairbloom cannot assess them and direct the user towards appropriate external care.

Safety actions also do not require account creation. Someone reporting heavy bleeding should not have to register before requesting human help; conversion occurs after the safety action rather than becoming a toll gate in front of it.

Testing also exposed failures that automated assertions missed. A summariser added an unstated anatomical detail, and another response offered harmless but prohibited medication advice.

The lesson was that the dangerous failure is often not obvious wrongness but **fluent plausibility**. Prompts therefore contain explicit anti-inference and clinical-boundary rules rather than relying on broad instructions such as "be safe."

---

## 7. Trade-offs and cuts

**Earned email — cut.** The conversion flow, consent separation and `email_sends` schema exist, but no mail transport was added. A fake send would be worse than an honest gap.

**Real Meta outbound DM — incomplete by design.** HMAC verification, payload parsing and deduplication are implemented; outbound messaging requires `instagram_manage_messages` and Meta App Review against a live Business account.

**Likes never trigger contact.** A comment is an utterance; a like is not. A private healthcare-related DM triggered by a like can expose the user on a lock screen.

**Knowledge corpus.** Twenty sourced public-health statements ground low-risk responses, but the corpus has not been clinician-reviewed. Production deployment would replace this content with clinically reviewed material.

**Not built.** Conflict flagging on contradictions and column-level encryption beyond Supabase's platform default.

---

## 8. VoiceAI strategy

`messages` already includes:

- `audio_transcript_id`
- `audio_url`
- `audio_duration_ms`
- `transcript_confidence`

A voice note is treated as a message whose text arrived through transcription. Everything downstream remains unchanged:

```text
redaction → risk gating → memory extraction → provenance
```

Voice introduces three additional risks.

First, spoken identifiers may arrive as words rather than digits, so number-word normalisation must precede redaction.

Second, low `transcript_confidence` on potentially high-risk language should raise risk rather than create reassurance.

Third, raw audio is PHI that cannot be meaningfully redacted, so it requires stricter retention than its transcript.

Prosody could carry distress that text loses, but inferring emotional state from voice is a substantially stronger claim than classifying words and would require clinical validation before deployment.

**Voice is a second door, not a replacement.**

---

## Verification

Eight required micro-tests, 43 assertions, all passing via:

```bash
npm test
```

All repository, database and demo data are synthetic.