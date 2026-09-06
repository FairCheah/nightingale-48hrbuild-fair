# Nightingale — Fairbloom Fertility & Women's Health

Nightingale is a first-touch-to-care messenger for a fictional fertility and women's health clinic.

A patient can arrive from an ad, referral link, social channel or the clinic website, ask a question without creating an account, receive initial support, and request human review. If she later chooses to create an account, the conversation and context she has already shared can move forward with her.

Fairbloom was chosen as a fictional fertility and women's health clinic because these are areas where privacy, stigma and hesitation can strongly affect whether someone asks for help.

> **Stack:** Next.js 16 · TypeScript · Tailwind CSS · Supabase (Postgres, Auth, RLS) · Anthropic Claude Haiku 4.5 · Vitest

## Round Two

Round Two focused mainly on stress-testing the existing build rather than adding a large number of new features.

The main additions and fixes include:

- clinician triage queue and case view
- clinician replies returning to the patient's Nightingale conversation
- clinician-only case closure with closure reason and internal handover note
- patient-requested human review
- optional contact preference after escalation
- cross-device recovery after patient authentication
- English, Malay and common Manglish deterministic emergency rules
- output-side safety checks on patient-facing AI responses
- improved Living Memory correction history
- fixes to guest-data retention, redaction and clinical workflow paths

The detailed assessment of all 21 feedback scenarios is included in the Round Two Technical Brief.

---

# Setup

## Prerequisites

You will need:

- Node.js 20+
- a Supabase project
- an Anthropic API key

Clone and install:

```bash
git clone <repo-url>
cd nightingale-app
npm install
```

## 1. Environment variables

Create `.env.local` in the project root:

```env
NEXT_PUBLIC_SUPABASE_URL=https://<your-project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
ANTHROPIC_API_KEY=sk-ant-<your-key>
```

The Supabase service-role key is server-only and must never be exposed to the browser.

## 2. Database

Run the SQL files in `supabase/migrations/` in numerical order.

Round One migrations contain the base schema, authentication, RLS, channel rules, conversion and guest-retention logic.

Round Two adds:

```text
17_retention_integrity.sql
18_reachability.sql
19_escalation_patient_link.sql
20_responder_identity.sql
21_neutral_responder_names.sql
22_case_closure.sql
23_message_scope.sql
24_contact_preference.sql
25_clinical_reply_grants.sql
26_night_opening_promise.sql
```

Important Round Two changes include:

- guest-retention integrity fixes
- clinician responses
- escalation response deadlines
- PatientSession links on escalations
- responder identity
- clinician-only case closure
- stored message scope
- patient contact preference
- clinical reply permissions
- correction of unsupported after-hours wording

## 3. Test accounts

Create the accounts in Supabase Authentication and assign the corresponding care-team roles using the seed migration.

| Email | Role | Password |
|---|---|---|
| `patient@fairbloom.test` | patient | `Fairbloom123!` |
| `staff@fairbloom.test` | staff | `Fairbloom123!` |
| `nurse@fairbloom.test` | nurse | `Fairbloom123!` |
| `clinician@fairbloom.test` | clinician | `Fairbloom123!` |

Self-signup creates a patient account. Care-team roles are provisioned separately rather than selected by the user.

## 4. Run locally

```bash
npm run dev
```

Then open:

```text
http://localhost:3000
```

---

# Useful routes

## Guest / patient

| Route | Purpose |
|---|---|
| `/hello` | Fresh Nightingale entry |
| `/chat` | Patient conversation |
| `/continue` | Secure conversion / signup |
| `/login` | Login |
| `/resume` | Restore an authenticated patient's existing conversation |
| `/link-invalid` | Honest expired or invalid-link state |

Example acquisition URL:

```text
/hello?source=instagram_ad_click&campaign=ivf_over40&creative=carousel_a
```

For a fresh guest session, use an incognito window.

## Care team

| Route | Role | Purpose |
|---|---|---|
| `/staff/triage` | nurse, clinician | Clinical escalation queue |
| `/staff/leads` | care team | Funnel and warm-lead view |
| `/staff/referral` | care team | Generate patient referral links |
| `/staff/social` | care team / demo | Social comment simulator |

### Suggested clinical workflow

