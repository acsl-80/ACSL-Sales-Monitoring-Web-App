-- Phase 23: finding a stove's cancelled sales by serial.
--
-- The stove record resolves everything through `stove_ids_base.sale_id`, and
-- cancelling a sale releases the stove: the sale keeps its serial, the stock
-- row drops the link. Zero stock rows on production point at a cancelled sale.
-- So the only way back to a cancelled sale is the serial it still carries.
--
-- WHY A SECOND INDEX ON THE SAME EXPRESSION
--
-- `idx_sales_stove_serial_upper` already indexes `upper(trim(stove_serial_no))`,
-- and it looks like the one to use. It is not: it carries
-- `where is_archived is not true`, and a cancelled sale is archived, so the
-- rows this lookup wants are precisely the rows that index excludes. A partial
-- index is invisible to a query whose predicate the planner cannot prove sits
-- inside the partial condition, and here it provably does not.
--
-- Unqualified, so it covers both. It is redundant with the partial one for live
-- rows and slightly larger for it; that is the price of the archived half being
-- reachable at all. At 45 rows neither matters, and the module's own rule is to
-- index what queries filter on rather than wait for the table to teach us.
create index if not exists idx_sales_serial_upper_any
  on public.sales (upper(btrim(stove_serial_no)));

comment on index public.idx_sales_serial_upper_any is
  'Every sale ever recorded against a serial, archived and cancelled included, for the stove record''s history. Added by the data_center module; safe to drop if that module is removed.';
