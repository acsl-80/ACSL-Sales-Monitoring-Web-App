-- The CONCURRENTLY form of migration 20260819050000.
--
-- Run this by hand, outside a transaction, if the sales table has grown large
-- enough that a plain CREATE INDEX would hold a write lock for a noticeable
-- time. Production held 38 sales when the migration was written, so the plain
-- form was safe there; this file exists for the day that stops being true.
--
--   psql "$DATABASE_URL" -f supabase/manual/20260819_sales_search_trgm_concurrently.sql
--
-- Then mark the migration as applied so the plain version never runs:
--
--   supabase migration repair --status applied 20260819050000
--
-- AFTERWARDS, CHECK IT. A failed CONCURRENTLY build leaves an invalid index
-- behind that the planner ignores while writes still pay to maintain it:
--
--   select indisvalid from pg_index where indexrelid = 'public.idx_sales_search_trgm'::regclass;
--
-- If that returns false, drop the index and run this again.

create extension if not exists pg_trgm with schema extensions;

create index concurrently if not exists idx_sales_search_trgm
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
