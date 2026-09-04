-- ============================================================================
-- 18_reachability.sql
--
-- Scenario 1: Farah messages at 22:10 about a lump, the risk gate escalates,
-- the UI promises 12-18 hours, she closes the tab. The on-call GP replies at
-- 03:40 and there is no way to tell her.
--
-- THE ASSUMPTION THIS REJECTS
--
-- The brief asks "what should you ask for before the patient leaves without
-- breaking the guest boundary", which presumes reaching her requires contact
-- details: an email, a phone number, a WhatsApp thread.
--
-- A Web Push subscription is not contact details. It is an opaque endpoint
-- issued by her browser vendor. It carries no name, no email, no number, and
-- nothing that identifies her to us or to anyone who reads this table. We can
-- wake her lock screen at 03:40 without ever learning who she is.
--
-- That is a better answer than the one the question implies, and it needs no
-- SMS gateway, no mail transport and no Meta App Review.
--
-- WHAT TONIGHT TAUGHT US, APPLIED
--
-- Migration 17 existed because four foreign keys into messages(id) had no
-- ON DELETE rule, so the purge aborted and deleted nothing for anybody. Every
-- foreign key below states its ON DELETE explicitly, and the two tables that
-- hold guest-linked data are added to the purge in the same migration that
-- creates them rather than in a later one nobody writes.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. PUSH SUBSCRIPTIONS
--
-- One row per browser, not per person: the same woman on her phone and her
-- laptop is two rows, and a reply should reach both.
--
-- lead_session_id and patient_id are both nullable but at least one must be
-- set. A guest subscribes before she has an account; at conversion the row is
-- RELINKED by setting patient_id, exactly as messages are relinked rather than
-- copied, so the subscription she granted as a stranger keeps working and
-- keeps its origin.
-- ---------------------------------------------------------------------------

create table if not exists push_subscriptions (
  id                uuid primary key default gen_random_uuid(),
  clinic_id         uuid not null references clinics(id)       on delete cascade,
  lead_session_id   uuid          references lead_sessions(id) on delete cascade,
  patient_id        uuid          references app_users(id)     on delete cascade,

  -- Issued by the browser's push service. Unique because re-subscribing on
  -- the same browser returns the same endpoint, and we must update rather
  -- than accumulate duplicates that each fire a separate notification.
  endpoint          text not null unique,
  p256dh            text not null,
  auth_key          text not null,

  created_at        timestamptz not null default now(),
  last_notified_at  timestamptz,

  -- A browser that has revoked permission returns 404/410 forever. Recording
  -- it stops us retrying and lets the queue show honestly that this patient
  -- is no longer reachable, instead of silently failing.
  revoked_at        timestamptz,
  failure_count     int not null default 0,

  constraint push_subscriptions_owner
    check (lead_session_id is not null or patient_id is not null)
);

create index if not exists push_subscriptions_lead_idx
  on push_subscriptions (lead_session_id) where revoked_at is null;
create index if not exists push_subscriptions_patient_idx
  on push_subscriptions (patient_id) where revoked_at is null;


-- ---------------------------------------------------------------------------
-- 2. DEVICE HANDOFF CODES
--
-- Scenario 3: Mei Ling starts at work and returns at home on another device.
-- /start/{recovery_token} already restores a session on any device — the
-- plumbing exists. What was missing is any way for her to get that URL onto
-- the second device, because the address bar moved on and nothing ever showed
-- it to her again.
--
-- The naive fix is a "copy link" button. That is wrong: recovery_token is
-- long-lived and reusable, so anyone who sees it over her shoulder or in her
-- clipboard history becomes her. Scenario 1 asks precisely this — "how does
-- the re-entry link authenticate her without letting anyone else access".
--
-- So the handoff secret is separate from the durable one: single use, ten
-- minutes, and it issues a fresh cookie on the second device rather than
-- exposing the recovery token itself.
--
-- Stored as a SHA-256 hex digest, never in the clear. Computed in Node, so
-- this needs no pgcrypto.
--
-- Code space: 8 characters of Crockford base32 (no I, L, O or U, which are
-- the characters people mistype), shown as XXXX-XXXX. That is 32^8, about
-- 1.1e12 combinations, against a ten-minute window. A six-digit code would
-- have been a million, which is guessable at scale, and the second device
-- has no context to scope the lookup by.
-- ---------------------------------------------------------------------------

