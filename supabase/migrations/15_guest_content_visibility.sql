-- ============================================================
-- 15. GUEST CONTENT HIDDEN FROM STAFF UNTIL CONSENT
--
-- §2 requires that volunteered sensitive information be hidden from staff
-- until the person consents. We treat ALL guest clinical content that way,
-- not only content flagged sensitive: someone who has not consented has not
-- agreed to be read, and deciding case by case which of their words are
-- "sensitive enough" is exactly the judgment we should not be making on
-- their behalf.
--
-- Staff (reception and marketing) therefore see lead metadata and never
-- guest message content. Nurses and clinicians see clinical content once a
-- patient_session exists, or when an escalation was sent — asking for a
-- human is itself consent to be read by one.
-- ============================================================

create or replace function guest_content_visible(p_lead_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from patient_sessions ps
    where ps.lead_session_id = p_lead_session_id
      and ps.consent_given = true
  )
  or exists (
    select 1 from escalations e
    where e.lead_session_id = p_lead_session_id
  );
$$;

revoke all on function guest_content_visible(uuid) from public, anon;

-- Backfill the flag for existing sessions.
update lead_sessions ls
set staff_visible = guest_content_visible(ls.id);

select source_channel, staff_visible, top_concern is not null as has_concern
from lead_sessions
order by created_at desc
limit 8;