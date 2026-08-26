-- Phase 8b: making the import hard to get wrong.
--
-- The import worked. What it did not do was notice things: that a file had
-- already been uploaded, that a serial appeared twice inside it, that a column
-- header it did not recognise was quietly ignored, or which transfer a record
-- belonged to.
--
-- Each of those fails silently, which is the worst way for an import to fail.
-- A rejected row is visible; a row that imported against nothing, or imported
-- twice, is not.

-- ===========================================================================
-- 1. Which transfer a record belongs to
--
-- The link that §1.2 asks for. Set during validate, from the same chain the
-- funnel uses, so a record and the funnel can never disagree about its parent.
--
-- Nullable on purpose. A record whose serial matches no transfer is an
-- exception a human works, not a row to refuse: roughly one serial in twelve
-- misses in a real workbook.
-- ===========================================================================

alter table data_center.import_rows
  add column transaction_id text,
  -- Set when the same serial appears more than once in one file. The first
  -- occurrence stays valid; the rest say which row they duplicate.
  add column duplicate_of_row integer;

comment on column data_center.import_rows.transaction_id is
  'The transfer this record belongs to, resolved during validate. Null means no transfer matched, which is an exception rather than a rejection.';

create index import_rows_transaction_idx
  on data_center.import_rows (transaction_id) where transaction_id is not null;


-- ===========================================================================
-- 2. Noticing the same file twice
--
-- Uploading the same spreadsheet again is an ordinary mistake: two people
-- clear the same envelope, or someone is not sure the first attempt worked.
-- Today it produces a second batch that commits a second set of sales, and the
-- stove claim is the only thing that stops it, which turns a mistake into a
-- queue of exceptions rather than a warning.
--
-- The hash is over the parsed rows, not the file, so re-saving a spreadsheet
-- without changing its contents still matches.
-- ===========================================================================

alter table data_center.import_batches
  add column content_hash text,
  -- What the operator mapped each unrecognised header to. Kept so a batch can
  -- be explained months later, when nobody remembers what "Col 7" was.
  add column column_mapping jsonb,
  add column source_note text;

comment on column data_center.import_batches.content_hash is
  'SHA-256 of the parsed rows. Two batches with the same hash are the same file, uploaded twice.';

create index import_batches_hash_idx
  on data_center.import_batches (content_hash) where content_hash is not null;


-- ===========================================================================
-- 3. Where a record came from
--
-- Three channels, and the funnel needs to tell them apart: a receipt typed
-- from paper is a different fact from a station entering its own sale, even
-- though both end as a row in public.sales.
--
-- `manual` is the new one. It is the same validator and the same exceptions
-- queue as a file, because a clerk typing one record makes the same mistakes as
-- a clerk typing two hundred, and a second code path would drift.
-- ===========================================================================

alter table data_center.import_batches
  drop constraint if exists import_batches_source_check;

alter table data_center.import_batches
  add constraint import_batches_source_check
  check (source in ('receipt', 'call_center', 'manual', 'field'));


insert into data_center.workflow_config (key, value, description) values
  ('import.max_rows', '20000'::jsonb,
   'Rows accepted in one file. Stated in the UI before an upload rather than discovered after it.'),
  ('import.warn_on_duplicate_upload', 'true'::jsonb,
   'Warn when a file with identical contents has been staged before. Never blocks: a partner can legitimately return the same serials after a correction.')
on conflict (key) do nothing;
