-- Phase 5: bulk import of digitalized paper receipts.
--
-- WHY THIS IS THE POINT AND NOT A LATER CONVENIENCE
--
-- One week of the call centre workbook holds 359 stove serials. The whole sales
-- app holds 38 sales. Of those 359, 329 exist in stock and 328 of them are
-- still marked `available`, which means paper and Excel are the real system of
-- record today and the web app is a rounding error. Without import the Data
-- Center computes over almost nothing.
--
-- WHAT COMMITTING ACTUALLY DOES
--
-- It moves hundreds of stoves from `available` to `sold` and visibly changes
-- the sales app's own inventory figures. That is the correct outcome and it is
-- not something anyone should discover after the fact, so the whole path is
-- staged: validate, look at what would happen, then commit, and be able to put
-- it back.

-- ===========================================================================
-- 1. Claiming a stove, atomically
--
-- THE RACE THIS EXISTS TO CLOSE
--
-- create-sale checks that a stove is available and later marks it sold, with an
-- insert in between and no guard on the update:
--
--     select status from stove_ids where stove_id = $1        -- 'available'
--     insert into sales ...
--     update stove_ids set status = 'sold', sale_id = $2      -- unconditional
--
-- Two commits running at once both read `available`, both insert a sale, and
-- the second overwrites the first's sale_id. One stove, two sales, and the
-- stock table remembers only one of them.
--
-- That is a pre-existing defect in the sales app rather than something this
-- module introduced, and create-sale is a shared function this module does not
-- edit. So the claim is taken HERE, before create-sale is called at all: the
-- primary key makes it atomic, and a second claimant gets a conflict rather
-- than a duplicate sale.
--
-- This closes import against import, which is the requirement. It does NOT
-- close import against someone using the Sell Stove form at the same instant,
-- because nothing outside this module takes the claim. That gap belongs to
-- create-sale and is written up in the module's PLAN.md rather than papered
-- over here.
-- ===========================================================================

create table data_center.import_claims (
  stove_serial_no text primary key,
  batch_id   uuid not null references data_center.import_batches (id) on delete cascade,
  row_id     uuid not null references data_center.import_rows (id) on delete cascade,
  claimed_at timestamptz not null default now(),
  claimed_by uuid references public.profiles (id) on delete set null,
  -- Set once the sale exists. A claim with no sale is either in flight or was
  -- abandoned by a failure, and is safe to release.
  sale_id    uuid references public.sales (id) on delete set null
);

comment on table data_center.import_claims is
  'Exclusive hold on a stove serial while a batch commits it. The primary key is the lock.';

create index import_claims_batch_idx on data_center.import_claims (batch_id);


-- ===========================================================================
-- 2. What a batch and a row need to carry
-- ===========================================================================

alter table data_center.import_batches
  -- A receipt batch belongs to one partner: the stove has to be theirs, and
  -- create-sale scopes by organization anyway.
  add column organization_id uuid references public.organizations (id) on delete restrict,

  -- Filled by the dry run, so what-would-happen survives long enough to be read
  -- and discussed rather than only being a response body.
  add column dry_run_at      timestamptz,
  add column dry_run_summary jsonb,

  -- Committing is done in slices rather than in one request. This is where the
  -- next slice starts, so a run can be resumed after a failure without redoing
  -- work or skipping any.
  add column commit_cursor integer not null default 0,
  add column last_error    text;

comment on column data_center.import_batches.dry_run_summary is
  'What a commit would do, captured at the time it was asked. Counts by outcome, plus the stoves that would change hands.';

alter table data_center.import_rows
  -- The parsed and normalised payload, separate from `raw`. Keeping both means
  -- a rejected row can be shown as the operator typed it AND as the importer
  -- understood it, which is usually where the disagreement is.
  add column normalized jsonb,

  -- Distinct from rejection_reason: an exception is workable by a human, a
  -- rejection is not. Roughly 8% of real serials land here.
  add column exception_reason text,

  -- What the operator changed when they worked the exception, kept so a
  -- correction is never silently indistinguishable from the original.
  add column corrected_serial text;

comment on column data_center.import_rows.exception_reason is
  'Why a human needs to look at this row. The 8% that do not match stock are the normal path, not the error path.';

create index import_rows_exception_idx
  on data_center.import_rows (batch_id) where status = 'exception';


-- ===========================================================================
-- 3. Releasing a claim
--
-- A claim outlives its row only by accident: a function that died between
-- claiming and writing. Releasing is therefore something that happens on
-- rollback and on failure, and it is a function rather than inline SQL so both
-- paths cannot drift apart.
-- ===========================================================================

create or replace function data_center.release_import_claims(p_batch_id uuid)
returns integer
language plpgsql security definer set search_path = data_center, public as $$
declare
  released integer;
begin
  delete from data_center.import_claims where batch_id = p_batch_id;
  get diagnostics released = row_count;
  return released;
end;
$$;


-- ===========================================================================
-- 4. Runtime configuration
--
-- The slice size and the terms question below are settings rather than
-- constants, so changing them is an update rather than a deploy.
-- ===========================================================================

insert into data_center.workflow_config (key, value, description) values
  ('import.slice_size', '25'::jsonb,
   'Rows committed per invocation. Small enough that no single request runs long, large enough that a batch does not take all day.'),
  ('import.require_paper_agreement', 'true'::jsonb,
   'A digitalized receipt asserts the six terms were accepted on paper. create-sale requires all six and does not require a drawn signature, so the paper agreement is the evidence. Set false only if that stops being true.')
on conflict (key) do nothing;


-- ===========================================================================
-- 5. Audit
--
-- Deliberately NOT on import_rows. A batch is thousands of rows and logging
-- each one would bury the change log that exists to show what a person did.
-- The batch, which is what a person actually acts on, IS logged.
-- ===========================================================================

create trigger import_batches_log
  after insert or update or delete on data_center.import_batches
  for each row execute function data_center.log_change('id');

alter table data_center.import_claims enable row level security;
