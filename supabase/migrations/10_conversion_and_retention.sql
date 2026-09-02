-- ============================================================
-- 11. CONVERSION, SCOPE, AND RETENTION
--
-- Three fixes in one migration:
--   a) separate consent for migrating the guest conversation
--   b) messages.scope, replacing a string-matching shortcut in the UI
--   c) retention lowered from 30 to 14 days to match src/lib/retention.ts
-- ============================================================

-- ------------------------------------------------------------
-- (a) MIGRATION CONSENT
--
-- Consenting to be a patient and consenting to hand over what you said
-- anonymously are different decisions. Someone may want an account without
-- surrendering a conversation they had before they trusted us. The brief
-- says "migrate PERMITTED guest context" — this column is what makes
-- "permitted" a real choice rather than an assumption.
-- ------------------------------------------------------------
alter table patient_sessions
  add column if not exists migration_consent boolean not null default false,
  add column if not exists migration_consent_timestamp timestamptz,
  -- What actually moved, for audit: counts and ids, never content.
  add column if not exists migrated_summary jsonb;

-- ------------------------------------------------------------
-- (b) MESSAGE SCOPE
--
-- Whether Fairbloom can act on this message. Previously derived in the UI by
-- string-matching risk_reason, which was brittle. Stored properly now.
-- ------------------------------------------------------------
alter table messages
  add column if not exists scope text
    check (scope in ('in_scope', 'out_of_scope', 'unclear'));

-- ------------------------------------------------------------
-- (c) RETENTION: 30 -> 14 DAYS
--
-- Justified in the Technical Brief: this clinic covers fertility, women's
-- health and sexual health. Unconsented, stigma-carrying free text is a
-- liability, not an asset. 14 days is long enough for a genuine returning
-- visitor to recover their thread.
-- ------------------------------------------------------------
alter table lead_sessions
  alter column destroy_after set default (now() + interval '14 days');

-- Existing rows: shorten any window still running past the new policy.
update lead_sessions
set destroy_after = landing_timestamp + interval '14 days'
where destroy_after > landing_timestamp + interval '14 days';

-- ------------------------------------------------------------
-- PURGE FUNCTION
--
-- Purge is not delete. The brief asks us to destroy guest data AND to justify
-- keeping PHI-free metadata for abandonment analytics. So we null the content
-- columns and delete the messages, while keeping the skeleton row: channel,
-- campaign, identity level, timestamps, lifecycle. That answers "where do
-- Instagram leads abandon?" without retaining a word anyone typed.
--
-- Converted sessions are exempt: once someone is a patient, their record is
-- governed by clinical retention, not guest retention.
-- ------------------------------------------------------------
create or replace function purge_expired_guest_data()
returns table (sessions_purged int, messages_deleted int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sessions int := 0;
  v_messages int := 0;
begin
  with expired as (
    select id from lead_sessions
    where destroy_after < now()
      and lifecycle_status <> 'converted'
      and (referral_topic is not null
           or social_handle is not null
           or volunteered_email is not null
           or page_context is not null
           or top_concern is not null)
  ),
  deleted_messages as (
    delete from messages
    where lead_session_id in (select id from expired)
      and patient_session_id is null
    returning 1
  )
  select count(*) into v_messages from deleted_messages;

  delete from memory_items
  where lead_session_id in (
    select id from lead_sessions
    where destroy_after < now() and lifecycle_status <> 'converted'
  )
  and patient_session_id is null;

  update lead_sessions
  set referral_topic = null,
      social_handle = null,
      volunteered_email = null,
      page_context = null,
      top_concern = null,
      recovery_token = null,
      lifecycle_status = 'suppressed'
  where destroy_after < now()
    and lifecycle_status <> 'converted';

  get diagnostics v_sessions = row_count;

  return query select v_sessions, v_messages;
end;
$$;

revoke all on function purge_expired_guest_data() from public, anon, authenticated;