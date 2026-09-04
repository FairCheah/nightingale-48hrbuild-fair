-- ============================================================================
-- 17_retention_integrity.sql
--
-- WHY THIS EXISTS
--
-- Round one claimed a working 14-day guest purge. It did not work. Three
-- tables hold foreign keys into messages(id) with no ON DELETE rule, so
-- Postgres defaults them to NO ACTION. purge_expired_guest_data() deletes
-- from messages first, hits the constraint, and the exception aborts the
-- whole function -- rolling back every other session in the same run.
--
-- The most ordinary session breaks it: one guest message plus one extracted
-- fact. memory_items.provenance_pointer is written on nearly every turn, so
-- in practice the purge deleted nothing, ever, for anybody.
--
-- It also reported success while doing so. get diagnostics read the row_count
-- of the final UPDATE, which is not the count of anything destroyed.
--
-- Second defect: the "expired" CTE gated message deletion on a session having
-- at least one of five PII columns populated. An instagram_ad_click or
-- google_ad_click arrival populates none of them, so those sessions were
-- marked suppressed, had their tokens cleared and their facts deleted, while
-- their actual message content stayed in the table indefinitely.
--
-- RETENTION POSITION (decided, not inherited)
--
-- Guest conversation content dies at 14 days. An escalation is different in
-- kind: at the moment a guest presses "send to clinic" the clinic accepts a
-- duty of care, and the record of what it was told is a clinical record, not
-- marketing exhaust. It is retained on its own stated clock
-- (clinical_retain_until), which is separate from and longer than the guest
-- window, and it is retained as a self-contained snapshot rather than as a
-- pointer into data we are about to destroy.
--
-- The snapshot is already PHI-redacted -- triggering_message_text is written
-- from the redacted text in escalate.ts, not the raw message.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. The three dangling foreign keys.
--
-- SET NULL, not CASCADE. Cascade would silently delete a clinical escalation
-- because a guest message expired, which is the opposite of the intent. The
-- pointer goes null and the snapshot survives.
-- ---------------------------------------------------------------------------

alter table escalations
  drop constraint if exists escalations_triggering_message_id_fkey;
alter table escalations
  add constraint escalations_triggering_message_id_fkey
  foreign key (triggering_message_id) references messages(id) on delete set null;

alter table memory_items
  drop constraint if exists memory_items_provenance_pointer_fkey;
alter table memory_items
  add constraint memory_items_provenance_pointer_fkey
  foreign key (provenance_pointer) references messages(id) on delete set null;

-- value_events is PHI-free funnel metadata and is deliberately RETAINED past
-- the guest window for abandonment analytics, as the brief permits. Only its
-- pointer into the destroyed message goes null.
alter table value_events
  drop constraint if exists value_events_message_id_fkey;
alter table value_events
  add constraint value_events_message_id_fkey
  foreign key (message_id) references messages(id) on delete set null;


-- ---------------------------------------------------------------------------
-- 2. Honest provenance after the source is gone.
--
-- Scenario 21: a fact whose source message no longer exists must say so,
-- rather than rendering a citation that resolves to nothing. A null pointer
-- with no explanation is indistinguishable from a fact that never had one.
-- ---------------------------------------------------------------------------

alter table escalations
  add column if not exists source_purged_at timestamptz;

alter table escalations
  add column if not exists clinical_retain_until timestamptz
  not null default (now() + interval '7 years');

alter table memory_items
  add column if not exists provenance_purged_at timestamptz;

comment on column escalations.clinical_retain_until is
  'Clinical-record retention, separate from the 14-day guest window. Set at '
  'creation. Purged content nulls out after this date, the row survives as a '
  'PHI-free audit stub.';

comment on column memory_items.provenance_purged_at is
  'Set when the source message was destroyed by retention. The UI must show '
  '"source expired" rather than a dead citation.';


-- ---------------------------------------------------------------------------
-- 3. The purge, rewritten.
--
-- One definition of expired, applied to every table. Order matters: stamp the
-- rows that point at messages BEFORE deleting the messages, or the stamp is
-- lost.
-- ---------------------------------------------------------------------------

-- Return type widens from 2 columns to 5, so the old signature must go first.
-- CREATE OR REPLACE cannot change a function's return type.
drop function if exists purge_expired_guest_data();

create function purge_expired_guest_data()
returns table (
  sessions_purged   int,
  messages_deleted  int,
  facts_deleted     int,
  provenance_orphaned int,
  escalations_scrubbed int
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
begin
  -- ONE definition, materialised once, used by every statement below.
  create temporary table _expired on commit drop as
    select id from lead_sessions
    where destroy_after < now()
      and lifecycle_status <> 'converted';

  -- Record the break in the provenance chain before it happens.
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

  -- Guest conversation content. No PII-column filter: an ad-click arrival
  -- populates none of those columns and still typed her history into the box.
  delete from messages
   where lead_session_id in (select id from _expired)
     and patient_session_id is null;
  get diagnostics v_messages = row_count;

  delete from memory_items
   where lead_session_id in (select id from _expired)
     and patient_session_id is null;
  get diagnostics v_facts = row_count;

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

  -- Clinical records past their own, longer clock: strip content, keep a
  -- PHI-free stub so the audit trail does not lie about having had a case.
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

  return query select v_sessions, v_messages, v_facts, v_orphaned, v_scrubbed;
end;
$$;

comment on function purge_expired_guest_data() is
  'Nightly guest retention. Returns counts of what was actually destroyed, '
  'not the row_count of the last statement that happened to run.';