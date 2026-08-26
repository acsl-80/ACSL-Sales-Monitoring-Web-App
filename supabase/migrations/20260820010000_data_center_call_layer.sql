-- Phase 4: the call centre layer, built so it can be changed without a deploy.
--
-- THE BRIEF THIS ANSWERS
--
-- "Fully modular, easy to edit this table, add columns where necessary." So the
-- question driving every choice below is: which changes should a supervisor be
-- able to make by editing data, and which genuinely need a migration?
--
-- The rule this settles on:
--
--   Data entry     adding, rewording, reordering or retiring a question;
--                  adding or renaming a dropdown option; making a question
--                  conditional; changing what counts as valid input; recording
--                  a fourth, fifth or tenth call attempt.
--
--   Migration      anything a dashboard groups by, because that needs an index
--                  and a considered name. The promotion path below turns a
--                  registry question into a real column when it gets there.
--
-- WHAT CHANGES HERE AND WHY
--
-- 1. Call attempts become rows, not three columns.
-- 2. The correction loop becomes state, not an inference.
-- 3. Corrections that get filtered get columns; the rest stay in the registry.
-- 4. Concurrent edits stop silently overwriting each other.
-- 5. The registry learns conditions and validation, so a new question can be
--    added correctly rather than just added.

-- ===========================================================================
-- 1. Call attempts as rows
--
-- The workbook has Call_date_1/2/3 and a single Call_Outcome, which means it
-- cannot say which attempt produced which outcome: three dates, one answer.
-- That is a real loss in the current process, not a shape worth copying.
--
-- Three columns also make the fourth attempt a migration. Agents were described
-- as calling "two or three" times, and the number that actually gets used is
-- not knowable in advance.
--
-- So each attempt is a row carrying its own date, outcome, agent and note. The
-- workbook's familiar three-date shape survives as a projection in
-- v_call_center, so exports and habits are unaffected while the storage stops
-- constraining the process.
-- ===========================================================================

create table data_center.call_attempts (
  id         bigint generated always as identity primary key,
  sale_id    uuid not null references data_center.call_records (sale_id) on delete cascade,

  -- Dense per sale, assigned by the write path rather than the caller, so two
  -- agents logging at once cannot both claim attempt 2.
  attempt_no integer not null check (attempt_no > 0),

  attempted_at  timestamptz not null default now(),
  outcome_id    uuid references data_center.option_values (id) on delete restrict,
  agent_id      uuid references data_center.option_values (id) on delete restrict,

  -- Who answered, when it was not the stove user. A relative picking up is the
  -- common case and changes how the answers should be read.
  answered_by_id uuid references data_center.option_values (id) on delete restrict,

  note       text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,

  unique (sale_id, attempt_no)
);

comment on table data_center.call_attempts is
  'One row per call. Replaces the workbook three-date shape, which could not say which attempt produced which outcome.';

create index call_attempts_sale_idx on data_center.call_attempts (sale_id, attempt_no);
create index call_attempts_when_idx on data_center.call_attempts (attempted_at desc);

-- Carry across anything the three columns already hold, so nothing is lost when
-- they go. Outcome is left null on migrated rows: the old shape genuinely did
-- not record which attempt it belonged to, and guessing would invent data.
insert into data_center.call_attempts (sale_id, attempt_no, attempted_at, agent_id, note)
select cr.sale_id, d.n, d.day::timestamptz, cr.call_agent_id,
       'Migrated from call_date_' || d.n || '. The original shape did not record a per-attempt outcome.'
from data_center.call_records cr
cross join lateral (
  values (1, cr.call_date_1), (2, cr.call_date_2), (3, cr.call_date_3)
) as d(n, day)
where d.day is not null
on conflict (sale_id, attempt_no) do nothing;

-- v_call_center reads these columns, so it goes first and is rebuilt at the
-- bottom of this file against the attempts table instead.
drop view if exists data_center.v_call_center;

alter table data_center.call_records
  drop column call_date_1,
  drop column call_date_2,
  drop column call_date_3;


-- Attempt count, kept on the record rather than counted on demand.
--
-- MEASURED, NOT ANTICIPATED. With the count derived by a lateral aggregate,
-- the queue that matters most to the process, "called three times and still not
-- verified", took 25.8 SECONDS at 500,000 rows. Almost no sale has three
-- attempts, so the limit never fills and Postgres walks all 480,005 candidates
-- computing the aggregate for each one.
--
-- With the count as a real column the same question is an indexed lookup. This
-- is the promotion rule the registry documents, applied to a derived value: it
-- started as something computed, a dashboard needed to group by it, so it
-- became a column.
--
-- The trigger is the only writer. Application code never sets it, so it cannot
-- drift by someone forgetting.
alter table data_center.call_records
  add column attempt_count   integer not null default 0,
  add column last_attempt_at timestamptz;

create or replace function data_center.sync_attempt_count() returns trigger
language plpgsql security definer set search_path = data_center, public as $$
declare
  target uuid := coalesce(new.sale_id, old.sale_id);
