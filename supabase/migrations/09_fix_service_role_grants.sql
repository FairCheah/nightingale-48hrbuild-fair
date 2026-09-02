-- ============================================================
-- FIX: restore service_role write grants.
--
-- 02_rls_policies ran a blanket `revoke all on all tables ...
-- from anon`. In Supabase, anon / authenticated / service_role
-- share grant inheritance, so that revoke also stripped
-- service_role — leaving the server unable to write anything.
--
-- service_role is the server's identity. It legitimately needs
-- full DML because every guest write, every message insert,
-- every audit entry flows through the server after PHI
-- redaction and risk gating. It bypasses RLS by design and is
-- never exposed to a browser.
-- ============================================================

grant usage on schema public to service_role;

grant select, insert, update, delete
  on all tables in schema public
  to service_role;

grant usage, select on all sequences in schema public to service_role;

-- Future tables inherit the same grants.
alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;

-- Re-assert the intended posture for the other two roles,
-- now expressed precisely rather than by blanket revoke.

-- anon: no table access at all. Guests never touch the DB;
-- the server acts on their behalf.
revoke all on all tables in schema public from anon;

-- authenticated: read-only, filtered by RLS. No INSERT anywhere,
-- so redaction and risk gating cannot be bypassed from a client.
grant select on
  clinics, app_users, channel_rules, lead_sessions,
  patient_sessions, messages, citations, memory_items,
  value_events, escalations, email_sends, events
to authenticated;

grant update on escalations to authenticated;  -- clinical response
grant update on app_users   to authenticated;  -- own contact details

-- audit_logs: no grant to anon or authenticated. Server only.
revoke all on audit_logs from anon, authenticated;