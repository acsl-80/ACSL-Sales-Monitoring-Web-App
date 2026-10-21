-- ===========================================================================
-- Data Center, Phase 34 (D67): the levels that may act for Sales
--
-- `corrections.act_for_sales` lets a person claim and fix any record the call
-- centre sent back, whoever it is routed to. A person gets it through
-- data_center.feature_grants like any other key. A whole access level gets it
-- through a row here.
--
-- A table of its own rather than a workflow_config row: config_set lets the
-- holder of registry.manage edit any setting, and who may act on Sales'
-- records is an access decision, which belongs to grants.manage.
--
-- Empty on creation. Every level starts off until somebody turns it on in
-- Settings.
--
-- Rollback:
--   drop table if exists data_center.act_for_sales_levels;
-- ===========================================================================

create table if not exists data_center.act_for_sales_levels (
  access_role text primary key
    constraint act_for_sales_levels_role_check
    check (access_role in ('viewer', 'editor', 'call_agent', 'data_manager', 'sales_rep')),
  granted_at  timestamptz not null default now(),
  granted_by  uuid references public.profiles (id) on delete set null
);

comment on table data_center.act_for_sales_levels is
  'Access levels whose every holder may act for Sales on sent-back records (corrections.act_for_sales). One person gets the same through data_center.feature_grants. Edited in Settings by grants.manage. D67.';

drop trigger if exists audit_act_for_sales_levels on data_center.act_for_sales_levels;
create trigger audit_act_for_sales_levels
  after insert or update or delete on data_center.act_for_sales_levels
  for each row execute function data_center.log_change('access_role');

-- Proof it landed: the table exists, is empty, and carries its audit trigger.
select (select count(*) from data_center.act_for_sales_levels) as levels_on,
       exists (select 1 from pg_trigger
                where tgname = 'audit_act_for_sales_levels' and not tgisinternal) as audited;
