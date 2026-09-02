# Nightingale — Fairbloom Fertility & Women's Health

A first-touch-to-care messenger. Someone arrives from an ad, a comment, a link a nurse handed them, or the clinic's website. They can ask a real question without an account, get a grounded answer, and — if and when they choose — become a patient with everything they already said carried forward intact.

**Why this clinic.** Fairbloom is fictional, and the specialty was chosen deliberately. Fertility, women's health and sexual health carry stigma, and stigma is what makes someone read a clinic's page at 2am rather than ask. Nearly every decision in this build traces back to that: the guest can talk without signing up, the browser tab says "Secure message" rather than the clinic's name, guest conversations are destroyed after 14 days, the shareable card carries no branding, opening prompts exist so nobody has to compose the first sentence, and a like on a post never triggers a DM.

The audience is women seeking reproductive and sexual health care. The safety scope is anyone who arrives, whatever they say — a person with crushing chest pain who happens to be on a fertility clinic's page is still a person with crushing chest pain, so cardiac, stroke and respiratory phrases are handled in full.

> **Stack:** Next.js 16 (App Router, Turbopack) · TypeScript · Tailwind v4 · Supabase (Postgres, Auth, RLS) · Anthropic Claude Haiku 4.5 · Vitest

---

## Setup

**Prerequisites:** Node 20+, a Supabase project, an Anthropic API key.

```bash
git clone <repo-url>
cd nightingale-app
npm install
```

### 1. Environment

Create `.env.local` in the project root:

```env
NEXT_PUBLIC_SUPABASE_URL=https://<your-project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service role key>
ANTHROPIC_API_KEY=sk-ant-<your key>
```

Supabase keys are under Project Settings → API. The service role key bypasses RLS and is server-only — `src/lib/supabase/admin.ts` throws if it is ever constructed in a browser.

---

### 2. Database

Run everything in `supabase/migrations/` in numerical order through the Supabase SQL Editor. They are numbered by execution order, not by date. 07 through 09 are fixes to earlier migrations and must not be skipped.

```text
01_initial_schema.sql            13 tables, RLS enabled, indexes, seed clinic
02_rls_policies.sql              initial policy set
03_seed_channel_rules.sql        23 channel rules incl. 6 intent-based
04_rls_role_refinement.sql       patient / staff / nurse / clinician separation
05_auth_bootstrap.sql            auth.users -> app_users, role forced to 'patient'
06_seed_users.sql                assigns care-team roles to the test accounts
07_fix_app_users_recursion.sql   RLS recursion fix on app_users
08_fix_grants.sql                restores authenticated SELECT
09_fix_service_role_grants.sql   restores service_role DML
10_conversion_and_retention.sql  migration consent, message scope, 14-day retention, purge function
11_channel_rules_ai_wording.sql  "AI assistant", never just "assistant"
12_opening_chips.sql             opening chips on channel rules
13_lead_chips.sql                opening chips column on lead sessions
14_referral_template.sql         referral template quotes the staff note
15_guest_content_visibility.sql  guest content hidden from staff until consent
```

---

### 3. Test accounts

Create these four in Supabase → Authentication → Users, then run `06_seed_users.sql` to assign roles. Self-signup always yields patient; care-team roles are provisioned deliberately, never self-selected.

| Email | Role | Password |
|---|---|---|
| `patient@fairbloom.test` | patient | `Fairbloom123!` |
| `staff@fairbloom.test` | staff | `Fairbloom123!` |
| `nurse@fairbloom.test` | nurse | `Fairbloom123!` |
| `clinician@fairbloom.test` | clinician | `Fairbloom123!` |

---

### 4. Run

```bash
npm run dev
```

## Where to go

### As a guest — use an incognito window

The guest identity is an httpOnly cookie, so open a fresh incognito window per visitor. Closing every incognito window clears it.

| URL | Channel |
|---|---|
| `/hello` | website_widget |
| `/hello?source=instagram_ad_click&campaign=ivf_over40&creative=carousel_a` | instagram_ad_click with attribution |
| `/hello?source=google_reviews` | google_reviews |

An ad click is a URL with tracking parameters, which is exactly what the second link is. Meta appends those parameters and sends the person to the clinic's destination URL; everything after the click is this system.

`/chat` and `/continue` become reachable once a session exists — they need the cookie.

**Try:** send two or three messages, watch the profile panel fill, then use Continue securely with Fairbloom.

### As care team — normal window, sign in first

| URL | What |
|---|---|
| `/login` | Sign in |
| `/staff/leads` | Conversion metrics per channel, warm-lead view |
| `/staff/referral` | Generate a patient link from a visit |
| `/staff/social` | Instagram comment webhook simulator |

Sign in as nurse@, look at `/staff/leads`, then sign out and look again as staff@. Same page, same data, visibly different: clinical concerns and contact details are hidden from the staff role, while the "do not contact for marketing" flag on a high-risk lead stays visible to both.

