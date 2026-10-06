-- Recovery module, slice R1: a recoverer account never holds an organisation.
--
-- THIS MIGRATION ALTERS A TABLE IN PUBLIC. It is the one change in public that
-- R1 makes, and it is kept in its own file so it can be judged on its own
-- (decision R-D3 in src/app/recovery/decisions.md).
--
-- WHY IT IS NEEDED
--
-- The sales app scopes rows by organisation. scope_organization_ids() gives
-- every account its own organisation_id whatever its role, and several older
-- row rules (sales.users_org_sales, sales_history's own-history rule,
-- organizations.users_organization_access) read profiles.organization_id
-- directly, also without asking the role. So a `recoverer` with an organisation
-- would read that organisation's sales, partners and payments, and one without
-- reads none of them. The role is safe only while organization_id is empty.
--
-- Today nothing enforces that. The profile guard stops a signed-in person from
-- setting an organisation, but the server, the dashboard and a definer
-- function all pass it untouched, and handle_new_user() copies one from the
-- account's app_metadata. A CHECK is the one rule that holds whoever writes the
-- row.
--
-- WHAT IT DOES NOT CHANGE
--
-- No existing row is touched, no column added, no policy or function changed.
-- Every account that is not a recoverer is unaffected: the rule is true for any
-- role other than 'recoverer'. NOT VALID then VALIDATE keeps the lock short:
-- the add takes a brief lock without scanning, and the scan runs under a lock
-- that lets reads and writes continue.
--
-- Written for Orezi to run, on a preview branch database first.
--
-- Rollback:
--   alter table public.profiles drop constraint profiles_recoverer_holds_no_organisation;

alter table public.profiles
  add constraint profiles_recoverer_holds_no_organisation
  check (role is distinct from 'recoverer' or organization_id is null)
  not valid;

alter table public.profiles
  validate constraint profiles_recoverer_holds_no_organisation;

comment on constraint profiles_recoverer_holds_no_organisation on public.profiles is
  'A recoverer account is recruited only for the Recovery module and must read nothing in the sales app, which scopes by organisation. See src/app/recovery/PLAN.md.';

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'profiles_recoverer_holds_no_organisation'
                    and conrelid = 'public.profiles'::regclass
                    and convalidated) then
    raise exception 'Recovery R1 failed: the recoverer organisation rule is missing or not validated';
  end if;
  raise notice 'Recovery R1 verified: a recoverer account cannot hold an organisation';
end $$;

-- Readback to paste back after running (read-only):
--
--   select conname, convalidated, pg_get_constraintdef(oid)
--     from pg_constraint
--    where conrelid = 'public.profiles'::regclass
--      and conname = 'profiles_recoverer_holds_no_organisation';
--
-- Expected: one row, convalidated true,
--   CHECK (((role IS DISTINCT FROM 'recoverer'::text) OR (organization_id IS NULL)))
