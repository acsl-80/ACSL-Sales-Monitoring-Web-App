-- Recovery module, slice R1: the schema, who may enter, and the audit trail.
--
-- Everything the module owns lives in its own `recovery` schema. Only what
-- access needs is created now: module_access, feature_grants and change_log.
-- The data tables (sales, stoves, calls, batches, assignments) arrive in R2 to
-- R4. See src/app/recovery/PLAN.md.
--
-- NOTHING IN PUBLIC IS ALTERED BY THIS FILE. No ALTER TABLE, no new column, no
-- trigger and no policy on any table in public. The foreign keys below point
-- INTO public.profiles, which adds a dependency on that table without changing
-- it. profiles.role is plain text with no CHECK and no enum, and
-- map_legacy_roles() leaves a value it does not know untouched, so the new
-- sales-app role `recoverer` needs no change to be stored.
--
-- It does need one rule, in the next file
-- (20261006120100_recoverer_holds_no_organisation.sql): the sales app scopes
-- rows by organisation without asking the role, so a recoverer is safe only
-- while it holds no organisation. That file is the one change R1 makes in
-- public, kept apart so it can be judged on its own.
--
-- DELIBERATELY NOT DONE HERE: `recovery` is never added to [api].schemas in
-- supabase/config.toml, nor to the hosted project's exposed schemas. Keeping it
-- out of PostgREST is the first lock; the grants below are the second; row
-- security with no policies is the third.
--
-- Written for Orezi to run, on a preview branch database first. Not to be run
-- against the live project until the R1 merge.
--
-- Rollback, one statement, which is what makes the module detachable:
--   drop schema recovery cascade;

begin;

create schema if not exists recovery;

comment on schema recovery is
  'The Recovery module. Service role only, never exposed to PostgREST. Reached through the recovery* edge functions.';

revoke all on schema recovery from public;
revoke all on schema recovery from anon, authenticated;
grant usage on schema recovery to service_role;


-- ===========================================================================
-- Who may enter Recovery, and at what level
-- ===========================================================================

-- Presence of a row is entry; access_level decides what the person may do.
-- A super admin needs no row. What each level implies is held by the server in
-- supabase/functions/_shared/recovery-roles.ts, which is the authority.
--
-- Not the same thing as the sales-app role `recoverer` in public.profiles.role,
-- which says what kind of account a person holds. A recoverer account with no
-- row here has no Recovery access.
create table recovery.module_access (
  user_id      uuid primary key references public.profiles (id) on delete cascade,
  access_level text not null
               constraint module_access_access_level_check
               check (access_level in ('viewer', 'recovery_agent', 'data_manager')),
  granted_by   uuid references public.profiles (id) on delete set null,
  granted_at   timestamptz not null default now(),
  updated_by   uuid references public.profiles (id) on delete set null,
  updated_at   timestamptz
);

comment on table recovery.module_access is
  'Who may enter Recovery. Presence grants entry; access_level decides what they may do. Super admins need no row.';


-- Keys granted to one person on top of their level. Adds, never subtracts. A
-- key the server does not know is ignored, so a typo here grants nothing.
create table recovery.feature_grants (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  feature_key text not null,
  granted_by  uuid references public.profiles (id) on delete set null,
  granted_at  timestamptz not null default now(),
  constraint feature_grants_user_key_unique unique (user_id, feature_key)
);

comment on table recovery.feature_grants is
  'Per-person Recovery keys on top of their access level. Resolved server-side from the caller token on every request.';


-- ===========================================================================
-- Change log: every change, who made it and when
-- ===========================================================================

create table recovery.change_log (
  id         bigint generated always as identity primary key,
  table_name text not null,
  record_pk  text not null,
  action     text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  old_values jsonb,
  new_values jsonb,
  -- Set by the edge function through set_config('recovery.actor', ...),
  -- because every write arrives on a service-role connection where auth.uid()
  -- means nothing.
  changed_by uuid,
  changed_at timestamptz not null default now()
);

comment on table recovery.change_log is
  'Append-only audit of every change to Recovery tables. Written by trigger, never by application code.';

create index change_log_table_time_idx on recovery.change_log (table_name, changed_at desc);
create index change_log_record_idx     on recovery.change_log (table_name, record_pk, changed_at desc);
create index change_log_actor_idx      on recovery.change_log (changed_by, changed_at desc);

-- Generic row audit. TG_ARGV[0] names the key column, so one function serves
-- every table whatever its key is called. Same shape as data_center.log_change.
create function recovery.log_change() returns trigger
language plpgsql
set search_path = recovery, pg_temp
as $$
declare
  actor  uuid := nullif(current_setting('recovery.actor', true), '')::uuid;
  pk_col text := tg_argv[0];
  pk_val text;
