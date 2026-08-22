-- ===========================================================================
-- Stove Records at half a million rows, and a stove page that stays one page
-- ===========================================================================
--
-- Two problems, one shape: a query that is correct today because the table is
-- small, and stops being correct the moment it is not.
--
-- 1. THE STOVE PAGE'S HISTORY
--
-- data_center.change_log is indexed on (table_name, changed_at desc). The
-- stove page asks for one record's history: table_name = 'call_records' AND
-- record_pk = <this sale>. Postgres can use that index for the first half of
-- the predicate only, so it walks every call_records audit row newest-first
-- and throws away the ones belonging to other sales until it has fifty.
--
-- With 38 sales that is instant. With 500,000 sales each carrying a handful of
-- edits, finding the three rows for a stove nobody has touched since March
-- means walking millions. The record is the key people look things up by, so
-- it belongs at the front of an index.
--
-- 2. FILTERING STOVE RECORDS
--
-- The table pages by (sales_date desc, id desc) and idx_sales_sales_date_id
-- serves that perfectly - while nothing is filtered. Add "partner = X" and the
-- planner still drives the date index, discarding every row that is not X
-- until it has a page. For a partner holding 2% of sales that is fifty times
-- the work, and for a state with a handful of buyers it is a table scan
-- wearing a limit.
--
-- The fix is the ordering columns *inside* the filtered index, so a filtered
-- page is the same indexed read an unfiltered one is.
--
-- COST
--
-- Three indexes on public.sales, the sales app's own hot table. Writes there
-- are a few sales a day against a table that already carries twelve indexes;
-- the marginal insert cost is not measurable. Reads are the entire point.
--
-- BUILT WITHOUT `CONCURRENTLY` HERE ON PURPOSE
--
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction, and the migration
-- runner wraps each file in one. At today's row count the lock is milliseconds.
-- Before this reaches a production table that matters, run the CONCURRENTLY
-- forms in supabase/manual/20260822_records_filter_indexes_concurrently.sql
-- first: they are `if not exists`, so this file then finds them built and does
-- nothing.

-- --------------------------------------------------------------- the history
create index if not exists change_log_record_idx
  on data_center.change_log (record_pk, changed_at desc, id desc);

comment on index data_center.change_log_record_idx is
  'One record''s history as an indexed read. The stove page and the settings log both ask by record_pk; table_name alone put the wrong column first.';

-- ------------------------------------------------------------- the filters
create index if not exists idx_sales_org_date_id
  on public.sales (organization_id, sales_date desc, id desc);

comment on index public.idx_sales_org_date_id is
  'Stove Records filtered to one partner, paged by the same keyset as everything else. Also serves the dashboard''s sales-by-partner drill.';

-- State first, LGA second: a prefix match serves "state = X" on its own, so
-- one index covers both questions rather than two covering one each.
create index if not exists idx_sales_state_lga_date_id
  on public.sales (state_backup, lga_backup, sales_date desc, id desc);

comment on index public.idx_sales_state_lga_date_id is
  'Stove Records filtered by where the buyer lives. State alone uses the leading column; state plus LGA uses both.';

create index if not exists idx_sales_created_by_date_id
  on public.sales (created_by, sales_date desc, id desc);

comment on index public.idx_sales_created_by_date_id is
  'Stove Records filtered to one sales agent. High cardinality, so without this a rare agent walks the whole date index.';
