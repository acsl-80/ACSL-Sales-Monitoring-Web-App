-- ===========================================================================
-- The digitalisation workbench, and the gate in front of both input streams
--
-- Two ways a paper receipt becomes a record: a spreadsheet somebody fills in
-- and uploads, or a person working through stove IDs one at a time. They are
-- the same act at different speeds, so they are the same machinery: a
-- workbench entry is a row in an import batch, and every rule that already
-- applies to an uploaded row applies to it unchanged. One validator, one
-- commit path, one rollback, whatever the channel.
--
-- Building the workbench on its own table would have meant a second validator
-- that starts identical and drifts, and the cheaper-looking one ends up
-- accepting records the other refuses. That is the module's own rule and it
-- is what this migration exists to keep.
--
-- Rollback:
--   alter table data_center.import_rows
--     drop column last_edited_by, drop column last_edited_at,
--     drop column draft_values, drop column confirmed_at, drop column confirmed_by;
--   -- and restore the two check constraints below to their previous lists.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. A third source, and a status for work still in progress
--
-- `draft` is deliberately not `pending`. Pending means "staged, not yet
-- looked at by the validator"; draft means "a person is part way through
-- typing this and has not claimed it is finished". Collapsing the two would
-- let the validator judge a half-typed record and reject it for fields the
-- typist has not reached yet, which is the fastest way to make somebody stop
-- saving their work.
-- ---------------------------------------------------------------------------

alter table data_center.import_batches
  drop constraint if exists import_batches_source_check;

alter table data_center.import_batches
  add constraint import_batches_source_check
  check (source in ('receipt', 'call_center', 'manual', 'field', 'workbench'));

alter table data_center.import_rows
  drop constraint if exists import_rows_status_check;

alter table data_center.import_rows
  add constraint import_rows_status_check
  check (status in ('pending', 'draft', 'valid', 'rejected', 'committed', 'exception'));


-- ---------------------------------------------------------------------------
-- 2. Who is working on what, and what they have typed so far
--
-- `draft_values` is separate from `raw` because they answer different
-- questions. `raw` is what arrived, and for a workbench row that is the stove
-- the typist opened; `draft_values` is what they have entered since, and it
-- changes every time they save. Keeping the first immutable is what lets a
-- rejected row be shown exactly as it came in.
-- ---------------------------------------------------------------------------

alter table data_center.import_rows
  add column if not exists last_edited_by uuid references public.profiles (id) on delete set null,
  add column if not exists last_edited_at timestamptz,
  add column if not exists draft_values jsonb;

comment on column data_center.import_rows.last_edited_by is
  'Who last typed into this row. The workbench shows it so two people do not work the same stove.';
comment on column data_center.import_rows.draft_values is
  'What the typist has entered so far. Separate from raw, which stays as it arrived.';

-- "Show me what I was working on" and "show me what nobody has touched for a
-- week" are the two questions the workbench asks of this table.
create index if not exists import_rows_draft_idx
  on data_center.import_rows (last_edited_by, last_edited_at desc)
  where status = 'draft';


-- ---------------------------------------------------------------------------
-- 3. The gate
--
-- Nothing reaches public.sales because it was typed or uploaded. It reaches
-- public.sales because somebody confirmed it, and the two are recorded apart
-- so "who entered this" and "who let it through" are different answers.
--
-- The commit path already wrote sale_id when a row landed. What it did not
-- record was that a person decided it should, which is the whole of the
-- control being asked for here.
-- ---------------------------------------------------------------------------

alter table data_center.import_rows
  add column if not exists confirmed_at timestamptz,
  add column if not exists confirmed_by uuid references public.profiles (id) on delete set null;

comment on column data_center.import_rows.confirmed_by is
  'Who released this row into public.sales. Deliberately not the same person as last_edited_by, and often is not.';

create index if not exists import_rows_awaiting_idx
  on data_center.import_rows (batch_id)
  where status = 'valid' and confirmed_at is null;


-- ---------------------------------------------------------------------------
-- 4. What is waiting, by stream and by person
--
-- The two streams are the same table and must not read as one queue: a file
-- of four hundred rows and one record somebody typed are different decisions,
-- and confirming them with one button would hide that.
-- ---------------------------------------------------------------------------

create or replace view data_center.v_awaiting_confirmation as
select
  b.id                                   as batch_id,
  case when b.source = 'workbench' then 'workbench' else 'bulk_import' end as stream,
  b.source,
  b.filename,
  b.organization_id,
  o.partner_name,
  b.uploaded_at,
  b.uploaded_by,
  up.full_name                           as uploaded_by_name,
  count(*) filter (where r.status = 'valid'  and r.confirmed_at is null) as awaiting,
  count(*) filter (where r.status = 'draft')                             as still_drafting,
  count(*) filter (where r.status = 'rejected')                          as refused,
  count(*) filter (where r.status = 'exception')                         as exceptions,
  count(*) filter (where r.confirmed_at is not null)                     as confirmed,
  count(*)                                                               as total_rows,
  max(r.last_edited_at)                                                  as last_worked_on,
  -- Who has typed into this batch. A workbench batch belongs to one person by
  -- construction; a file can be worked by several once corrections start.
  (select coalesce(json_agg(distinct ep.full_name) filter (where ep.full_name is not null), '[]')
     from data_center.import_rows r2
     left join public.profiles ep on ep.id = r2.last_edited_by
    where r2.batch_id = b.id)            as worked_by
from data_center.import_batches b
join data_center.import_rows r on r.batch_id = b.id
left join public.organizations o on o.id = b.organization_id
left join public.profiles up on up.id = b.uploaded_by
where b.state <> 'rolled_back'
group by b.id, b.source, b.filename, b.organization_id, o.partner_name,
         b.uploaded_at, b.uploaded_by, up.full_name;

comment on view data_center.v_awaiting_confirmation is
  'Both input streams, side by side: what has been entered, what is still being typed, and what is waiting on somebody to release it.';


-- ---------------------------------------------------------------------------
-- 5. The workbench's own settings
--
-- Held here rather than in the code for the same reason every other threshold
-- is: changing how long a draft is left alone should not be a release.
-- ---------------------------------------------------------------------------

insert into data_center.workflow_config (key, value, description) values
  ('workbench.autosave_seconds', '20'::jsonb,
   'How often the workbench saves a draft while somebody is typing. Lower loses less work and writes more often.'),
  ('workbench.draft_stale_days', '7'::jsonb,
   'A draft nobody has touched for this many days is shown as abandoned, so somebody else can pick the stove up.'),
  ('workbench.require_confirmation', 'true'::jsonb,
   'Whether typed records wait for a second person to release them. Turning this off makes typing and confirming one act.'),
  ('import.require_confirmation', 'true'::jsonb,
   'Whether uploaded rows wait for a second person to release them. On by default: a file is four hundred decisions at once.')
on conflict (key) do nothing;