begin
  if tg_op = 'DELETE' then
    execute format('select ($1).%I::text', pk_col) into pk_val using old;
    insert into recovery.change_log (table_name, record_pk, action, old_values, changed_by)
      values (tg_table_name, pk_val, tg_op, to_jsonb(old), actor);
    return old;
  elsif tg_op = 'UPDATE' then
    execute format('select ($1).%I::text', pk_col) into pk_val using new;
    insert into recovery.change_log (table_name, record_pk, action, old_values, new_values, changed_by)
      values (tg_table_name, pk_val, tg_op, to_jsonb(old), to_jsonb(new), actor);
    return new;
  else
    execute format('select ($1).%I::text', pk_col) into pk_val using new;
    insert into recovery.change_log (table_name, record_pk, action, new_values, changed_by)
      values (tg_table_name, pk_val, tg_op, to_jsonb(new), actor);
    return new;
  end if;
end;
$$;

revoke all on function recovery.log_change() from public, anon, authenticated;

create trigger audit_module_access  after insert or update or delete on recovery.module_access
  for each row execute function recovery.log_change('user_id');
create trigger audit_feature_grants after insert or update or delete on recovery.feature_grants
  for each row execute function recovery.log_change('id');


-- ===========================================================================
-- Locks: row security on with no policies, service role only
-- ===========================================================================

alter table recovery.module_access  enable row level security;
alter table recovery.feature_grants enable row level security;
alter table recovery.change_log     enable row level security;

revoke all on all tables    in schema recovery from public, anon, authenticated;
revoke all on all sequences in schema recovery from public, anon, authenticated;

grant select, insert, update, delete on recovery.module_access  to service_role;
grant select, insert, update, delete on recovery.feature_grants to service_role;
-- Append-only: the log is read and added to, never changed.
grant select, insert on recovery.change_log to service_role;
grant usage on all sequences in schema recovery to service_role;

-- Tables later slices add start locked the same way, without each migration
-- having to remember.
alter default privileges in schema recovery revoke all on tables    from public, anon, authenticated;
alter default privileges in schema recovery revoke all on sequences from public, anon, authenticated;
alter default privileges in schema recovery revoke all on functions from public, anon, authenticated;
alter default privileges in schema recovery grant select, insert, update, delete on tables to service_role;
alter default privileges in schema recovery grant usage on sequences to service_role;


-- ===========================================================================
-- Proof it landed. Raises, and so rolls the whole migration back, if any lock
-- is missing.
-- ===========================================================================

do $$
declare
  t text;
begin
  if has_schema_privilege('anon', 'recovery', 'usage')
     or has_schema_privilege('authenticated', 'recovery', 'usage') then
    raise exception 'Recovery R1 failed: anon or authenticated can use the recovery schema';
  end if;
  if not has_schema_privilege('service_role', 'recovery', 'usage') then
    raise exception 'Recovery R1 failed: service_role cannot use the recovery schema';
  end if;

  foreach t in array array['module_access', 'feature_grants', 'change_log'] loop
    if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                    where n.nspname = 'recovery' and c.relname = t and c.relrowsecurity) then
      raise exception 'Recovery R1 failed: row security is off on recovery.%', t;
    end if;
    if exists (select 1 from pg_policies where schemaname = 'recovery' and tablename = t) then
      raise exception 'Recovery R1 failed: recovery.% has a policy, and must have none', t;
    end if;
    if has_table_privilege('authenticated', format('recovery.%I', t), 'select')
       or has_table_privilege('anon', format('recovery.%I', t), 'select') then
      raise exception 'Recovery R1 failed: recovery.% is readable by anon or authenticated', t;
    end if;
  end loop;

  if (select count(*) from pg_trigger
       where tgrelid in ('recovery.module_access'::regclass, 'recovery.feature_grants'::regclass)
         and tgname in ('audit_module_access', 'audit_feature_grants')) <> 2 then
    raise exception 'Recovery R1 failed: an audit trigger is missing';
  end if;

  raise notice 'Recovery R1 verified: schema locked to service_role, three tables with row security and no policies, audit on';
end $$;

commit;

-- ===========================================================================
-- Readback to paste back after running (read-only):
--
--   select n.nspname as schema,
--          has_schema_privilege('anon', n.oid, 'usage')          as anon_usage,
--          has_schema_privilege('authenticated', n.oid, 'usage') as authenticated_usage,
--          has_schema_privilege('service_role', n.oid, 'usage')  as service_usage,
--          (select string_agg(c.relname || ':' || c.relrowsecurity, ', ' order by c.relname)
--             from pg_class c where c.relnamespace = n.oid and c.relkind = 'r') as tables_rls,
--          (select count(*) from pg_policies p where p.schemaname = n.nspname) as policies
--     from pg_namespace n
--    where n.nspname = 'recovery';
--
-- Expected: one row; anon_usage false, authenticated_usage false, service_usage
-- true; change_log:true, feature_grants:true, module_access:true; policies 0.
-- ===========================================================================
