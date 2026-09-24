-- Nobody gives themselves a role (2026-09-24). Found while building the Change Control door (S8).
--
-- Two ways any stranger or any signed-in user could become a super admin of this app, both proven on
-- production in transactions forced to roll back:
--
--   1. Any signed-in user can rewrite their own profile. The policy users_update_own_profile lets a
--      person update their own row, and the authenticated role holds UPDATE on every column, so
--      `update profiles set role = 'super_admin' where id = auth.uid()` from the browser succeeds.
--      Every server function and the Change Control door trust profiles.role.
--   2. Public sign-up is open, and handle_new_user copies the role and the organisation from the
--      sign-up data the person supplies, into a profile that is active by default.
--
-- This file closes both in the database, whatever the sign-up setting says:
--
--   1. A guard on profiles: a person signed in through the API may change their own name, phone and
--      the like, but only a super admin may set or change a role, a status, an organisation or a
--      manager, on insert or on update. The server (service role) and the database's own functions,
--      which run as their owner, are not held to it; the guard is judged by the role running the
--      statement, so it runs as the caller (SECURITY INVOKER).
--   2. handle_new_user takes the role and organisation from the account's data only when the account
--      arrives already confirmed. Every account this app makes goes through the admin API with
--      email_confirm: true (create-agent, create-agent-user, manage-admin-users, external-sync,
--      external-csv-sync), and so does the dashboard's Add user. A public sign-up arrives unconfirmed,
--      and gets no role and no organisation until a super admin gives it one.
--
-- No row changes. The one direct client write to profiles, User Management's super-admin fallback in
-- UserManagementContent.jsx, already matched no rows before this file (the read policy shows a person
-- only their own row); the app does that work through manage-users.
--
-- Part 2 was reversed the same evening by 20260924233000: the admin API confirms an account after
-- inserting it, so the trigger took every admin-created account for a sign-up.
--
-- REVERSAL:
--   drop trigger if exists profiles_guard_privileged_columns on public.profiles;
--   drop function if exists public.profiles_guard_privileged_columns();
--   and restore handle_new_user from 00000000000000_baseline_schema.sql (role and organisation read
--   from raw_user_meta_data unconditionally).

begin;

-- 1. The guard.
create or replace function public.profiles_guard_privileged_columns()
returns trigger language plpgsql set search_path = public, pg_temp
as $$
begin
  -- Only people calling through the API are held to this. current_user is the role running the
  -- statement: authenticated or anon for the browser, service_role for the server, the owner for a
  -- SECURITY DEFINER function such as handle_new_user.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if public.has_role(auth.uid(), 'super_admin') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.role is not null or new.organization_id is not null or new.manager_id is not null
       or coalesce(new.status, 'active') <> 'active' then
      raise exception 'Only a super admin can give an account a role, an organisation or a manager'
        using errcode = '42501';
    end if;
  elsif new.role is distinct from old.role
     or new.status is distinct from old.status
     or new.organization_id is distinct from old.organization_id
     or new.manager_id is distinct from old.manager_id
     or new.id is distinct from old.id then
    raise exception 'Only a super admin can change a role, a status, an organisation or a manager'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_privileged_columns on public.profiles;
create trigger profiles_guard_privileged_columns
before insert or update on public.profiles
for each row execute function public.profiles_guard_privileged_columns();

revoke execute on function public.profiles_guard_privileged_columns() from public, anon, authenticated;

-- 2. A sign-up's own word gives it no role and no organisation.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path to 'public'
as $$
declare
  -- An account made by the admin API or the dashboard arrives confirmed and carries what its creator
  -- chose. A public sign-up arrives unconfirmed, and what it says about itself is not trusted.
  trusted boolean := new.email_confirmed_at is not null;
  user_role text := case when trusted then new.raw_user_meta_data->>'role' end;
  org_id uuid := case when trusted then nullif(new.raw_user_meta_data->>'organization_id', '')::uuid end;
begin
  insert into public.profiles (
    id,
    email,
    full_name,
    role,
    organization_id,
    has_changed_password
  )
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name',
    user_role,
    org_id,
    case
      when user_role = 'admin' then true
      else false
    end
  );
  return new;
end;
$$;

-- Verification: refuse to commit unless both hold.
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'profiles_guard_privileged_columns'
                  and tgrelid = 'public.profiles'::regclass) then
    raise exception 'Role guard failed: the trigger is missing';
  end if;
  if position('email_confirmed_at' in pg_get_functiondef('public.handle_new_user()'::regprocedure)) = 0 then
    raise exception 'Role guard failed: handle_new_user still trusts sign-up data';
  end if;
  raise notice 'Role guard verified: profile guard in place, sign-ups get no role or organisation';
end $$;

commit;

-- PROOF, run after application (expected: 1, true):
--   select (select count(*) from pg_trigger where tgname = 'profiles_guard_privileged_columns') as guard,
--          position('email_confirmed_at' in pg_get_functiondef('public.handle_new_user()'::regprocedure)) > 0
--            as signup_untrusted;
