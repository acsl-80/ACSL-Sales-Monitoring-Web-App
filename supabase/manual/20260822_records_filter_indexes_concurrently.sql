-- Data Center: the indexes that keep Stove Records fast once it is full.
--
-- ###########################################################################
-- ## THIS MIGRATION MUST NOT RUN INSIDE A TRANSACTION.                     ##
-- ## CREATE INDEX CONCURRENTLY is rejected inside one. The Supabase CLI    ##
-- ## wraps migrations in a transaction by default, so apply this file by   ##
-- ## hand (SQL editor or psql), not via `supabase db push`.                ##
-- ###########################################################################
--
-- WHY THIS EXISTS SEPARATELY
--
-- Everything here is also in migration
-- 20260822010000_data_center_records_filters_and_scale.sql, without
-- CONCURRENTLY, so a fresh database and the preview branch build them without
-- a second step. Run THIS file first on any database where public.sales is
-- being written to while you work: a plain CREATE INDEX takes a lock that
-- blocks every insert for the duration of the build, and public.sales is the
-- sales app's own table. The migration's statements are `if not exists`, so
-- once these have built it finds them and does nothing.
--
-- WHAT EACH ONE IS FOR
--
-- The records table pages by (sales_date desc, id desc) and never by offset.
-- idx_sales_sales_date_id serves that while nothing is filtered. Add a filter
-- and the planner still drives the date index, discarding non-matching rows
-- until it has a page - which is fifty times the work for a partner holding
-- 2% of sales, and a table scan for a state with a handful of buyers.
--
-- Putting the filter column first and the paging columns after it makes a
-- filtered page exactly the same indexed read an unfiltered one is.
--
-- Run each statement on its own. If one fails, the others are unaffected.

create index concurrently if not exists idx_sales_org_date_id
  on public.sales (organization_id, sales_date desc, id desc);

-- State first, LGA second: a prefix match serves "state = X" on its own, so
-- one index answers both questions rather than two answering one each.
create index concurrently if not exists idx_sales_state_lga_date_id
  on public.sales (state_backup, lga_backup, sales_date desc, id desc);

create index concurrently if not exists idx_sales_created_by_date_id
  on public.sales (created_by, sales_date desc, id desc);

-- One record's audit history, found by the record rather than by its table.
-- data_center.change_log is written by trigger on every edit and read by the
-- stove page and the settings log; both ask by record_pk.
create index concurrently if not exists change_log_record_idx
  on data_center.change_log (record_pk, changed_at desc, id desc);

-- Afterwards, confirm the planner is using them:
--
--   explain (analyze, buffers)
--   select s.id, s.sales_date from public.sales s
--    where s.organization_id = '<a partner>' and s.is_archived is not true
--    order by s.sales_date desc, s.id desc limit 51;
--
-- Expect an Index Scan on idx_sales_org_date_id with no Sort node. A Sort in
-- the plan means the ordering is not coming from the index and the query is
-- reading far more than the page it returns.
