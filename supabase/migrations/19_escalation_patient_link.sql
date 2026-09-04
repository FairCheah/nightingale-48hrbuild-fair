-- ============================================================================
-- 19_escalation_patient_link.sql
--
-- escalations.patient_session_id was never written by escalate.ts, so it was
-- null on every row. That made half of escalations_read (migration 04) dead:
--
--   or exists (select 1 from patient_sessions ps
--              where ps.id = escalations.patient_session_id
--                and ps.patient_id = auth.uid())
--
-- A converted patient could not read her own escalation under RLS. Nothing
-- broke, because every read goes through service_role — which is exactly
-- scenario 20's complaint: a well-formed policy that cannot fire, sitting
-- there looking like enforcement.
--
-- continue/actions.ts already relinked escalations at conversion, so the
-- guest-escalates-then-converts direction was fine. The gap was the reverse:
-- a patient who converts and THEN escalates. Conversion had already run, so
-- nothing came back to fill the column in.
--
-- Fixed at the write site in escalate.ts. This backfills the rows already in
-- the table.
-- ============================================================================

update escalations e
   set patient_session_id = ps.id
  from patient_sessions ps
 where ps.lead_session_id = e.lead_session_id
   and e.patient_session_id is null;

-- A lead session has at most one patient session in this schema, but nothing
-- enforced it, and a duplicate would make the backfill above non-deterministic.
create unique index if not exists patient_sessions_one_per_lead
  on patient_sessions (lead_session_id)
  where lead_session_id is not null;

comment on column escalations.patient_session_id is
  'Set at escalation time when the session has already converted, and by '
  'continue/actions.ts when a guest converts after escalating. Load-bearing: '
  'escalations_read uses it to let a patient read her own escalation.';