---

## Running the tests

```bash
npm test
```

**43 tests across 8 files.** All eight tests named in the brief are implemented. They run against the real Supabase project using synthetic data only; database-backed tests create their own rows and delete them afterwards.

| File | Brief test | Covers |
|---|---:|---|
| `test_guest_to_patient_conversion.test.ts` | 1 | Arrival with campaign attribution, auth, three consents, relink-not-copy migration. Provenance resolves to the original GuestMessage; attribution reachable from the patient session. A declined migration leaves the conversation behind. |
| `test_value_events.test.ts` | 2 | Every statistic re-derives from its own stored query. Below threshold, nothing renders. The shareable card stays under 240 characters and carries no branding. |
| `test_escalation_payload.test.ts` | 3 | Triggering message, triage summary, profile snapshot, resolving provenance, acquisition context. Status field and room for a clinician response. Nothing unredacted in the payload. |
| `test_risk_escalation.test.ts` | 4 | The four brief-mandated phrases, ambiguity handling, scope routing, and the asymmetric combiner — the model may raise risk, never lower it. |
| `test_memory_mutation.test.ts` | 5 | "I take Advil" → "Actually I stopped" leaves two rows, each with provenance resolving to the message that produced it, linked by supersedes. |
| `test_redaction.test.ts` | 6 | Names, Malaysian and Singapore IC, phones in several written forms, emails, social handles. Clinical language left intact. Audit summaries carry counts only. Fails closed. |
| `test_access_control.test.ts` | 7 | Signs in as real users through the anon key, so it tests the client path rather than the service role. Patient A cannot read Patient B. Audit logs unreachable by every role. No client can INSERT a message. |
| `test_trust.test.ts` | 8 | Scripted responses never claim clinical authority, always route to a real human, never offer false reassurance. Citation ids are unique and resolve. |

The brief names the tests with `.py` extensions. This is a TypeScript project, so they are Vitest rather than pytest — adding a Python runtime for eight files would have been a worse decision than keeping the tests in the language the code is written in. The names are preserved.

---

## Where redaction happens

`src/lib/redaction.ts` — the only gate between patient text and any language model.

Called from `src/app/chat/actions.ts` in `sendGuestMessage()`, immediately after the raw message is stored and before any LLM call:

```ts
const redaction = safeRedact(text)
```

**Then:**

- `messages.content` keeps what the patient actually said. They must see their own words, and a clinician needs the real thing.
- `messages.content_redacted` is what travels to the model. `loadRedactedHistory()` reads only that column.
- Assistant turns are redacted too. Not obvious, but the channel opening interpolates the person's social handle from the rules table, so an unredacted assistant turn would send @their_handle to the model even though the guest never typed it.
- `src/app/chat/escalate.ts` and `src/lib/value-events.ts` receive redacted text only.

**Deterministic regex, not a model.** Using an LLM to find PHI means sending the raw PHI to an LLM to discover what the PHI was. Regex is auditable, offline, and cannot fail open through a network timeout.

**Fails closed.** `safeRedact()` catches any exception and returns `[REDACTION_FAILED — message withheld from model]`. There is no path where a redaction failure results in raw text reaching a model.

