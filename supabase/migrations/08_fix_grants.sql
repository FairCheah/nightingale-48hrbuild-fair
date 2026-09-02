-- ============================================================
-- FIX: restore table grants for authenticated users.
--
-- 02_rls_policies ran `revoke all on all tables ... from anon`,
-- which left the `authenticated` role without SELECT privileges.
--
-- Grants and RLS are separate gates:
--   * GRANT decides whether a role may touch the table at all.
--   * RLS decides which rows that role may see.
-- Our RLS policies were correct, but the outer gate was shut,
-- so every read returned "permission denied" before RLS ran.
--
-- We grant SELECT broadly and let RLS do the filtering — that
-- is the intended Supabase model. Writes stay server-side only:
-- no INSERT/UPDATE/DELETE is granted to authenticated, so PHI
-- redaction and risk gating cannot be bypassed from a client.
-- ============================================================

grant usage on schema public to authenticated;

grant select on
  clinics,
  app_users,
  channel_rules,
  lead_sessions,
  patient_sessions,
  messages,
  citations,
  memory_items,
  value_events,
  escalations,
  email_sends,
  events
to authenticated;

-- Escalations are the one client-writable path: nurses and
-- clinicians respond to triage. Still constrained by RLS.
grant update on escalations to authenticated;

-- Patients may update their own contact details.
grant update on app_users to authenticated;

-- audit_logs deliberately gets NO grant at all: unreachable
-- from any client, service-role only.

-- anon stays locked out entirely; guests never touch the DB.
revoke all on all tables in schema public from anon;