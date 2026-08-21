-- ===========================================================================
-- The Data Manager
--
-- The module had three levels and none of them ran it. A viewer reads, an
-- editor types and imports, a call agent works the phone; the acts that hold
-- the whole thing together - deciding who calls whom, taking work back off
-- somebody on leave, releasing a batch into the sales app - were reachable
-- only by a super admin, which means by whoever also administers the entire
-- application.
--
-- That is the wrong shoulder for it. Running the Data Center is a job, and it
-- is not the same job as running the company's user accounts.
--
-- A data manager does everything inside the module and nothing outside it.
-- The one thing deliberately withheld is `grants.manage`: deciding who may
-- enter the module at all is account administration, not data management, and
-- a role that can grant itself more is not a role.
--
-- Rollback:
--   update data_center.module_access set access_role = 'editor'
--    where access_role = 'data_manager';
--   alter table data_center.module_access
--     drop constraint module_access_access_role_check,
--     add constraint module_access_access_role_check
--       check (access_role in ('viewer', 'editor', 'call_agent'));
-- ===========================================================================

alter table data_center.module_access
  drop constraint if exists module_access_access_role_check;

alter table data_center.module_access
  add constraint module_access_access_role_check
  check (access_role in ('viewer', 'editor', 'call_agent', 'data_manager'));

comment on column data_center.module_access.access_role is
  'viewer reads; call_agent works the phone; editor types and imports; data_manager runs the module. The server holds the feature list in _shared/data-center-roles.ts and is the authority.';