1. Sign in as a nurse.
2. Open `/staff/triage`.
3. Review an escalation and send a reply.
4. Return to the patient's conversation and confirm the reply appears in the thread.
5. Sign in as a clinician.
6. Open the same case.
7. Close the case with a closure reason and internal handover note.

Nurses can review and reply to a case, but only clinicians can close it.

---

# Running the tests

Run:

```bash
npx vitest run
```

The current Round Two suite contains **52 tests across 11 files**.

Scenario-specific tests cover the areas prioritised during Round Two:

| Test | Covers |
|---|---|
| `test_scenario_08_deterministic_floor` | Emergency floor and model-can-raise-but-not-lower behaviour |
| `test_scenario_09_multilingual_floor` | 25 Malay and Manglish emergency phrasings, English baseline and correct emergency-path selection |
| `test_scenario_10_redaction_order` | Risk-before-redaction ordering and PHI patterns |
| `test_scenario_12_guest_retention` | Guest-data destruction path |
| `test_scenario_15_output_gate` | Unsafe patient-facing AI output |
| `test_scenario_16_correction_chain` | Living Memory corrections |
| `test_scenario_17_guest_facts_survive` | Guest facts surviving conversion |
| `test_scenario_18_payload_read_cold` | Clinical handoff payload |
| `test_scenario_20_access_control` | Authenticated access-control behaviour |

Two additional `test_brief_*` files cover Round One requirements rather than one specific Round Two scenario.

Some Round Two scenarios were also verified manually, including provider failure and authenticated cross-device recovery.

### Scenario 20 note

The access-control test verifies important authenticated isolation behaviour, including patient-to-patient isolation, protected audit logs and denied client-side message writes.

However, I have **not yet completed a full end-to-end test using two separate clinic identities**.

For that reason, Scenario 20 is marked **PARTIAL** in the Technical Brief rather than claiming that multi-clinic isolation is fully proven.

---

# Where redaction happens

PHI redaction lives in:

```text
src/lib/redaction.ts
```

Patient messages follow this order:

```text
raw patient message
        ↓
deterministic risk rules
        ↓
redaction
        ↓
LLM
        ↓
patient-facing response
```

The ordering is deliberate.

Emergency risk is assessed on the patient's original message before redaction. This prevents a redaction pattern from accidentally removing a clinically important phrase before the deterministic safety rules see it.

Only the redacted version is sent to the language model.

The redactor covers items including:

- explicitly introduced names
- Malaysian MyKad / NRIC patterns
- Singapore-style IDs
- Malaysian phone numbers
- email addresses
- social handles

`safeRedact()` fails closed. If redaction itself fails, the raw message is withheld from the model rather than being sent unredacted.

Round Two also fixed a name-redaction bug that was removing clinical language. For example:

```text
Original:  I am having difficulty breathing
Redacted:  I am [NAME_1]
```

The deterministic risk rules still classified the message correctly because they run on the raw message before redaction. This is why the ordering above matters.

Application logging was reviewed separately because redaction protects the model boundary, not every possible logging or error path.

---

# Deterministic emergency safety

The emergency floor is implemented separately from the LLM:

```text
src/lib/risk.ts
```

The model may increase a patient's risk level, but it cannot lower the deterministic result.

This means an emergency pathway can still work when:

- the Anthropic provider is unavailable
- the model times out
- the model returns invalid output
- the deterministic rule already identifies a High-risk phrase

Round Two expanded the deterministic emergency layer to recognise English, Malay and common Manglish phrasing.

**Measured before the change: 1 of 25 Malay and Manglish emergency phrasings reached High risk. After: 25 of 25, with English coverage unchanged.**

The multilingual test also checks that the phrase reaches the correct emergency pathway, rather than only checking whether the final risk level is High.

If the LLM is unavailable during an ordinary low-risk conversation, Nightingale gives an honest service-unavailable response instead of improvising clinical advice.

---

# Output-side safety

Patient-facing AI output is also checked after generation.

```text
src/lib/output-gate.ts
```

The output gate can block known forms of:

- direct diagnosis
- false reassurance
- unsafe medication changes or instructions

This is intentionally separate from the system prompt. A prompt is guidance to the model; it is not treated as the only safety control.

The current gate is deterministic and therefore has a known limitation: it recognises unsafe phrasing patterns rather than every possible unsafe meaning.

---

# Living Memory

Nightingale maintains structured information from the patient's conversation, including:

