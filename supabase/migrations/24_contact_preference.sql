-- ============================================================================
-- 24_contact_preference.sql
--
-- An escalation from an anonymous guest reached the nurse with no way to
-- answer except the conversation itself. That path is real — the reply waits
-- in her thread and she returns by link — but nothing ever told her so, and
-- nothing let her ask for something faster.
--
-- WHY THIS IS ASKED AFTER, NOT BEFORE
--
-- The obvious version puts a contact form in front of the Send button. That
-- breaks the principle the whole build rests on: a safety action never
-- requires identifying yourself first. It also breaks worst for the person
-- who needs it most — someone at 2am who will not type a phone number on a
-- shared device gets no help at all, and the person most afraid to identify
-- herself usually has the most at stake.
--
-- So the case is sent first, unconditionally, and the ask comes on the
-- confirmation: she is at her most willing right after being helped, rather
-- than being charged a toll to be helped at all. "No, I will check back here"
-- stays a real answer, which is what keeps the principle intact.
--
-- Purged with the rest of the guest session at 14 days — these columns are
-- already in the UPDATE inside purge_expired_guest_data(), except the two
-- added here, which are added to it below.
-- ============================================================================

alter table lead_sessions
  add column if not exists volunteered_phone text;

alter table lead_sessions
  add column if not exists contact_preference text
  check (contact_preference in ('email', 'whatsapp', 'in_conversation'));

alter table lead_sessions
  add column if not exists contact_preference_at timestamptz;

comment on column lead_sessions.contact_preference is
  'How she asked to be reached, stated by her rather than inferred from what '
  'we happen to hold. in_conversation is a real choice, not an absence: it '
  'means she will come back to the thread, and the nurse should not chase.';

-- Retention: these are guest contact details and die with the session.
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
     set referral_topic     = null,
         social_handle      = null,
         volunteered_email  = null,
         volunteered_phone  = null,
         contact_preference = null,
         page_context       = null,
         top_concern        = null,
         recovery_token     = null,
         lifecycle_status   = 'suppressed'
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