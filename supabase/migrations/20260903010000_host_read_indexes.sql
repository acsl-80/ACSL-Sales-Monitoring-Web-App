-- ===========================================================================
-- Read indexes for the host app's own filters.
--
-- Slice 1 of the 2026-09-02 review. The Data Center migrations gave
-- public.sales indexes on sales_date, created_by, state_backup and
-- organization_id; the host app filters on three more columns that have none,
-- and public.stove_ids_base, the host's most-read table, has no general index
-- on the column every host query filters by. Its only organisation index
-- (idx_stove_ids_unsold_age) is partial and covers unsold rows alone, so a
-- count of sold stoves per partner, which the dashboard and get-stove-ids both
-- do, scans the table.
--
-- Every index here is additive. Nothing reads differently; things read faster.
--
-- Sizes today: sales 4.8 MB (2,071 rows), stove_ids_base 8.7 MB (22,032 rows).
-- A plain CREATE INDEX on either holds a SHARE lock for milliseconds, during
-- which an insert from the sales or mobile app waits and then proceeds; none
-- fails. The CLI runs migrations inside a transaction, where CONCURRENTLY is
-- not allowed, so this file uses plain CREATE INDEX IF NOT EXISTS. If zero
-- write-blocking is wanted, run the CONCURRENTLY variants at the bottom by hand
-- in the SQL editor first; this migration then finds every index present and
-- changes nothing.
-- ===========================================================================

-- public.stove_ids_base ------------------------------------------------------

-- The host's most common question: this partner's stoves, by status.
-- get-stove-ids counts sold and available per organisation; the dashboards
-- count received and sold; the sale form lists a partner's available stoves.
create index if not exists idx_stove_ids_org_status
  on public.stove_ids_base (organization_id, status);

-- The stock to sales join. public.stove_ids (a view over this table) is joined
-- on sale_id by the sale-period views and by cancel and rollback paths.
create index if not exists idx_stove_ids_sale_id
  on public.stove_ids_base (sale_id)
  where sale_id is not null;

-- Stock received in a period, which the super-admin dashboard filters by.
create index if not exists idx_stove_ids_transfer_date
  on public.stove_ids_base (transfer_sales_date desc);

-- public.sales ---------------------------------------------------------------

-- The dashboards scope sales by partner name (an IN list of names), then by
-- date. Composite so the common "this partner, this period" needs one index.
create index if not exists idx_sales_partner_name_date
  on public.sales (partner_name, sales_date desc);

-- Branch scoping on the super-admin dashboard.
create index if not exists idx_sales_retailer_branch
  on public.sales (retailer_branch)
  where retailer_branch is not null;

-- Cancelled Transactions lists and orders by cancelled_at; almost every row
-- has none, so the index holds only the cancelled ones.
create index if not exists idx_sales_cancelled_at
  on public.sales (cancelled_at desc)
  where cancelled_at is not null;

-- ---------------------------------------------------------------------------
-- Optional: the same six, built without blocking writes. Run by hand, one at
-- a time, outside a transaction, BEFORE applying this migration. Each is
-- idempotent against the statements above.
--
-- create index concurrently if not exists idx_stove_ids_org_status
--   on public.stove_ids_base (organization_id, status);
-- create index concurrently if not exists idx_stove_ids_sale_id
--   on public.stove_ids_base (sale_id) where sale_id is not null;
-- create index concurrently if not exists idx_stove_ids_transfer_date
--   on public.stove_ids_base (transfer_sales_date desc);
-- create index concurrently if not exists idx_sales_partner_name_date
--   on public.sales (partner_name, sales_date desc);
-- create index concurrently if not exists idx_sales_retailer_branch
--   on public.sales (retailer_branch) where retailer_branch is not null;
-- create index concurrently if not exists idx_sales_cancelled_at
--   on public.sales (cancelled_at desc) where cancelled_at is not null;
-- ---------------------------------------------------------------------------
