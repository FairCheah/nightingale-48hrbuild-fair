-- ============================================================
-- FAIRBLOOM — TEST USER ROLE ASSIGNMENT
--
-- Self-signup always yields 'patient' (see 05_auth_bootstrap).
-- Care-team roles are assigned deliberately here, which mirrors
-- how a real clinic provisions staff: an administrator grants
-- the role, the user never chooses it.
--
-- SYNTHETIC TEST ACCOUNTS ONLY. No real patient data.
-- ============================================================

update app_users set role = 'staff'
 where email = 'staff@fairbloom.test';

update app_users set role = 'nurse'
 where email = 'nurse@fairbloom.test';

update app_users set role = 'clinician'
 where email = 'clinician@fairbloom.test';

-- Verify: expect 4 rows, each with the right role and a clinic.
select u.email,
       u.role,
       c.name as clinic,
       u.email_verified
from app_users u
left join clinics c on c.id = u.clinic_id
order by
  case u.role
    when 'patient'   then 1
    when 'staff'     then 2
    when 'nurse'     then 3
    when 'clinician' then 4
  end;