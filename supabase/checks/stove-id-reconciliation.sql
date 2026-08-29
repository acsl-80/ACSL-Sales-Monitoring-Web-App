-- Stove ID reconciliation: making the transfer records agree with the stock.
--
-- Reviewed SQL, not a migration. It changes data rather than schema, and it is
-- meant to be read before it is run.
--
-- WHAT IS WRONG
--
-- Four faults, all measured against production rather than taken from the
-- report that first described them:
--
--   1,021 stock rows carry a sales_reference that matches no transfer record.
--         They share only 210 distinct references, so this is 210 missing
--         documents, not 1,021.
--       7 transfer records declare 82 stoves between them, list none, reference
--         no stock, and belong to no partner.
--       2 transaction IDs exist twice. Both are re-syncs rather than second
--         shipments, and both are losslessly resolvable.
--       1 stove exists as two stock rows at two different partners. NOT FIXED
--         HERE: it needs a person to say where the stove actually is.
--
-- WHAT THIS DOES NOT TOUCH
--
-- No sale, payment, end-user record or stock row is modified. Step 3 deletes
-- two transfer rows whose stoves are fully covered by the rows that remain.
-- Availability does not change, so what an agent can sell does not change.
--
-- HOW TO RUN IT
--
-- Read it. Then run it inside a transaction and check the verification block
-- at the end before committing:
--
--   BEGIN;
--   \i stove-id-reconciliation.sql
--   -- read the verification output
--   COMMIT;   -- or ROLLBACK;
--
-- Step 0 also writes snapshots, so an undo is possible after committing. See
-- stove-id-reconciliation-undo.sql.

-- ===========================================================================
-- 0. Snapshot first. Every later step is reversible from these.
-- ===========================================================================

create table if not exists public."recon_snapshot_transfers_20260829" as
  select * from public.stove_transfer_history;

create table if not exists public."recon_snapshot_stock_20260829" as
  select * from public.stove_ids_base;

revoke all on public."recon_snapshot_transfers_20260829" from "anon", "authenticated";
revoke all on public."recon_snapshot_stock_20260829"     from "anon", "authenticated";

-- ===========================================================================
-- 1. Rebuild the 210 missing transfer records
-- ===========================================================================
--
-- Every field comes from the stock rows that already carry the reference.
-- Nothing is invented: partner, factory, date and the stove list are all facts
-- already in the database, just never written into a transfer document.
--
-- GROUPED BY REFERENCE ALONE, DELIBERATELY.
--
-- The obvious grouping is (reference, organization, date, factory), which is
-- how the stock rows differ. But TR-BE5E3A carries seven stoves for one partner
-- and one factory under two different transfer dates, so that grouping would
-- mint two records sharing one transaction_id, which is precisely the fault
-- step 3 exists to remove. One record per reference, earliest date, whole stove
-- list. 210 references, minus any whose stoves are all documented elsewhere.

insert into public.stove_transfer_history (
  transaction_id, organization_id, partner_name, partner_id, state, branch,
  stove_count, stove_ids, source, application_name,
  transfer_date, sales_date, sales_factory, customer
)
select s.sales_reference,
       s.organization_id,
       coalesce(o.partner_name, 'Unknown partner'),
       coalesce(o.partner_id, 'UNKNOWN'),
       o.state,
       coalesce(o.branch, 'N/A'),
       count(*)::int,
       jsonb_agg(jsonb_build_object(
         'stove_id', s.stove_id,
         'factory', s.factory,
         'sales_reference', s.sales_reference
       ) order by s.stove_id),
       -- source is constrained to the two ERP sync values, and that is the
       -- honest one: this data did arrive by external-csv-sync, as stock rows.
       -- Only the transfer document was missing. The provenance marker goes in
       -- application_name, which is free text, so a rebuilt record is always
       -- identifiable without widening a constraint the ERP contract relies on.
       'external-csv-sync',
       'REBUILT 2026-08-29 by reconciliation: reconstructed from stock rows that referenced a transfer with no record',
       min(s.transfer_sales_date)::timestamptz,
       min(s.transfer_sales_date),
       min(s.factory),
       coalesce(o.partner_name, 'Unknown partner')
  from public.stove_ids_base s
  left join public.organizations o on o.id = s.organization_id
 where s.sales_reference is not null
   and not exists (select 1 from public.stove_transfer_history h
                    where h.transaction_id = s.sales_reference)
   /*
    * Skip stoves an existing transfer already documents.
    *
    * Found by simulating this: two stoves have a stock row pointing at an
    * orphaned reference while a DIFFERENT, existing transfer already lists
    * them. Rebuilding the orphan would put those stoves on two transfer
    * documents, which is the fault step 3 removes, reintroduced by step 1.
    *
    * The rebuild exists to document stoves no transfer documents. If one
    * already does, nothing is missing, so there is nothing to write. 101083050
    * is documented by TRF-MP5GTAKG-6DNE at the same partner; 101090182 by
    * TR-0516CD. Both stay on exactly one transfer.
    */
   and not exists (select 1 from data_center.v_transfer_stoves ts
                    where ts.stove_id = upper(btrim(s.stove_id)))
 group by s.sales_reference, s.organization_id, o.partner_name, o.partner_id, o.state, o.branch;

