-- Data Center: the single index this module adds to public.
--
-- The Data Center's Table 1 is keyset-paginated on (sales_date desc, id desc).
-- public.sales has nine indexes and not one covers sales_date, created_at,
-- phone or stove_serial_no. Invisible at the 38 rows in production today; the
-- difference between a list that loads and one that times out at the 500,000
-- this module is designed for.
--
-- The considered alternative was a denormalized mirror table inside data_center
-- fed by a trigger on public.sales. That is strictly MORE invasive, because a
-- trigger changes write behaviour on the sales app's busiest table where an
-- index does not. So this index is the lesser move, and the only place this
-- module touches public at all.
--
-- WHY THIS IS NOT `CONCURRENTLY`
--
-- The migration runner wraps every migration in a transaction, and
-- CREATE INDEX CONCURRENTLY is rejected inside one. A migration using it fails
-- the whole run, which on a Supabase preview branch means the branch never
-- builds. Found by merging this work onto the baseline and rebuilding.
--
-- A plain CREATE INDEX is correct here because every environment this runs in
-- is new: a fresh branch database, a local reset, a rebuilt environment. The
-- table is empty or tiny, so the write lock is instantaneous.
--
-- PRODUCTION IS DIFFERENT AND IS HANDLED SEPARATELY. There the table has real
-- rows and real traffic, so the index must be built without holding a write
-- lock. Run this first, by hand, outside any transaction:
--
--   supabase/manual/20260819_sales_queue_index_concurrently.sql
--
-- Once that has run, IF NOT EXISTS makes this migration a no-op on production,
-- so the two paths converge and neither blocks the other.
--
-- ROLLBACK
--   drop index if exists public.idx_sales_sales_date_id;

create index if not exists idx_sales_sales_date_id
  on public.sales (sales_date desc, id desc);

comment on index public.idx_sales_sales_date_id is
  'Keyset pagination cursor for the Data Center queue. Added by the data_center module; safe to drop if that module is removed.';
