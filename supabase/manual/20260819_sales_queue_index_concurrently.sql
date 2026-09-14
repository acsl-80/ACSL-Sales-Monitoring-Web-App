-- Data Center: the single index this module adds to public.
--
-- ###########################################################################
-- ## THIS MIGRATION MUST NOT RUN INSIDE A TRANSACTION.                     ##
-- ## CREATE INDEX CONCURRENTLY is rejected inside one. The Supabase CLI    ##
-- ## wraps migrations in a transaction by default, so apply this file by   ##
-- ## hand (SQL editor or psql), not via `supabase db push`.                ##
-- ###########################################################################
--
-- WHY THIS EXISTS
--
-- The Data Center's Table 1 is a keyset-paginated list ordered by
-- (sales_date desc, id desc). public.sales currently has nine indexes and not
-- one of them covers sales_date, created_at, phone or stove_serial_no. At the
-- 38 rows in production today that is invisible. At the 500,000 this module is
-- designed for it is the difference between a list that loads and one that
-- times out.
--
-- WHY AN INDEX AND NOT SOMETHING LESS INVASIVE
--
-- The considered alternative was a denormalized mirror table inside
-- data_center, kept current by a trigger on public.sales. That is strictly MORE
-- invasive: a trigger changes write behaviour on the sales app's busiest table,
-- where an index does not. So the index is the lesser move, and it is the only
-- place this module touches public at all.
--
-- WHY CONCURRENTLY
--
-- Builds without taking a write lock, so the live Sell Stove path keeps working
-- throughout. The cost is that a failure leaves an INVALID index behind rather
-- than rolling back, which is why the verification step below is not optional.
--
-- ROLLBACK
--   drop index concurrently if exists public.idx_sales_sales_date_id;

create index concurrently if not exists idx_sales_sales_date_id
  on public.sales (sales_date desc, id desc);

comment on index public.idx_sales_sales_date_id is
  'Keyset pagination cursor for the Data Center queue. Added by the data_center module; safe to drop if that module is removed.';

-- VERIFY IMMEDIATELY AFTER RUNNING. A CONCURRENTLY build that fails leaves an
-- invalid index in place, which is dead weight that also blocks a rebuild:
--
--   select i.indisvalid, c.relname
--   from pg_index i join pg_class c on c.oid = i.indexrelid
--   where c.relname = 'idx_sales_sales_date_id';
--
-- indisvalid must be true. If it is false:
--   drop index concurrently public.idx_sales_sales_date_id;
-- then investigate before retrying.