create table if not exists handoff_codes (
  id               uuid primary key default gen_random_uuid(),
  clinic_id        uuid not null references clinics(id)       on delete cascade,
  lead_session_id  uuid not null references lead_sessions(id) on delete cascade,

  code_hash        text not null,
  expires_at       timestamptz not null,
  used_at          timestamptz,

  -- Cheap brute-force ceiling on top of the key space.
  attempts         int not null default 0,
  created_at       timestamptz not null default now()
);

create index if not exists handoff_codes_lookup_idx
  on handoff_codes (code_hash) where used_at is null;


-- ---------------------------------------------------------------------------
-- 3. CLINICIAN RESPONSES
--
-- escalations already had a clinician_response text column, which allows one
-- reply and no conversation. A real handoff is a thread: the nurse asks
-- something, the patient answers, the nurse follows up.
--
-- responder_name and responder_role are SNAPSHOTS, not joins. The same
-- reasoning as triggering_message_text in migration 17: the patient is
-- entitled to know who replied to her, and that must survive the responder
-- leaving the clinic and their app_users row changing or going away.
-- ---------------------------------------------------------------------------

create table if not exists clinician_responses (
  id             uuid primary key default gen_random_uuid(),
  clinic_id      uuid not null references clinics(id)     on delete cascade,
  escalation_id  uuid not null references escalations(id) on delete cascade,

  responder_id   uuid references app_users(id) on delete set null,
  responder_name text not null,
  responder_role text not null,

  body           text not null,
  created_at     timestamptz not null default now(),

  -- Delivery is not the same as being read, and the queue should not claim
  -- the patient has seen something merely because a push was accepted.
  delivered_at   timestamptz,
  read_at        timestamptz
);

create index if not exists clinician_responses_escalation_idx
  on clinician_responses (escalation_id, created_at);


-- ---------------------------------------------------------------------------
-- 4. THE 12-18 HOUR PROMISE, AS A TIMESTAMP
--
-- It was a hardcoded string in the confirmation UI. Nothing recorded when the
-- promise was made, nothing measured whether it was met, and no queue could
-- sort by who had been waiting longest.
--
-- response_due_at is the outer bound, so a breach is a fact rather than an
-- impression. acknowledged_at separates "a nurse has seen this" from "a nurse
-- has answered", which are different things to the person waiting.
-- ---------------------------------------------------------------------------

alter table escalations
  add column if not exists response_due_at   timestamptz;
alter table escalations
  add column if not exists acknowledged_at   timestamptz;
alter table escalations
  add column if not exists first_response_at timestamptz;

-- Existing rows: reconstruct the promise they were shown at the time.
update escalations
   set response_due_at = created_at + interval '18 hours'
 where response_due_at is null;

alter table escalations
  alter column response_due_at set default (now() + interval '18 hours');

comment on column escalations.response_due_at is
  'Outer bound of the 12-18 hour promise shown to the patient. Set when the '
  'escalation is created so a missed promise is measurable, not rhetorical.';


-- ---------------------------------------------------------------------------
-- 5. ACCESS CONTROL
--
-- push_subscriptions and handoff_codes are server-only. RLS is enabled with
-- NO policy for authenticated, which denies every row: these hold reachability
-- secrets, and no browser session has any reason to read them. service_role
-- bypasses RLS by design and is the only thing that touches them.
--
-- This is a deliberate deny-by-absence rather than an oversight, which is why
-- it is written down here.
-- ---------------------------------------------------------------------------

alter table push_subscriptions enable row level security;
alter table handoff_codes      enable row level security;
alter table clinician_responses enable row level security;

drop policy if exists clinician_responses_read      on clinician_responses;
drop policy if exists clinician_responses_write     on clinician_responses;

