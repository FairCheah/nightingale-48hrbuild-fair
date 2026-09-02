-- ============================================================
-- FAIRBLOOM — RLS POLICIES v2 (RBAC enforcement)
-- Model:
--   * ALL writes go through the server (service role) so that
--     PHI redaction + risk gating can never be bypassed.
--   * Authenticated reads are constrained by RLS.
--   * Guests never touch the DB directly.
-- ============================================================

-- ------------------------------------------------------------
-- HELPERS (security definer, locked to authenticated only)
-- ------------------------------------------------------------
create or replace function is_care_team()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce(
    (select role in ('staff','nurse','clinician')
     from app_users where id = auth.uid()),
    false
  );
$$;

create or replace function my_clinic_id()
returns uuid
language sql stable security definer
set search_path = public
as $$
  select clinic_id from app_users where id = auth.uid();
$$;

revoke execute on function is_care_team() from public, anon;
revoke execute on function my_clinic_id() from public, anon;
grant  execute on function is_care_team() to authenticated;
grant  execute on function my_clinic_id() to authenticated;

-- ------------------------------------------------------------
-- CLINICS
-- ------------------------------------------------------------
create policy clinics_read on clinics
  for select to authenticated
  using (true);

-- ------------------------------------------------------------
-- APP_USERS: self, or care team within the same clinic
-- ------------------------------------------------------------
create policy app_users_read on app_users
  for select to authenticated
  using (
    id = auth.uid()
    or (is_care_team() and clinic_id = my_clinic_id())
  );

create policy app_users_self_update on app_users
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- ------------------------------------------------------------
-- CHANNEL_RULES: care team reads the declarative config
-- ------------------------------------------------------------
create policy channel_rules_read on channel_rules
  for select to authenticated
  using (is_care_team());

-- ------------------------------------------------------------
-- LEAD_SESSIONS: care team, same clinic, and guest-sensitive
-- content stays hidden until consent exists.
-- ------------------------------------------------------------
create policy lead_sessions_read on lead_sessions
  for select to authenticated
  using (
    is_care_team()
    and clinic_id = my_clinic_id()
    and (
      has_sensitive_data = false
      or exists (
        select 1 from patient_sessions ps
        where ps.lead_session_id = lead_sessions.id
          and ps.consent_given = true
      )
    )
  );

-- ------------------------------------------------------------
-- PATIENT_SESSIONS: own, or care team (same clinic + consented)
-- ------------------------------------------------------------
create policy patient_sessions_read on patient_sessions
  for select to authenticated
  using (
    patient_id = auth.uid()
    or (is_care_team()
        and clinic_id = my_clinic_id()
        and consent_given = true)
  );

-- ------------------------------------------------------------
-- MESSAGES: read only via a session you own (or consented care team)
-- test_access_control: Patient A cannot read Patient B.
-- NOTE: no INSERT policy — writes are server-side only, so risk
-- gating and redaction cannot be bypassed from the client.
-- ------------------------------------------------------------
create policy messages_read on messages
  for select to authenticated
  using (
    exists (
      select 1 from patient_sessions ps
      where ps.id = messages.patient_session_id
        and (
          ps.patient_id = auth.uid()
          or (is_care_team()
              and ps.clinic_id = my_clinic_id()
              and ps.consent_given = true)
        )
    )
  );

-- ------------------------------------------------------------
-- CITATIONS: visible iff the parent message is visible
-- ------------------------------------------------------------
create policy citations_read on citations
  for select to authenticated
  using (
    exists (
      select 1 from messages m
      join patient_sessions ps on ps.id = m.patient_session_id
      where m.id = citations.message_id
        and (
          ps.patient_id = auth.uid()
          or (is_care_team()
              and ps.clinic_id = my_clinic_id()
              and ps.consent_given = true)
        )
    )
  );

-- ------------------------------------------------------------
-- MEMORY_ITEMS: the Living Profile (read-only from client)
-- ------------------------------------------------------------
create policy memory_items_read on memory_items
  for select to authenticated
  using (
    exists (
      select 1 from patient_sessions ps
      where ps.id = memory_items.patient_session_id
        and (
          ps.patient_id = auth.uid()
          or (is_care_team()
              and ps.clinic_id = my_clinic_id()
              and ps.consent_given = true)
        )
    )
  );

-- ------------------------------------------------------------
-- VALUE_EVENTS: care team analytics, own clinic
-- ------------------------------------------------------------
create policy value_events_read on value_events
  for select to authenticated
  using (is_care_team() and clinic_id = my_clinic_id());

-- ------------------------------------------------------------
-- ESCALATIONS: care team triage queue (own clinic), or a patient
-- viewing only their own escalation.
-- test_access_control: patient cannot fetch the triage queue.
-- ------------------------------------------------------------
create policy escalations_read on escalations
  for select to authenticated
  using (
    (is_care_team() and clinic_id = my_clinic_id())
    or exists (
      select 1 from patient_sessions ps
      where ps.id = escalations.patient_session_id
        and ps.patient_id = auth.uid()
    )
  );

create policy escalations_care_team_update on escalations
  for update to authenticated
  using (is_care_team() and clinic_id = my_clinic_id())
  with check (is_care_team() and clinic_id = my_clinic_id());

-- ------------------------------------------------------------
-- EMAIL_SENDS: care team only (consent auditing)
-- ------------------------------------------------------------
create policy email_sends_read on email_sends
  for select to authenticated
  using (is_care_team());

-- ------------------------------------------------------------
-- EVENTS: funnel analytics, care team, own clinic
-- ------------------------------------------------------------
create policy events_read on events
  for select to authenticated
  using (is_care_team() and clinic_id = my_clinic_id());

-- ------------------------------------------------------------
-- AUDIT_LOGS: intentionally NO policy => deny-by-default.
-- Server/service-role only. Nothing readable from any client.
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- Belt-and-braces: the anonymous role gets nothing anywhere.
-- ------------------------------------------------------------
revoke all on all tables in schema public from anon;