- presenting concerns
- symptoms
- medications
- allergies
- useful patient wording

Corrections do not silently overwrite previous clinical information.

Instead, the history is preserved so the current fact and the earlier corrected state can still be seen by the clinician.

Round Two also fixed a correction-of-a-correction problem that could previously fork the memory history.

---

# Clinical handoff

A patient can request human review without creating an account or providing contact details first.

Once an escalation is created, the clinical view can show:

- risk level and reason
- triggering patient message
- triage summary
- current Living Memory facts
- corrected historical facts
- acquisition context
- contact preference
- response deadline

A patient's preferred contact route is requested **after** the case is sent. It is not a condition for receiving help.

Current options include:

- email
- WhatsApp
- returning to the Nightingale conversation

These are stored as preferences. Nightingale does **not** currently provide outbound WhatsApp, SMS or email delivery.

Clinician replies can return to the patient's existing Nightingale conversation.

---

# Case closure

Nurses and clinicians have different clinical permissions.

A nurse can:

- view the clinical queue
- review a case
- reply to the patient

A clinician can do the same and can additionally:

- select a closure reason
- leave an internal handover note
- close the case

Clinician-only closure is also enforced at the database level.

Closed cases remain part of the clinical record for later reference.

---

# How RBAC is enforced

Nightingale uses several layers rather than relying on a single UI check.

## 1. Route protection

`src/proxy.ts` protects staff routes before the page loads.

Unauthenticated users and patients cannot access `/staff/*`.

## 2. Server-side role checks

`src/app/staff/layout.tsx` re-checks the authenticated user's role.

Clinical triage is restricted to clinical roles.

## 3. Supabase Row Level Security

RLS policies provide database-level restrictions.

Broadly:

| Role | Access |
|---|---|
| guest | No direct authenticated database account |
| patient | Own patient data |
| staff | Acquisition / lead information only |
| nurse | Clinical read and escalation reply |
| clinician | Nurse permissions plus case closure |

Clinical triage reads use the authenticated clinician's Supabase session rather than trusting a `clinic_id` sent by the browser.

The service-role client is reserved for server-side operations that genuinely require privileged access.

Round Two also found a case where an RLS policy existed but the table lacked the corresponding authenticated grant. The grant was added so the intended policy is now actually exercised.

---

# Guest data retention

Anonymous guest data is intended to be temporary.

The guest-retention window is 14 days.

Round Two found that the original purge could fail because foreign-key relationships prevented deletion while making the process appear successful.

Migration 17 corrects those relationships and the deletion path.

Expired guest data can now be removed without deleting separately governed clinical escalation records.

The retention path is covered by a Round Two scenario test, although other guest-boundary controls such as rate limiting should still be re-verified before treating Scenario 12 as fully complete.

---

# Known gaps

The following limitations are intentionally documented rather than hidden:

- **No active re-engagement after the tab closes.** Clinician replies can wait inside the patient's Nightingale conversation, but there is currently no working Web Push, SMS, WhatsApp or email transport that wakes a closed session.
- **Anonymous cross-device recovery is incomplete.** An authenticated patient can log in on another device and restore the conversation. A completely anonymous guest does not have the same recovery path.
- **Outbound email is not implemented.** Nightingale does not pretend that an email has been sent when no transport exists.
- **Contact preference is not message delivery.** Selecting WhatsApp or email records how the patient would prefer to be reached; the build does not currently send through those channels.
- **Consent text is not versioned per consent event.**
- **Mandarin and other unverified languages are not covered by the deterministic emergency floor.**
- **The interface itself is still mainly English even when Malay/Manglish emergency phrases are recognised.**
- **Contradiction detection is incomplete.** Multiple safety-relevant facts can be shown for human review, but negation-aware contradiction handling still needs improvement.
- **Living Memory provenance is based on a message reference rather than an immutable evidence snapshot.**
- **The clinician workflow is a reply mechanism rather than a true shared live thread.** Later patient messages still go through the assistant.
- **Two-clinic isolation has not yet been verified end-to-end with two separate clinic identities.**
- **The knowledge corpus has not undergone formal clinician review.**

These limitations are discussed in more detail in the Round Two Technical Brief.

---

# Synthetic data only

No real patient data is used in the repository, database or demonstration.

All accounts, conversations and clinical examples were created specifically for this build.