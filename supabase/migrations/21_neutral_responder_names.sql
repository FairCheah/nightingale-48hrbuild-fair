-- Migration 20 seeded "Sister Aminah" and "Dr Lim Wei Ling". Those names came
-- from the reviewers' example scenario, not from this clinic, and inventing
-- staff identities that read as real people is the wrong default for a
-- record a patient will see.
--
-- Role-based names instead: honest about who is answering without asserting a
-- person who does not exist. A real deployment sets these to real names.

update app_users set display_name = 'Fairbloom Nurse'
 where email = 'nurse@fairbloom.test';

update app_users set display_name = 'Fairbloom Clinician'
 where email = 'clinician@fairbloom.test';

update app_users set display_name = 'Fairbloom Team'
 where email = 'staff@fairbloom.test';