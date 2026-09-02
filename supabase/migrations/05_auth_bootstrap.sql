-- ============================================================
-- FAIRBLOOM — AUTH BOOTSTRAP v2
-- Every Supabase auth.users row gets a matching app_users row.
-- Enforced in the database so app code cannot skip it.
--
-- Role is FORCED to 'patient' at signup. Care-team roles are
-- provisioned deliberately (06_seed_users), never self-selected:
-- otherwise a crafted signup could self-promote to clinician.
-- ============================================================

-- Phone is a contact point, not a login identifier. Track its
-- verification separately from email so "not provided" and
-- "provided but unverified" are distinguishable.
alter table app_users
  add column if not exists phone_verified boolean not null default false;

create or replace function handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  default_clinic uuid;
begin
  select id into default_clinic from clinics order by created_at limit 1;

  -- Fail loudly rather than creating an orphaned user who would
  -- silently see nothing because every RLS helper returns false.
  if default_clinic is null then
    raise exception 'Cannot create user: no clinic configured';
  end if;

  insert into app_users (
    id, clinic_id, role, email, email_verified, phone
  )
  values (
    new.id,
    default_clinic,
    'patient',
    new.email,
    new.email_confirmed_at is not null,
    nullif(trim(new.raw_user_meta_data ->> 'phone'), '')
  )
  on conflict (id) do nothing;

  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_auth_user();

-- ------------------------------------------------------------
-- Keep app_users in sync when auth.users changes.
-- Self-heals: if the row is somehow missing, create it rather
-- than silently updating zero rows.
-- ------------------------------------------------------------
create or replace function sync_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  default_clinic uuid;
begin
  if not exists (select 1 from app_users where id = new.id) then
    select id into default_clinic from clinics order by created_at limit 1;
    insert into app_users (id, clinic_id, role, email, email_verified, phone)
    values (new.id, default_clinic, 'patient', new.email,
            new.email_confirmed_at is not null,
            nullif(trim(new.raw_user_meta_data ->> 'phone'), ''))
    on conflict (id) do nothing;
    return new;
  end if;

  update app_users
     set email          = new.email,
         email_verified = (new.email_confirmed_at is not null),
         phone          = coalesce(
                            nullif(trim(new.raw_user_meta_data ->> 'phone'), ''),
                            phone
                          )
   where id = new.id;

  return new;
end $$;

drop trigger if exists on_auth_user_confirmed on auth.users;
drop trigger if exists on_auth_user_updated   on auth.users;
create trigger on_auth_user_updated
  after update on auth.users
  for each row execute function sync_auth_user();