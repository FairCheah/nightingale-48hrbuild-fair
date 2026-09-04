-- ============================================================================
-- 20_responder_identity.sql
--
-- A patient who gets a reply at 03:40 is entitled to know who wrote it. The
-- only identity app_users carried was an email address, and
-- "nurse@fairbloom.test replied to you" is both colder and a small leak of
-- internal addressing to someone outside the clinic.
--
-- display_name is what the patient sees. It is snapshotted into
-- clinician_responses.responder_name at reply time, for the same reason
-- migration 17 snapshots triggering_message_text: the reply must still say
-- who answered after that person leaves the clinic and their row changes or
-- goes away.
-- ============================================================================

alter table app_users
  add column if not exists display_name text;

-- Seeded care team from migration 06.
update app_users set display_name = 'Sister Aminah'
 where email = 'nurse@fairbloom.test' and display_name is null;

update app_users set display_name = 'Dr Lim Wei Ling'
 where email = 'clinician@fairbloom.test' and display_name is null;

update app_users set display_name = 'Nadia'
 where email = 'staff@fairbloom.test' and display_name is null;

-- Everyone else: the local part of their address, which is a reasonable
-- placeholder and never null, so the reply always has an author.
update app_users
   set display_name = initcap(split_part(email, '@', 1))
 where display_name is null and email is not null;

comment on column app_users.display_name is
  'Shown to patients as the author of a clinical reply. Snapshotted into '
  'clinician_responses.responder_name so the attribution survives the '
  'responder leaving.';