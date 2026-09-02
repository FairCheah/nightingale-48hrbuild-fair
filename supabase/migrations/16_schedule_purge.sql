-- ============================================================
-- 16. SCHEDULE THE GUEST DATA PURGE
--
-- purge_expired_guest_data() was written in migration 10 but nothing called
-- it. A retention promise that nothing enforces is worse than no promise:
-- the interface tells a guest their conversation disappears after 14 days,
-- and that has to be true.
--
-- Runs nightly at 03:00. Purge is not delete — it nulls the content columns
-- and removes messages while keeping the PHI-free skeleton (channel,
-- campaign, identity level, timestamps) so abandonment analytics survive
-- without retaining a word anyone typed.
-- ============================================================

create extension if not exists pg_cron;

select cron.schedule(
  'purge-expired-guest-data',
  '0 3 * * *',
  $$select purge_expired_guest_data()$$
);

-- Verify the job is registered.
select jobname, schedule, command from cron.job;