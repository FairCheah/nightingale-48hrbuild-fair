-- ============================================================================
-- 22_case_closure.sql
--
-- enforce_clinician_close (migration 04) refuses to let a nurse set an
-- escalation to 'closed'. That trigger has never fired, because nothing in
-- the application could ever set that status — there was no Close button.
--
-- The same shape as escalations.patient_session_id in migration 19: a rule
-- correctly written in the database, guarding a door the app never walks
-- through. This gives it a door.
--
-- It also carries the internal handover note. Rather than a separate notes
-- page, the note belongs to the case being closed: "seen in clinic 8 Sep,
-- scan booked 15 Sep" is only meaningful attached to the concern it answers.
-- ============================================================================

alter table escalations
  add column if not exists closed_at      timestamptz;
alter table escalations
  add column if not exists closed_by      uuid references app_users(id) on delete set null;
alter table escalations
  add column if not exists closure_reason text;
alter table escalations
  add column if not exists closure_note   text;

-- Snapshot, for the same reason as clinician_responses.responder_name: the
-- handover record must still say who closed the case after they leave.
alter table escalations
  add column if not exists closed_by_name text;

alter table escalations
  drop constraint if exists escalations_closure_reason_check;
alter table escalations
  add constraint escalations_closure_reason_check
  check (closure_reason is null or closure_reason in (
    'seen_in_clinic',
    'advised_no_visit_needed',
    'referred_elsewhere',
    'no_response_from_patient',
    'duplicate'
  ));

comment on column escalations.closure_note is
  'Internal handover note, staff-facing only, never shown to the patient. '
  'Attached to the case rather than a separate notes page so it stays with '
  'the concern it answers.';

comment on column escalations.closure_reason is
  'Why the case ended. no_response_from_patient is deliberately a distinct '
  'outcome from advised_no_visit_needed: one is care delivered, the other is '
  'a person the clinic could not reach, and collapsing them would hide the '
  'reachability problem this build exists to fix.';

-- Closure content is clinical record, so it lives on the same clock as the
-- rest of the escalation snapshot and is scrubbed by the same branch of
-- purge_expired_guest_data().

create or replace function purge_expired_guest_data()
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
         closure_note            = null,
         status                  = 'closed'
   where clinical_retain_until < now()
     and triggering_message_text is not null;
  get diagnostics v_scrubbed = row_count;

  drop table if exists _expired;

  return query
    select v_sessions, v_messages, v_facts, v_orphaned, v_scrubbed, v_contacts;
end;
$$;