-- ===========================================================================
-- An unfinished call is work, not nothing
-- ===========================================================================
--
-- A call cuts off. The buyer says "ring me back this evening". The agent gets
-- four answers out of eleven and the line goes dead. Until now every one of
-- those ended the same way: the form closed and everything typed into it was
-- gone, so the next agent - often the same agent - started from a blank sheet
-- and asked the buyer the same four questions again.
--
-- WHY A TABLE OF ITS OWN AND NOT A COLUMN ON call_records
--
-- The obvious move is `alter table call_records add column draft_values`, the
-- way the digitalisation workbench holds a half-typed receipt on the import
-- row it belongs to. It does not work here, and the reason matters.
--
-- A workbench row already exists before anybody types into it: staging created
-- it. A call record does not - `call_records` gets its row on the first real
-- save, and `has_call_record` in v_call_center is literally
-- `(cr.sale_id is not null)`. Creating that row to hold a draft would make
-- every half-typed record read as a record the call centre has worked: the
-- "never called" queue would lose it, `hasCallRecord` would return it, and the
-- scorecards would count it. A draft would start changing the numbers.
--
-- So the draft lives beside the record rather than inside it. Nothing existing
-- reads this table, so nothing existing changes; dropping it would remove the
-- feature and disturb nothing else.
--
-- WHAT IS IN `values`
--
-- Whatever the editor had on screen, uninterpreted. The server does not
-- validate it and deliberately does not: a half-finished form fails validation
-- by definition - that is what half-finished means - and refusing to store it
-- for failing rules the agent has not reached yet is the fastest way to teach
-- people that saving does not work. Validation happens where it always did, on
-- the real save.
--
-- ONE DRAFT PER SALE, NOT ONE PER AGENT
--
-- Records move between agents: the console reassigns them and the engine
-- reclaims stale batches. A draft keyed by (sale, agent) would be silently
-- stranded every time that happened, which is exactly the work this table
-- exists to stop losing. Keyed by the sale, the draft travels with the record,
-- and `saved_by` is carried so whoever opens it next is told whose it is
-- rather than quietly inheriting somebody else's half-answers.
--
-- Rollback:
--   drop table if exists data_center.call_drafts;
-- ===========================================================================

create table if not exists data_center.call_drafts (
  sale_id uuid primary key references public.sales (id) on delete cascade,

  -- The form as it stood. Client-shaped on purpose: the editor already
  -- flattens registry answers and record columns into one map, and a draft
  -- that stored them apart would need the split logic in a third place.
  values jsonb not null default '{}'::jsonb,

  /*
   * Which version of the real record this was typed against.
   *
   * call_records.version already guards a real save against two people editing
   * at once. A draft needs the same fact for a different reason: if the record
   * moved on while the draft sat there, restoring it would quietly reapply the
   * agent's older answers over somebody's newer ones. Carrying the version
   * lets the editor say so instead of guessing.
   *
   * Null means the draft was typed before the record existed at all, which is
   * the ordinary case for a first call.
   */
  base_version integer,

  saved_at timestamptz not null default now(),
  saved_by uuid references public.profiles (id) on delete set null
);

comment on table data_center.call_drafts is
  'A call form part way through. Never counted as a call record: has_call_record stays false until a real save.';
comment on column data_center.call_drafts.values is
  'The editor''s own value map, uninterpreted. Validated on the real save, never here - a half-finished form fails validation by definition.';
comment on column data_center.call_drafts.base_version is
  'The call_records.version this was typed against, so a record that moved on can be reported rather than silently overwritten.';

-- "What did I not finish" is the only question an agent asks of this table,
-- and it is the one their dashboard opens with.
create index if not exists call_drafts_agent_idx
  on data_center.call_drafts (saved_by, saved_at desc);

-- Audited like every other human-edited table in the schema. An unfinished
-- call that someone else cleared should be answerable, not a mystery.
drop trigger if exists call_drafts_audit on data_center.call_drafts;
create trigger call_drafts_audit
  after insert or update or delete on data_center.call_drafts
  for each row execute function data_center.log_change('sale_id');
