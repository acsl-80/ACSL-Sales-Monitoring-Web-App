-- Phase 10: the call agent, as a third level rather than a flag.
--
-- The module had two levels, viewer and editor, and "editor" meant two
-- different jobs: the clerk clearing a receipt backlog and the agent working
-- the phone. Both got `import.upload`, which is one step from `import.commit`
-- and the sales app's own inventory.
--
-- A call agent is not a rung between viewer and editor. It is a different job,
-- so it gets its own set: read the records, edit the call records, see the
-- dashboard, import nothing.


-- ===========================================================================
-- 1. The third level
--
-- A widened CHECK rather than an enum, matching what the table already does.
-- Nothing existing changes: no row becomes a call agent without someone
-- saying so.
-- ===========================================================================

alter table data_center.module_access
  drop constraint if exists module_access_access_role_check;

alter table data_center.module_access
  add constraint module_access_access_role_check
  check (access_role in ('viewer', 'editor', 'call_agent'));


-- ===========================================================================
-- 2. Whether an agent is taking work, and how much
--
-- Separate from `module_access` on purpose. Holding the role is a permission
-- question and answering the phone today is a scheduling one, and they change
-- on different days for different reasons: someone on leave stops receiving
-- batches without losing their access.
--
-- `max_open_batches` is per agent rather than global because capacity is not
-- uniform. `workflow_config` carries the default for anyone with no row here.
-- ===========================================================================

create table if not exists data_center.call_agent_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,

  -- Taking work right now. The assignment engine reads this, not the role:
  -- an agent who keeps their access while on leave must stop receiving
  -- batches, and deleting the access to achieve that loses their history.
  is_enabled boolean not null default true,

  -- How many open batches this agent may hold at once. Null defers to
  -- `assignment.max_open_batches`.
  max_open_batches integer check (max_open_batches is null or max_open_batches > 0),

  -- Why they are not taking work. Free text, for the person doing the
  -- scheduling rather than for the engine.
  note text,

  enabled_at timestamptz,
  enabled_by uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz,
  updated_by uuid
);

comment on table data_center.call_agent_profiles is
  'Which call agents are taking work, and how much. Separate from module_access because holding the role and being on shift change on different days.';

alter table data_center.call_agent_profiles enable row level security;

-- Reached only through service-role edge functions, like every other table in
-- this schema. RLS on with no policy is the deliberate shape: it fails closed
-- if the schema is ever exposed through PostgREST by mistake.
revoke all on data_center.call_agent_profiles from anon, authenticated;

drop trigger if exists audit_call_agent_profiles on data_center.call_agent_profiles;
create trigger audit_call_agent_profiles
  after insert or delete or update on data_center.call_agent_profiles
  for each row execute function data_center.log_change('user_id');

-- Who is available, which is the only question the assignment engine asks of
-- this table. Partial, because a disabled agent is never a candidate.
create index if not exists call_agent_profiles_enabled_idx
  on data_center.call_agent_profiles (user_id) where is_enabled;


-- ===========================================================================
-- 3. Settings, not code
--
-- The assignment engine reads all four at run time. They are written here so
-- Phase 11 has them from the first run, and so changing a batch size stays
-- data entry rather than a release.
-- ===========================================================================

insert into data_center.workflow_config (key, value, description) values
  ('assignment.batch_size', '20'::jsonb,
   'Records per batch. One partner per batch, always.'),
  ('assignment.max_open_batches', '1'::jsonb,
   'Open batches one agent may hold when call_agent_profiles gives no per-agent number.'),
  ('assignment.stale_after_days', '3'::jsonb,
   'A batch untouched for this long is reclaimed and offered to someone else.'),
  ('assignment.batch_size_by_partner', '{}'::jsonb,
   'Per-partner overrides of batch_size, keyed by organization id. Some partners warrant smaller batches.')
on conflict (key) do nothing;
