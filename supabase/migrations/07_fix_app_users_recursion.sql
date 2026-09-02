-- ============================================================
-- FIX: RLS recursion on app_users
--
-- The combined policy called is_clinical()/my_clinic_id(),
-- which themselves SELECT from app_users. A policy on a table
-- that invokes a function reading that same table recurses,
-- and the whole predicate fails — so even a user reading their
-- OWN row got zero rows back.
--
-- Fix: split into two policies. Postgres ORs them together but
-- evaluates each independently, so the simple self-read never
-- touches the recursive path.
-- ============================================================

drop policy if exists app_users_read on app_users;

-- 1. Always allow reading your own row. No function calls,
--    therefore no recursion. This is what the proxy relies on
--    to resolve the caller's role.
create policy app_users_read_self on app_users
  for select to authenticated
  using (id = auth.uid());

-- 2. Clinical staff may read others in their clinic.
create policy app_users_read_clinical on app_users
  for select to authenticated
  using (
    id <> auth.uid()
    and is_clinical()
    and clinic_id = my_clinic_id()
  );