-- The care team sees replies in their own clinic. The patient sees replies on
-- her own escalation, and nothing else.
create policy clinician_responses_read on clinician_responses
  for select to authenticated
  using (
    (is_clinical() and clinic_id = my_clinic_id())
    or exists (
      select 1
        from escalations e
        join patient_sessions ps on ps.id = e.patient_session_id
       where e.id = clinician_responses.escalation_id
         and ps.patient_id = auth.uid()
    )
  );

-- Only clinical roles write clinical replies. Staff can see the warm-lead
-- view but must not answer a clinical question under a nurse's name.
create policy clinician_responses_write on clinician_responses
  for insert to authenticated
  with check (is_clinical() and clinic_id = my_clinic_id());


-- ---------------------------------------------------------------------------
-- 6. RETENTION
--
-- The lesson from migration 17 applied at the point of creation instead of
-- after the fact. lead_sessions rows are never DELETED by the purge, only
-- suppressed, so ON DELETE CASCADE above will not fire for them. These two
-- tables must be purged explicitly or a guest's reachability outlives the
-- conversation it belonged to.
--
-- A subscription is kept when patient_id is set: she converted, the clinical
-- relationship is real, and it is no longer guest data.
-- ---------------------------------------------------------------------------

drop function if exists purge_expired_guest_data();

create function purge_expired_guest_data()
returns table (
  sessions_purged      int,
  messages_deleted     int,
  facts_deleted        int,
  provenance_orphaned  int,
  escalations_scrubbed int,
  contacts_revoked     int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sessions int := 0;
  v_messages int := 0;
  v_facts    int := 0;
  v_orphaned int := 0;
  v_scrubbed int := 0;
  v_contacts int := 0;
  v_tmp      int := 0;
begin
  create temporary table _expired on commit drop as
    select id from lead_sessions
    where destroy_after < now()
      and lifecycle_status <> 'converted';

  update escalations
     set source_purged_at = now()
   where source_purged_at is null
     and triggering_message_id in (
       select id from messages
       where lead_session_id in (select id from _expired)
         and patient_session_id is null
     );

  update memory_items
     set provenance_purged_at = now()
   where provenance_purged_at is null
     and provenance_pointer in (
       select id from messages
       where lead_session_id in (select id from _expired)
         and patient_session_id is null
     );
  get diagnostics v_orphaned = row_count;

  delete from messages
   where lead_session_id in (select id from _expired)
     and patient_session_id is null;
  get diagnostics v_messages = row_count;

  delete from memory_items
   where lead_session_id in (select id from _expired)
     and patient_session_id is null;
  get diagnostics v_facts = row_count;

  -- Reachability dies with the conversation, unless she converted.
  delete from push_subscriptions
   where lead_session_id in (select id from _expired)
     and patient_id is null;
  get diagnostics v_contacts = row_count;

  delete from handoff_codes
   where lead_session_id in (select id from _expired);
  get diagnostics v_tmp = row_count;
  v_contacts := v_contacts + v_tmp;

  update lead_sessions
     set referral_topic    = null,
         social_handle     = null,
         volunteered_email = null,
         page_context      = null,
         top_concern       = null,
         recovery_token    = null,
         lifecycle_status  = 'suppressed'
   where id in (select id from _expired);
  get diagnostics v_sessions = row_count;

  update escalations
     set triggering_message_text = null,
         triage_summary          = null,
         profile_snapshot        = null,
         provenance_points       = null,
         clinician_response      = null,
         status                  = 'closed'
   where clinical_retain_until < now()
     and triggering_message_text is not null;
  get diagnostics v_scrubbed = row_count;

  drop table if exists _expired;

  return query
    select v_sessions, v_messages, v_facts, v_orphaned, v_scrubbed, v_contacts;
end;
$$;

comment on function purge_expired_guest_data() is
  'Nightly guest retention. Returns counts of what was actually destroyed. '
  'Every table holding guest-linked data must be listed here explicitly: '
  'lead_sessions rows are suppressed rather than deleted, so ON DELETE '
  'CASCADE does not fire for them.';