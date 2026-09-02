-- ============================================================
-- FAIRBLOOM FERTILITY & WOMEN'S HEALTH — NIGHTINGALE SCHEMA v2
-- ============================================================

create extension if not exists "pgcrypto";

-- ------------------------------------------------------------
-- 1. CLINICS
-- ------------------------------------------------------------
create table clinics (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  specialty  text not null default 'Fertility & Women''s Health',
  emergency_number text not null default '999',
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 2. APP_USERS  (extends Supabase auth.users; immutable internal id)
-- ------------------------------------------------------------
create table app_users (
  id               uuid primary key references auth.users(id) on delete cascade,
  clinic_id        uuid references clinics(id),
  role             text not null default 'patient'
                    check (role in ('patient','staff','nurse','clinician')),
  email            text,
  email_verified   boolean not null default false,
  phone            text,
  instagram_handle text,
  tiktok_handle    text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 3. CHANNEL_RULES  (declarative config: channel x identity x time)
-- ------------------------------------------------------------
create table channel_rules (
  id             uuid primary key default gen_random_uuid(),
  source_channel text not null,
  identity_level text not null,
  time_of_day    text not null default 'any'
                  check (time_of_day in ('any','morning','afternoon','evening','night')),
  intent         text default 'any',
  opening_strategy   text not null,
  opening_template   text not null,
  ask_for_email      boolean not null default true,
  priority       int not null default 100,
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 4. LEAD_SESSIONS  (guest arrival + attribution + recovery + lifecycle)
-- ------------------------------------------------------------
create table lead_sessions (
  id                uuid primary key default gen_random_uuid(),
  clinic_id         uuid references clinics(id),
  source_channel    text not null,
  campaign_id       text,
  creative          text,
  identity_level    text not null default 'anonymous'
                     check (identity_level in ('anonymous','handle_only','email_known')),
  social_handle     text,
  volunteered_email text,
  referral_topic    text,
  referred_by       uuid references app_users(id),
  page_context      text,
  recovery_token    text unique default encode(gen_random_bytes(24),'hex'),
  lifecycle_status  text not null default 'active'
                     check (lifecycle_status in ('active','cooling','dormant','recalled','suppressed','converted')),
  warm_lead_score   numeric default 0,
  top_concern       text,
  has_sensitive_data boolean not null default false,
  staff_visible     boolean not null default true,
  request_count     int not null default 0,
  last_request_at   timestamptz,
  landing_timestamp timestamptz not null default now(),
  last_active_at    timestamptz not null default now(),
  destroy_after     timestamptz not null default (now() + interval '30 days'),
  created_at        timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 5. PATIENT_SESSIONS
-- ------------------------------------------------------------
create table patient_sessions (
  id                  uuid primary key default gen_random_uuid(),
  clinic_id           uuid references clinics(id),
  patient_id          uuid references app_users(id) on delete cascade,
  lead_session_id     uuid references lead_sessions(id),
  consent_given       boolean not null default false,
  consent_timestamp   timestamptz,
  consent_clinic_name text,
  marketing_consent           boolean not null default false,
  marketing_consent_timestamp timestamptz,
  created_at          timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 6. MESSAGES  (guest OR patient; risk fields; voice-ready)
-- ------------------------------------------------------------
create table messages (
  id                 uuid primary key default gen_random_uuid(),
  lead_session_id    uuid references lead_sessions(id),
  patient_session_id uuid references patient_sessions(id),
  sender             text not null check (sender in ('guest','patient','ai','clinician')),
  content            text not null,
  content_redacted   text,
  redaction_applied  boolean not null default false,
  risk_level         text check (risk_level in ('low','med','high')),
  risk_reason        text,
  confidence         text check (confidence in ('low','med','high')),
  risk_provenance    timestamptz,
  escalation_required boolean not null default false,
  audio_transcript_id text,
  audio_url           text,
  audio_duration_ms   int,
  transcript_confidence numeric,
  created_at         timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 7. CITATIONS  (grounding: citations resolve to real spans)
-- ------------------------------------------------------------
create table citations (
  id          uuid primary key default gen_random_uuid(),
  message_id  uuid references messages(id) on delete cascade,
  source_title text not null,
  source_url   text,
  source_org   text,
  quoted_span  text,
  span_start   int,
  span_end     int,
  created_at   timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 8. MEMORY_ITEMS  (Living Memory: mutable, provenance-linked)
-- ------------------------------------------------------------
create table memory_items (
  id                 uuid primary key default gen_random_uuid(),
  patient_session_id uuid references patient_sessions(id) on delete cascade,
  lead_session_id    uuid references lead_sessions(id),
  kind               text not null
                      check (kind in ('chief_complaint','symptom','medication','allergy')),
  value              text not null,
  status             text not null default 'active'
                      check (status in ('active','stopped','resolved','corrected')),
  timeline           text,
  provenance_pointer uuid references messages(id),
  supersedes         uuid references memory_items(id),
  conflict_flag      boolean not null default false,
  updated_at         timestamptz not null default now(),
  created_at         timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 9. VALUE_EVENTS  (first-class; every stat traces to a live query)
-- ------------------------------------------------------------
create table value_events (
  id                 uuid primary key default gen_random_uuid(),
  clinic_id          uuid references clinics(id),
  lead_session_id    uuid references lead_sessions(id),
  patient_session_id uuid references patient_sessions(id),
  message_id         uuid references messages(id),
  value_type         text not null,      -- service_answer, education, concern_draft,
                                          -- live_stat, question_prep, family_kit
  payload            text,               -- e.g. the 240-char shareable message
  stat_query         text,               -- the SQL//query that produced a number
  stat_value         numeric,            -- the number shown
  stat_verified_at   timestamptz,
  shared_publicly    boolean not null default false,
  created_at         timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 10. ESCALATIONS  ("Send to Clinic"; self-contained payload)
-- ------------------------------------------------------------
create table escalations (
  id                    uuid primary key default gen_random_uuid(),
  clinic_id             uuid references clinics(id),
  patient_session_id    uuid references patient_sessions(id),
  lead_session_id       uuid references lead_sessions(id),
  triggering_message_id uuid references messages(id),
  triggering_message_text text,          -- snapshot: payload stands alone
  triage_summary        text,
  profile_snapshot      jsonb,
  acquisition_context   jsonb,
  provenance_points     jsonb,
  risk_level_at_send    text,
  status                text not null default 'pending'
                         check (status in ('pending','in_review','responded','closed')),
  response_expectation  text default '12-18 hours',
  clinician_response    text,
  clinician_id          uuid references app_users(id),
  responded_at          timestamptz,
  created_at            timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 11. EMAIL_SENDS  (earned email; transactional vs marketing)
-- ------------------------------------------------------------
create table email_sends (
  id                 uuid primary key default gen_random_uuid(),
  lead_session_id    uuid references lead_sessions(id),
  patient_session_id uuid references patient_sessions(id),
  to_email           text not null,
  email_type         text not null
                      check (email_type in ('transactional_summary','marketing_recall')),
  subject            text,
  phi_redacted       boolean not null default true,
  consent_reference  timestamptz,        -- must exist for marketing_recall
  sent_at            timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 12. EVENTS  (funnel)
-- ------------------------------------------------------------
create table events (
  id                 uuid primary key default gen_random_uuid(),
  clinic_id          uuid references clinics(id),
  lead_session_id    uuid references lead_sessions(id),
  patient_session_id uuid references patient_sessions(id),
  event_type         text not null
                      check (event_type in ('visitor','conversation_started','value_event',
                        'auth_started','consented','patient_created','escalation_sent',
                        'abandoned','session_recovered')),
  event_detail       jsonb,
  created_at         timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 13. AUDIT_LOGS  (PHI-FREE: ids/hashes/metadata only)
-- ------------------------------------------------------------
create table audit_logs (
  id            uuid primary key default gen_random_uuid(),
  actor_id      uuid,
  actor_role    text,
  action        text not null,
  resource_type text,
  resource_id   uuid,
  content_hash  text,           -- hash only, never raw content
  metadata      jsonb,
  created_at    timestamptz not null default now()
);

-- ------------------------------------------------------------
-- AUTO-UPDATE updated_at (keeps provenance timestamps honest)
-- ------------------------------------------------------------
create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger memory_items_touch
  before update on memory_items
  for each row execute function touch_updated_at();

create trigger app_users_touch
  before update on app_users
  for each row execute function touch_updated_at();

-- ------------------------------------------------------------
-- INDEXES (speed for the paths we query most)
-- ------------------------------------------------------------
create index on messages (lead_session_id);
create index on messages (patient_session_id);
create index on memory_items (patient_session_id);
create index on events (clinic_id, event_type, created_at);
create index on lead_sessions (clinic_id, source_channel, created_at);
create index on escalations (clinic_id, status, created_at);
create index on lead_sessions (recovery_token);

-- ------------------------------------------------------------
-- SEED: Fairbloom clinic
-- ------------------------------------------------------------
insert into clinics (name, specialty)
values ('Fairbloom Fertility & Women''s Health', 'Fertility & Women''s Health');

-- ------------------------------------------------------------
-- ENABLE RLS on everything (RBAC foundation)
-- ------------------------------------------------------------
alter table clinics          enable row level security;
alter table app_users        enable row level security;
alter table channel_rules    enable row level security;
alter table lead_sessions    enable row level security;
alter table patient_sessions enable row level security;
alter table messages         enable row level security;
alter table citations        enable row level security;
alter table memory_items     enable row level security;
alter table value_events     enable row level security;
alter table escalations      enable row level security;
alter table email_sends      enable row level security;
alter table events           enable row level security;
alter table audit_logs       enable row level security;