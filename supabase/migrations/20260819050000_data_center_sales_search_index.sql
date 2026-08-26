-- Trigram search index for the Data Center's Table 1.
--
-- WHY THIS IS THE SECOND INDEX THIS MODULE ADDS TO public.sales
--
-- The design said the module would add exactly one index to public, on the
-- queue's sort key. That held for paging and for every filter, but not for
-- search. Measured against 500,000 seeded rows:
--
--   first page, keyset            2.7 ms
--   page 8,000, keyset            1.0 ms
--   filter by state and status     25 ms
--   search, ilike '%term%'      1,089 ms   <- parallel sequential scan
--
-- A second per keystroke is not a working search box, and it degrades as the
-- table grows. So the footprint widens from one index to two, deliberately,
-- with the number above as the reason. With this index the same search runs in
-- 10.9 ms, a hundredfold improvement, and the plan becomes a bitmap index scan.
--
-- WHY ONE EXPRESSION RATHER THAN SIX COLUMNS
--
-- Search spans six columns. Six separate trigram indexes would work through a
-- BitmapOr, but cost six indexes worth of writes on every sale. Indexing one
-- concatenation instead costs one. The query in
-- supabase/functions/data-center-read/records-query.ts repeats this expression
-- exactly, which is what lets the planner match it. Change one and the other
-- has to change with it, or search silently returns to a sequential scan.
--
-- REVERSIBILITY
--
-- drop index public.idx_sales_search_trgm;
--
-- Nothing else depends on it. The extension is left in place because other
-- things may come to rely on it.

create extension if not exists pg_trgm with schema extensions;

-- Plain rather than CONCURRENTLY: migrations run inside a transaction, and
-- CREATE INDEX CONCURRENTLY cannot. Production holds 38 sales, so this is
-- effectively instant there. If it is ever applied to a large table, use
-- supabase/manual/20260819_sales_search_trgm_concurrently.sql instead and mark
-- this migration as already applied.
create index if not exists idx_sales_search_trgm
  on public.sales using gin (
    (
      coalesce(end_user_name, '') || ' ' ||
      coalesce(contact_person, '') || ' ' ||
      coalesce(phone, '') || ' ' ||
      coalesce(contact_phone, '') || ' ' ||
      coalesce(stove_serial_no, '') || ' ' ||
      coalesce(transaction_id, '')
    ) extensions.gin_trgm_ops
  );

comment on index public.idx_sales_search_trgm is
  'Substring search for the Data Center records table. Added by the data_center module; safe to drop if that module is removed.';