-- ===========================================================================
-- 2. The seven phantom migration batches
-- ===========================================================================
--
-- All seven are TRF-MIG-* rows written by external-csv-sync. Each declares a
-- quantity, lists no stove IDs, is referenced by no stock row, and has no
-- partner attached. There is nothing to attach them to, so the declared count
-- is the only thing making 82 stoves appear to exist.
--
-- Zeroed rather than deleted: the rows are evidence that a migration ran, and
-- the marker says not to trust their counts.

update public.stove_transfer_history
   set stove_count = 0,
       application_name = coalesce(application_name, '') ||
         ' [unverified legacy: declared ' || stove_count::text ||
         ' stoves, listed none, referenced by no stock. Zeroed 2026-08-29.]'
 where coalesce(jsonb_array_length(stove_ids), 0) = 0
   and coalesce(stove_count, 0) > 0
   and organization_id is null
   and not exists (select 1 from public.stove_ids_base s
                    where s.sales_reference = stove_transfer_history.transaction_id);

-- ===========================================================================
-- 3. The two duplicated transaction IDs
-- ===========================================================================
--
-- TR-5002C4: the later row lists 101086222 only, a strict subset of the
--            earlier row's 101086222 and 101090361. A partial re-sync.
-- TR-95B71D: both rows list 101084885, three and a half minutes apart, and the
--            first has no partner attached at all.
--
-- In both cases one row's stoves are wholly contained in the other's, so
-- deleting it loses no stove. Keep the row with the partner and the longer
-- list; delete the other.
--
-- This is what caused the stock-ageing bug fixed in #11: a join on a
-- transaction_id that is not unique fans out and counts stoves twice.

delete from public.stove_transfer_history h
 where h.id in (
   select id from (
     select h2.id,
            row_number() over (
              partition by h2.transaction_id
              order by (h2.organization_id is not null) desc,
                       coalesce(jsonb_array_length(h2.stove_ids), 0) desc,
                       h2.created_at asc
            ) as keep_rank
       from public.stove_transfer_history h2
      where h2.transaction_id in (
              select transaction_id from public.stove_transfer_history
               group by transaction_id having count(*) > 1)
   ) ranked
    where keep_rank > 1
 );

-- ===========================================================================
-- 3b. Existing transfers that list fewer stoves than reference them
-- ===========================================================================
--
-- A fault class the original report does not name, found by simulating this
-- script and asking why one stove was still undocumented afterwards.
--
-- TR-0516CD exists, declares 1 and lists 1, but TWO stock rows carry its
-- reference. So stove 101008154 is in stock, assigned to OYO STATE HIGH COURT,
-- pointing at a real transfer that does not mention it. Step 1 cannot help:
-- it only rebuilds references with no record at all.
--
-- The stock row is the evidence. The transfer document is what is incomplete,
-- so the missing stoves are appended and the count recomputed from the list.
--
-- Runs AFTER step 3 on purpose. Before it, TR-5002C4's duplicate row also
-- looks like an under-lister, and topping that up would write stoves into a
-- row about to be deleted.

