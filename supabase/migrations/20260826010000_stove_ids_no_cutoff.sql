-- Remove the 2026 cutoff from public.stove_ids.
--
-- The view carried `where transfer_sales_date is null or transfer_sales_date
-- >= '2026-01-01'`. It arrived with the baseline schema, has no comment, no
-- migration explaining it, and nobody recorded why that date.
--
-- WHAT IT WAS ACTUALLY DOING
--
-- Hiding 204 stoves, dated February to December 2025, spread across 16
-- partners. Every one of them `available`, none sold, none archived, none
-- attached to a live sale. Real, unsold stock.
--
-- And not merely hidden. `create-sale` claims stock THROUGH this view, so
-- those 16 partners could not sell that stock through the app at all: the
-- serial simply did not exist as far as the sale path was concerned. The sync
-- also inserts and updates through the view, and an update can only reach rows
-- the view returns - so once a pre-2026 row was written it could never be
-- corrected by the ERP again.
--
-- The instruction is to see what is happening: everything behind us is tracked
-- and displayed, and the guard belongs on entry instead, where a future-dated
-- sale is refused by create-sale rather than a real historical one being
-- silently dropped from every count.
--
-- WHAT THIS CHANGES, DELIBERATELY
--
-- Every consumer of public.stove_ids gains those 204 rows: the main dashboard's
-- "Total Stoves Received By Partner(s)", the partner and agent pages, the
-- stock counts in get-stove-stats and get-agent-stove-ids, and - the point of
-- the change - the stock create-sale is willing to sell. PostgREST exposes the
-- view, so the Flutter app sees them too, which is the intent rather than a
-- side effect.
--
-- The column list and its order are unchanged, so dependent objects and every
-- `select *` against the view keep working.

create or replace view public.stove_ids as
  select id,
         stove_id,
         organization_id,
         status,
         created_at,
         sale_id,
         factory,
         is_archived,
         archive_note,
         sales_reference,
         transfer_sales_date
    from public.stove_ids_base;

comment on view public.stove_ids is
  'Every stove ever transferred to a partner. Carried a 2026-01-01 cutoff until 2026-08-26, which hid 204 real unsold stoves across 16 partners and made them unsellable, because create-sale claims stock through this view. Future-dated entry is refused in create-sale instead.';
