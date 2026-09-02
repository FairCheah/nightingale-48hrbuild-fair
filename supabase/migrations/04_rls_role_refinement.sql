-- ============================================================
-- FAIRBLOOM — RLS ROLE REFINEMENT v5
--   patient   -> only their own data, everywhere
--   staff     -> acquisition only (leads, funnel, value events)
--   nurse     -> acquisition + clinical read + escalation response
--   clinician -> nurse + authority to close a case
-- ============================================================

create or replace function is_clinical()
returns boolean language sql stable security definer
set search_path = public as $$
  select coalesce((select role in ('nurse','clinician')
                   from app_users where id = auth.uid()), false);
$$;

create or replace function is_clinician()
returns boolean language sql stable security definer
set search_path = public as $$
  select coalesce((select role = 'clinician'
                   from app_users where id = auth.uid()), false);
$$;

create or replace function is_staff_or_above()
returns boolean language sql stable security definer
set search_path = public as $$
  select coalesce((select role in ('staff','nurse','clinician')
                   from app_users where id = auth.uid()), false);
$$;

revoke execute on function is_clinical()       from public, anon;
revoke execute on function is_clinician()      from public, anon;
revoke execute on function is_staff_or_above() from public, anon;
grant  execute on function is_clinical()       to authenticated, service_role;
grant  execute on function is_clinician()      to authenticated, service_role;
grant  execute on function is_staff_or_above() to authenticated, service_role;
grant  execute on function my_clinic_id()      to authenticated, service_role;

-- Drop old policies (safe to re-run)
drop policy if exists app_users_read                on app_users;
drop policy if exists channel_rules_read            on channel_rules;
drop policy if exists lead_sessions_read            on lead_sessions;
drop policy if exists patient_sessions_read         on patient_sessions;
drop policy if exists messages_read                 on messages;
drop policy if exists citations_read                on citations;
drop policy if exists memory_items_read             on memory_items;
drop policy if exists value_events_read             on value_events;
drop policy if exists escalations_read              on escalations;
drop policy if exists escalations_care_team_update  on escalations;
drop policy if exists escalations_clinical_respond  on escalations;
drop policy if exists email_sends_read              on email_sends;
drop policy if exists events_read                   on events;

-- APP_USERS: self always; contact PII is clinical, not staff-wide
create policy app_users_read on app_users
  for select to authenticated
  using (id = auth.uid() or (is_clinical() and clinic_id = my_clinic_id()));

-- CHANNEL_RULES: operational config — all care team
create policy channel_rules_read on channel_rules
  for select to authenticated
  using (is_staff_or_above());

-- LEAD_SESSIONS: acquisition data; sensitive guest content hidden till consent
create policy lead_sessions_read on lead_sessions
  for select to authenticated
  using (
    is_staff_or_above()
    and clinic_id = my_clinic_id()
    and (
      has_sensitive_data = false
      or exists (select 1 from patient_sessions ps
                 where ps.lead_session_id = lead_sessions.id
                   and ps.consent_given = true)
    )
  );

-- PATIENT_SESSIONS: staff see that a session exists (warm-lead view)
create policy patient_sessions_read on patient_sessions
  for select to authenticated
  using (
    patient_id = auth.uid()
    or (is_staff_or_above() and clinic_id = my_clinic_id() and consent_given = true)
  );

-- MESSAGES: clinical. Patient's own, or nurse/clinician.
-- No INSERT policy: writes are server-side only, so PHI redaction
-- and risk gating can never be bypassed from a client.
create policy messages_read on messages
  for select to authenticated
  using (
    exists (select 1 from patient_sessions ps
            where ps.id = messages.patient_session_id
              and (ps.patient_id = auth.uid()
                   or (is_clinical() and ps.clinic_id = my_clinic_id()
                       and ps.consent_given = true)))
  );

create policy citations_read on citations
  for select to authenticated
  using (
    exists (select 1 from messages m
            join patient_sessions ps on ps.id = m.patient_session_id
            where m.id = citations.message_id
              and (ps.patient_id = auth.uid()
                   or (is_clinical() and ps.clinic_id = my_clinic_id()
                       and ps.consent_given = true)))
  );

create policy memory_items_read on memory_items
  for select to authenticated
  using (
    exists (select 1 from patient_sessions ps
            where ps.id = memory_items.patient_session_id
              and (ps.patient_id = auth.uid()
                   or (is_clinical() and ps.clinic_id = my_clinic_id()
                       and ps.consent_given = true)))
  );

create policy value_events_read on value_events
  for select to authenticated
  using (is_staff_or_above() and clinic_id = my_clinic_id());

create policy events_read on events
  for select to authenticated
  using (is_staff_or_above() and clinic_id = my_clinic_id());

-- EMAIL_SENDS has no clinic_id — scope through its parent session.
create policy email_sends_read on email_sends
  for select to authenticated
  using (
    is_clinical()
    and (
      exists (select 1 from patient_sessions ps
              where ps.id = email_sends.patient_session_id
                and ps.clinic_id = my_clinic_id())
      or exists (select 1 from lead_sessions ls
                 where ls.id = email_sends.lead_session_id
                   and ls.clinic_id = my_clinic_id())
    )
  );

-- ESCALATIONS: triage queue is clinical. Patient sees only their own.
create policy escalations_read on escalations
  for select to authenticated
  using (
    (is_clinical() and clinic_id = my_clinic_id())
    or exists (select 1 from patient_sessions ps
               where ps.id = escalations.patient_session_id
                 and ps.patient_id = auth.uid())
  );

create policy escalations_clinical_respond on escalations
  for update to authenticated
  using (is_clinical() and clinic_id = my_clinic_id())
  with check (is_clinical() and clinic_id = my_clinic_id());

-- ------------------------------------------------------------
-- CLINICIAN-ONLY CLOSURE
-- Reads the acting role from the JWT itself. End-users carry
-- role='authenticated'; the server carries role='service_role'
-- and is exempt because it performs its own role check.
-- ------------------------------------------------------------
create or replace function enforce_clinician_close()
returns trigger language plpgsql security definer
set search_path = public as $$
declare
  acting_role text := coalesce(auth.jwt() ->> 'role', '');
begin
  if new.status = 'closed'
     and coalesce(old.status, '') is distinct from 'closed'
     and acting_role = 'authenticated'
     and not is_clinician() then
    raise exception 'Only a clinician may close an escalation';
  end if;
  return new;
end $$;

drop trigger if exists escalations_close_guard on escalations;
create trigger escalations_close_guard
  before update on escalations
  for each row execute function enforce_clinician_close();

drop function if exists is_care_team();