**Covers:** explicit self-identification of names, Malaysian NRIC (YYMMDD-PB-###G), Singapore-style NRIC (S1234567A), Malaysian mobile and landline in several written forms, email addresses, and social handles.

Audit logs carry counts, never values — `{ ic: 1, name: 1 }`, never the identifiers themselves.

**Honest limitation:** names are matched on explicit self-identification ("my name is X", "I am X"). A bare "John Doe" with no introducing phrase is not caught. Matching capitalised words generally would destroy clinical text — "Advil", "Monday", "Fairbloom". Mitigations: the model is instructed never to echo identifiers, and guest content is hidden from staff until consent regardless.

---

## How RBAC is enforced

Three independent layers. No single layer is trusted alone.

### 1. Proxy — `src/proxy.ts`

Runs before any page code. Refreshes the session, then blocks `/staff/*` for anyone unauthenticated or holding a non-care-team role. Verified: a patient hitting `/staff/referral` is redirected to `/?denied=staff_area`.

### 2. Server components — `src/app/staff/layout.tsx`

Re-reads the caller's role and redirects independently of the proxy. `src/app/staff/leads/page.tsx` then uses that role to decide what to fetch: clinical concerns and contact details are queried only for nurse and clinician, and only where `staff_visible` is true.

### 3. Row Level Security — migrations 02, 04, 07

| Role | Sees |
|---|---|
| guest | No account, never touches the database. The server acts on their behalf via an httpOnly recovery token. |
| patient | Their own data only, everywhere. |
| staff | Acquisition only — leads, funnel, value events. No clinical content, no contact details. |
| nurse | Acquisition + clinical read + escalation response. |
| clinician | Nurse, plus authority to close a case. Enforced by a database trigger reading the acting role from `auth.jwt()`. |

Writes are server-side only. No INSERT is granted to authenticated on any table. Every message, memory item and escalation is written by the server after redaction and risk gating have run, so neither can be bypassed by talking to the API directly. `test_access_control` asserts this by attempting the insert as a real signed-in user and expecting failure.

`audit_logs` has no RLS policy and no client grant — deny by default, service role only.

Guest content is hidden from staff until consent. `lead_sessions.staff_visible` becomes true only when a `patient_session` with `consent_given` exists, or when the person explicitly sent an escalation. Asking for a human is itself consent to be read by one.

---

## Codebase map

```text
src/lib/
  redaction.ts       PHI redaction. The only gate to any model.
  risk.ts            Deterministic keyword floor, four emergency scripts, scope routing.
  nightingale-ai.ts  Two model calls: risk classifier, then conversation.
  llm.ts             Provider-agnostic client. Timeouts, one retry, null on failure.
  memory.ts          Living Memory extraction and mutation detection.
  knowledge.ts       Curated grounding corpus. Citations resolve to real spans.
  value-events.ts    Articulation card + the honest live statistic.
  channel-rules.ts   Rule resolver. Zero channel-specific logic.
  social.ts          Instagram webhook parsing + HMAC signature verification.
  guest.ts           Guest session resolution, rate limiting.
  retention.ts       14-day policy. Single source of truth.

src/app/
  hello/             Open door — ad clicks, website widget, review links.
  start/[token]/     Landing. Sets the cookie, seeds the channel opening.
  chat/              The messenger. actions.ts is the single write path.
  continue/          Signup, three consents, provenance-preserving migration.
  staff/             Care team console: leads, referral, social simulator.
  api/webhooks/      Instagram comment webhook.

supabase/migrations/ 01–15, run in order.
tests/               Eight named tests plus shared helpers.
```

---

## Failure modes

| Failure | Behaviour |
|---|---|
| LLM times out or errors | `callLlm()` returns null after a hard timeout. The conversation degrades honestly — "I am having trouble reaching my language service just now, so I would rather not guess" — rather than improvising clinical-sounding text. One retry on 429 and 5xx only; a 400 fails identically twice. |
| Risk classifier is slow | 6-second timeout, shorter than the reply timeout. If it misses the window the deterministic keyword floor decides alone. An emergency is never delayed by a slow classifier. |
| Model returns bad JSON | `parseJsonResponse()` returns null and the caller treats it as "no opinion". For risk that means the keyword verdict stands. |
| Redaction throws | `safeRedact()` returns a withheld marker. No path exists where a redaction failure results in raw text reaching a model. |
| Auth is down | `/staff/*` fails closed — no session means redirect to login. Guests are unaffected: their identity is a cookie plus a database lookup with no auth dependency, so someone mid-crisis can still reach a nurse. |
| Triage summariser fails during escalation | The escalation is still created, with a placeholder bullet directing the clinician to read the conversation. Telling a frightened person "try again later" after they asked for a human is the wrong failure. |
| Memory extraction fails | Caught and swallowed. The profile degrades, the conversation does not. A missing fact is safer than a wrong one in a record a clinician will read. |
| Model invents a citation id | Dropped. Only ids the model was actually given can resolve, so a hallucinated citation is never stored. |
| Webhook signature fails | 403, not 400 — an unsigned request is forged, not malformed, and Meta should not retry it. |
| Duplicate escalation | Refused. A second press returns the existing case rather than opening a second one. |

---

## Known gaps

> Named rather than hidden.

- The earned email is not built. The conversion flow and the transactional-versus-marketing consent split it depends on both exist, and `email_sends` is in the schema with a `consent_reference` column. The send itself was cut: there is no mail transport in this build, and a fake send would be worse than an honest gap.
- The Instagram DM is prepared, not sent. Signature verification, payload parsing, identity level, deduplication and reply construction are real. Sending requires the `instagram_manage_messages` permission and Meta App Review against a live Business account. `/staff/social` states exactly where the boundary is.
- The knowledge corpus was not clinician-reviewed. Entries are restricted to durable public-health statements with named sources rather than precise figures that shift year to year. A real deployment replaces `src/lib/knowledge.ts` with reviewed content; nothing else changes.
- PWA manifest without icons. Present and valid; icons omitted rather than shipping broken references.
- Encryption at rest is Supabase's default, not column-level. Sensitive guest content is protected by access control rather than by a separate encryption key.
- Conflict flagging on contradictions — the `conflict_flag` column exists and is always false. Listed as a bonus in the brief; not implemented.

---

## Synthetic data only

No real patient data appears in this repository, the database, or the demo. All accounts, conversations and clinical content were fabricated for this build.