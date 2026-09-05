-- ============================================================================
-- 25_clinical_reply_grants.sql
--
-- "permission denied for table clinician_responses" is a GRANT error, not an
-- RLS one — an RLS failure reads "new row violates row-level security policy".
--
-- Migration 09 set DEFAULT PRIVILEGES so future tables are granted to
-- service_role automatically. It set nothing equivalent for authenticated, by
-- design: migration 08 grants SELECT broadly and lets RLS filter, and grants
-- write on exactly two tables. So every table created since inherited writes
-- for service_role and nothing for authenticated.
--
-- The effect: clinician_responses_write, written in migration 18, has never
-- been reachable. A nurse pressing Send got a permission error before RLS was
-- ever consulted. The policy was correct and unreachable — the same shape as
-- enforce_clinician_close guarding a door with no handle, and as
-- escalations_read's patient branch that could not match.
--
-- Grants are deliberately narrow. SELECT and INSERT only: a clinical reply is
-- part of the record and must not be editable or deletable from a browser
-- session. Corrections are a new reply, which is also how a patient reads it.
-- ============================================================================

grant select, insert on clinician_responses to authenticated;

-- Read-only. The queue needs these to render; nothing in a browser writes them.
grant select on push_subscriptions to authenticated;
grant select on handoff_codes      to authenticated;

comment on table clinician_responses is
  'Clinical replies. SELECT and INSERT for authenticated, filtered by '
  'clinician_responses_read and clinician_responses_write. No UPDATE or '
  'DELETE: a correction is a new reply, not an edit.';