begin
  update data_center.call_records cr
  set attempt_count   = (select count(*) from data_center.call_attempts a where a.sale_id = target),
      last_attempt_at = (select max(a.attempted_at) from data_center.call_attempts a where a.sale_id = target)
  where cr.sale_id = target;
  return coalesce(new, old);
end;
$$;

create trigger call_attempts_sync_count
  after insert or update or delete on data_center.call_attempts
  for each row execute function data_center.sync_attempt_count();

-- The queue: how many times has this been called, newest first.
create index call_records_attempts_idx
  on data_center.call_records (attempt_count, verification_outcome);


-- ===========================================================================
-- 2. The correction loop, as state
--
-- The described process sends a record with bad data back to Sales, which fixes
-- it, and then it is called again. Until now that round trip was only visible
-- as a phone number that had changed, which cannot answer "what is waiting on
-- Sales right now" or "how long does a correction take".
--
-- Three timestamps make it a queue: requested, resolved, and the reason.
-- ===========================================================================

alter table data_center.call_records
  add column correction_requested_at  timestamptz,
  add column correction_requested_by  uuid references public.profiles (id) on delete set null,
  add column correction_reason_id     uuid references data_center.option_values (id) on delete restrict,
  add column correction_note          text,
  add column correction_resolved_at   timestamptz,
  add column correction_resolved_by   uuid references public.profiles (id) on delete set null;

comment on column data_center.call_records.correction_requested_at is
  'Set when the record goes back to Sales. Open corrections are the ones with no resolved_at.';

-- The queue this exists to serve: what is currently waiting on Sales.
create index call_records_correction_open_idx
  on data_center.call_records (correction_requested_at)
  where correction_requested_at is not null and correction_resolved_at is null;


-- ===========================================================================
-- 3. Corrections that get filtered get columns
--
-- A call centre agent enriching a stove user's record hits the same few things
-- over and over: the phone is wrong, the person has moved, the name was written
-- down badly. Phones and ward and landmark already had somewhere to go.
--
-- These four are added as real columns rather than registry questions because
-- reporting groups by them. A corrected state that lives in jsonb cannot be
-- grouped without scanning every row, which is the slow path this whole design
-- exists to avoid. Anything a dashboard will not group by stays in the registry
-- where it costs nothing to add.
-- ===========================================================================

alter table data_center.call_records
  add column corrected_end_user_name text,
  add column corrected_address       text,
  add column corrected_state         text,
  add column corrected_lga           text;

create index call_records_corrected_state_idx
  on data_center.call_records (corrected_state) where corrected_state is not null;


-- ===========================================================================
-- 4. Concurrent edits
--
-- Several agents work the same queue, and a supervisor may open a record an
-- agent is already in. Without a version, the second save silently discards the
-- first, and the change log faithfully records both as if nothing was lost.
--
-- Every save sends the version it read. A mismatch is refused rather than
-- merged, because merging two people's answers to the same question is a guess.
-- ===========================================================================

alter table data_center.call_records
  add column version integer not null default 1;

comment on column data_center.call_records.version is
  'Optimistic lock. A save carrying a stale version is refused, not merged.';


-- ===========================================================================
-- 5. The registry learns conditions and validation
--
-- Adding a question was already data entry. Adding a question that behaves
-- correctly was not: "why was this not verified" should only appear when the
-- outcome is not fully verified, and "purchase price" should not accept a
-- negative number. Without these, every such question needs a code change, and
-- the modularity is only half real.
--
-- Both are read by the form renderer AND re-checked by the write path, so a
-- condition is not merely a UI convenience.
-- ===========================================================================

alter table data_center.field_defs
  -- {"field": "verification_outcome", "in": ["partially_verified"]}
  -- Null means always shown. The field named may be a call_records column or
  -- another registry key.
  add column visible_when jsonb,

  -- {"min":0,"max":9999999} | {"maxLength":240} | {"pattern":"^0[789]"}
  add column validation jsonb,

  -- Retiring a question sets is_active false and stamps this. Answers already
  -- recorded stay in jsonb and stay readable: history is not rewritten because
  -- the question stopped being asked.
  add column retired_at timestamptz;

-- Longer prose and multiple choice, both of which the current five input types
-- cannot express. Adding a type is a migration precisely because the renderer
-- has to learn it; adding a QUESTION never is.
alter table data_center.field_defs
  drop constraint field_defs_input_type_check;

alter table data_center.field_defs
  add constraint field_defs_input_type_check
  check (input_type in ('text','textarea','number','date','select','multiselect','boolean','computed'));

comment on column data_center.field_defs.visible_when is
  'Conditional display, checked in the UI and again on write. Null means always shown.';
comment on column data_center.field_defs.storage is
  'answers = jsonb, no migration to add or retire. column = promoted to a real column because a dashboard groups by it; the write path routes to column_name transparently, so promotion changes nothing for the client.';


-- ===========================================================================
-- Registry rows for what the new structure needs
-- ===========================================================================

insert into data_center.option_lists (key, label, description) values
  ('answered_by', 'Answered By', 'Who took the call, when it was not the stove user'),
  ('correction_reason', 'Correction Reason', 'Why a record went back to Sales')
on conflict (key) do nothing;