with missing as (
  select h.id as transfer_id,
         jsonb_agg(jsonb_build_object(
           'stove_id', s.stove_id,
           'factory', s.factory,
           'sales_reference', s.sales_reference
         ) order by s.stove_id) as extra
    from public.stove_transfer_history h
    join public.stove_ids_base s on s.sales_reference = h.transaction_id
   where not exists (
           select 1 from jsonb_array_elements(coalesce(h.stove_ids, '[]'::jsonb)) e
            where upper(btrim(e.value ->> 'stove_id')) = upper(btrim(s.stove_id)))
     /*
      * The same guard step 1 needs, for the same reason.
      *
      * Stove 101090182 has two stock rows at two partners. Its second row
      * references TR-47EC4F, which step 1 rebuilds, so without this the top-up
      * would add it there while TR-0516CD already lists it, putting one stove
      * on two documents. Only stoves no transfer documents get appended.
      */
     and not exists (
           select 1 from data_center.v_transfer_stoves ts
            where ts.stove_id = upper(btrim(s.stove_id)))
   group by h.id
)
update public.stove_transfer_history h
   set stove_ids = coalesce(h.stove_ids, '[]'::jsonb) || m.extra,
       stove_count = jsonb_array_length(coalesce(h.stove_ids, '[]'::jsonb) || m.extra),
       application_name = coalesce(h.application_name, '') ||
         ' [topped up 2026-08-29: ' || jsonb_array_length(m.extra)::text ||
         ' stove(s) in stock referenced this transfer but were not listed]'
  from missing m
 where m.transfer_id = h.id;

-- ===========================================================================
-- 4. Verification. Read this before committing.
-- ===========================================================================

-- The question that matters is whether a stove is documented at all, not
-- whether the particular reference on its stock row resolves. One stock row
-- (101083050, reference TR-A216A7) keeps a stale reference on purpose: the
-- stove is documented by TRF-MP5GTAKG-6DNE at the same partner, so creating a
-- second document for it would be the fault, not the fix. Repointing the stock
-- row would be the tidier answer and is deliberately not done here, because it
-- edits stock and this script does not.
select 'stock stoves documented by NO transfer' as check,
       count(*)::text as value, '0' as expected
  from public.stove_ids_base s
 where s.sales_reference is not null
   and not exists (select 1 from data_center.v_transfer_stoves ts
                    where ts.stove_id = upper(btrim(s.stove_id)))
union all
select 'stock rows with a stale reference (documented elsewhere)',
       count(*)::text, '1'
  from public.stove_ids_base s
 where s.sales_reference is not null
   and not exists (select 1 from public.stove_transfer_history h
                    where h.transaction_id = s.sales_reference)
union all
select 'transfers declaring stoves but listing none',
       count(*)::text, '0'
  from public.stove_transfer_history
 where coalesce(jsonb_array_length(stove_ids), 0) = 0 and coalesce(stove_count, 0) > 0
union all
select 'duplicate transaction IDs',
       count(*)::text, '0'
  from (select transaction_id from public.stove_transfer_history
         group by transaction_id having count(*) > 1) d
union all
select 'stove IDs listed on more than one transfer',
       count(*)::text, '0'
  from (select stove_id from data_center.v_transfer_stoves
         group by stove_id having count(*) > 1) x
union all
select 'transfer records (was 543)',
       count(*)::text, '~751'
  from public.stove_transfer_history
union all
select 'declared total now equals listed total',
       case when (select coalesce(sum(stove_count),0) from public.stove_transfer_history)
               = (select count(*) from data_center.v_transfer_stoves)
            then 'yes' else 'no' end, 'yes'
union all
-- Nothing about stock may have moved. This is the safety check that matters.
select 'stock rows (must be unchanged at 18,714)',
       count(*)::text, '18714'
  from public.stove_ids_base
union all
select 'sold stock rows (must be unchanged)',
       count(*)::text, 'unchanged'
  from public.stove_ids_base where status = 'sold'
union all
select 'live sales (must be unchanged)',
       count(*)::text, 'unchanged'
  from public.sales where is_archived is not true;
