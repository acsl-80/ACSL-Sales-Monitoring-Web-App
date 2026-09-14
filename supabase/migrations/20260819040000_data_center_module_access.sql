-- Data Center: per-user module access with viewer/editor levels, and an audit
-- trail on every human-edited table.
--
-- Requirement (2026-08-19): the module is always available to super_admin and
-- enabled case by case for other profiles, from an access section inside the
-- module page itself. Within those who have access there are viewer and editor
-- levels, and editors' changes are tracked.
--
-- This closes the gap the e2e suite proved: tier 1 was a static role map, so
-- no non-admin could ever reach the module and tier-2 grants were never
-- consulted. Access now lives in data, resolved per user at request time.
--
-- Additive only. Nothing in public changes. Rollback:
--   drop table data_center.module_access, data_center.change_log cascade;
--   drop function data_center.log_change();

-- ===========================================================================
-- Module access: who may enter, and at what level
-- ===========================================================================

create table data_center.module_access (
  user_id     uuid primary key references public.profiles (id) on delete cascade,
  access_role text not null check (access_role in ('viewer', 'editor')),
  granted_by  uuid references public.profiles (id) on delete set null,
  granted_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles (id) on delete set null,
  updated_at  timestamptz
);

comment on table data_center.module_access is
  'Tier 1 for everyone except super_admin, who needs no row. Presence grants entry; access_role decides viewer or editor. Managed from the module page.';

-- ===========================================================================
-- Change log: editors'' changes are tracked
-- ===========================================================================

create table data_center.change_log (
  id         bigint generated always as identity primary key,
  table_name text not null,
  record_pk  text not null,
  action     text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  old_values jsonb,
  new_values jsonb,
  -- Set by the edge function through set_config('data_center.actor', ...),
  -- because every write arrives on a service-role connection and auth.uid()
  -- is meaningless there.
  changed_by uuid,
  changed_at timestamptz not null default now()
);

comment on table data_center.change_log is
  'Append-only audit of every change to human-edited data_center tables. Written by trigger, never by application code.';

create index change_log_table_time_idx on data_center.change_log (table_name, changed_at desc);
create index change_log_actor_idx      on data_center.change_log (changed_by, changed_at desc);

-- Generic row-audit trigger. TG_ARGV[0] names the primary-key column, so one
-- function covers every table regardless of what its key is called.
create function data_center.log_change() returns trigger
language plpgsql as $$
declare
  actor uuid := nullif(current_setting('data_center.actor', true), '')::uuid;
  pk_col text := tg_argv[0];
  pk_val text;
begin
  if tg_op = 'DELETE' then
    execute format('select ($1).%I::text', pk_col) into pk_val using old;
    insert into data_center.change_log (table_name, record_pk, action, old_values, changed_by)
      values (tg_table_name, pk_val, tg_op, to_jsonb(old), actor);
    return old;
  elsif tg_op = 'UPDATE' then
    execute format('select ($1).%I::text', pk_col) into pk_val using new;
    insert into data_center.change_log (table_name, record_pk, action, old_values, new_values, changed_by)
      values (tg_table_name, pk_val, tg_op, to_jsonb(old), to_jsonb(new), actor);
    return new;
  else
    execute format('select ($1).%I::text', pk_col) into pk_val using new;
    insert into data_center.change_log (table_name, record_pk, action, new_values, changed_by)
      values (tg_table_name, pk_val, tg_op, to_jsonb(new), actor);
    return new;
  end if;
end;
$$;

-- Audited: the tables a human edits. Deliberately NOT audited:
-- metric_snapshots (machine-written on a schedule, would flood the log) and
-- the import staging tables (they carry their own per-row audit fields).
create trigger audit_call_records    after insert or update or delete on data_center.call_records
  for each row execute function data_center.log_change('sale_id');
create trigger audit_module_access   after insert or update or delete on data_center.module_access
  for each row execute function data_center.log_change('user_id');
create trigger audit_feature_grants  after insert or update or delete on data_center.feature_grants
  for each row execute function data_center.log_change('id');
create trigger audit_workflow_config after insert or update or delete on data_center.workflow_config
  for each row execute function data_center.log_change('key');
create trigger audit_option_lists    after insert or update or delete on data_center.option_lists
  for each row execute function data_center.log_change('key');
create trigger audit_option_values   after insert or update or delete on data_center.option_values
  for each row execute function data_center.log_change('id');
create trigger audit_field_defs      after insert or update or delete on data_center.field_defs
  for each row execute function data_center.log_change('key');

-- Same posture as every other data_center table: RLS on, no policies, service
-- role only, invisible to PostgREST.
alter table data_center.module_access enable row level security;
alter table data_center.change_log    enable row level security;
grant select, insert, update, delete on data_center.module_access to service_role;
grant select, insert on data_center.change_log to service_role;
grant usage on all sequences in schema data_center to service_role;