insert into data_center.option_values (list_key, value, label, sort_order) values
  ('answered_by', 'stove_user',   'The stove user',        1),
  ('answered_by', 'spouse',       'Spouse',                2),
  ('answered_by', 'family',       'Another family member', 3),
  ('answered_by', 'neighbour',    'Neighbour',             4),
  ('answered_by', 'sales_agent',  'The sales agent',       5),
  ('answered_by', 'unknown',      'Someone else',          6),

  ('correction_reason', 'wrong_phone',      'Phone number is wrong',            1),
  ('correction_reason', 'wrong_name',       'Name is wrong',                    2),
  ('correction_reason', 'wrong_address',    'Address is wrong',                 3),
  ('correction_reason', 'wrong_serial',     'Stove serial does not match',      4),
  ('correction_reason', 'duplicate',        'Looks like a duplicate sale',      5),
  ('correction_reason', 'missing_evidence', 'Missing agreement or signature',   6),
  ('correction_reason', 'other',            'Something else, see the note',     7)
on conflict (list_key, value) do nothing;

-- A worked example of the conditional the registry could not express before:
-- ask why only when the outcome is not a clean verification.
insert into data_center.field_defs
  (key, label, section, input_type, option_list_key, sort_order, is_required, help_text, visible_when)
values
  ('why_not_verified', 'Why was this not fully verified?', 'verification', 'textarea',
   null, 13, false, 'Shown only when the outcome is anything other than fully verified.',
   '{"field":"verification_outcome","in":["partially_verified","doubtful_verification","not_verified"]}'::jsonb)
on conflict (key) do nothing;


-- ===========================================================================
-- Table 2, rebuilt
--
-- The three call dates survive as a projection so exports and habits are
-- unaffected, but they are now derived from call_attempts rather than stored.
-- Deriving them is what lets a fourth attempt exist without a migration.
-- ===========================================================================

create view data_center.v_call_center as
select
  v.*,
  cr.verification_outcome,
  cr.corrected_phone,
  cr.corrected_alt_phone,
  cr.corrected_end_user_name,
  cr.corrected_address,
  cr.corrected_state,
  cr.corrected_lga,
  cr.ward,
  cr.landmark,
  cr.stated_serial,
  cr.answers,
  cr.other_comments,
  cr.version              as call_record_version,
  cr.updated_at           as call_record_updated_at,
  co.label                as call_outcome,
  ca.label                as call_agent,

  -- The workbook's shape, derived. Nothing writes these.
  att.call_date_1,
  att.call_date_2,
  att.call_date_3,

  -- Read from the record, not counted here. Counting per row cost 25.8 seconds
  -- at 500,000 rows on the queue that matters most; see the trigger above.
  coalesce(cr.attempt_count, 0) as attempt_count,
  cr.last_attempt_at,

  -- The correction loop as three answerable questions: is one open, what was
  -- it for, and how long has it been waiting.
  case
    when cr.correction_requested_at is null then 'none'
    when cr.correction_resolved_at is null  then 'open'
    else 'resolved'
  end as correction_state,
  cr.correction_requested_at,
  cr.correction_resolved_at,
  crr.label as correction_reason,
  cr.correction_note,

  -- Replaces the workbook's SN Matching formula column. Derived rather than
  -- stored, so it cannot drift away from the values it compares.
  case
    when cr.stated_serial is null or v.stove_serial_no is null then null
    else upper(trim(cr.stated_serial)) = upper(trim(v.stove_serial_no))
  end as serial_matches,

  -- The correction signal: the call centre reached a different number from the
  -- one the sale was recorded with.
  case
    when cr.corrected_phone is null or v.primary_phone is null then null
    else right(regexp_replace(cr.corrected_phone, '\D', '', 'g'), 10)
       <> right(regexp_replace(v.primary_phone,   '\D', '', 'g'), 10)
  end as phone_was_corrected,

  (cr.sale_id is not null) as has_call_record
from data_center.v_sold_stoves v
left join data_center.call_records cr  on cr.sale_id = v.sale_id
left join data_center.option_values co on co.id      = cr.call_outcome_id
left join data_center.option_values ca on ca.id      = cr.call_agent_id
left join data_center.option_values crr on crr.id    = cr.correction_reason_id
left join lateral (
  select
    max(a.attempted_at) filter (where a.attempt_no = 1)::date as call_date_1,
    max(a.attempted_at) filter (where a.attempt_no = 2)::date as call_date_2,
    max(a.attempted_at) filter (where a.attempt_no = 3)::date as call_date_3
  from data_center.call_attempts a
  where a.sale_id = cr.sale_id
) att on true;

comment on view data_center.v_call_center is
  'Table 2. Table 1 plus what the call centre added. Attempts are rows; the three date columns are a projection of them.';


-- ===========================================================================
-- Audit
--
-- call_attempts is human-edited, so it is logged like everything else. The
-- trigger function and the actor mechanism come from
-- 20260819040000_data_center_module_access.sql.
-- ===========================================================================

create trigger call_attempts_log
  after insert or update or delete on data_center.call_attempts
  for each row execute function data_center.log_change('id');

alter table data_center.call_attempts enable row level security;
