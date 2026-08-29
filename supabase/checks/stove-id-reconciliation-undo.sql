-- Undo the stove ID reconciliation.
--
-- Restores public.stove_transfer_history to exactly what the snapshot taken in
-- step 0 of stove-id-reconciliation.sql holds. Only that table is touched,
-- because only that table was changed: no stock row, sale, payment or end-user
-- record is modified by the reconciliation or by this.
--
-- Surgical rather than a truncate-and-reload. Other things reference this table
-- by transaction_id, and a truncate would briefly empty it for anything reading
-- concurrently on a live system.
--
--   BEGIN;
--   \i stove-id-reconciliation-undo.sql
--   -- read the verification block
--   COMMIT;   -- or ROLLBACK;
--
-- Safe to run more than once.

-- Refuse to run without the snapshot, rather than half-undoing.
do $$
begin
  if not exists (
    select 1 from information_schema.tables
     where table_schema = 'public' and table_name = 'recon_snapshot_transfers_20260829'
  ) then
    raise exception 'No snapshot table. Nothing to restore from, so nothing is safe to undo.';
  end if;
end $$;

-- 1. Remove rows the reconciliation created. Identified by absence from the
--    snapshot rather than by the marker text, so an edited marker cannot make
--    a row invisible to the undo.
delete from public.stove_transfer_history h
 where not exists (select 1 from public."recon_snapshot_transfers_20260829" s
                    where s.id = h.id);

-- 2. Put back rows the reconciliation deleted (the duplicate transaction IDs).
insert into public.stove_transfer_history
select s.* from public."recon_snapshot_transfers_20260829" s
 where not exists (select 1 from public.stove_transfer_history h where h.id = s.id);

-- 3. Restore every column the reconciliation edited: the zeroed counts, the
--    topped-up stove lists, and the appended markers.
update public.stove_transfer_history h
   set stove_count = s.stove_count,
       stove_ids = s.stove_ids,
       application_name = s.application_name
  from public."recon_snapshot_transfers_20260829" s
 where s.id = h.id
   and (h.stove_count is distinct from s.stove_count
     or h.stove_ids is distinct from s.stove_ids
     or h.application_name is distinct from s.application_name);

-- 4. Verification. All three must be zero before committing.
select 'rows present now but not in the snapshot' as check, count(*)::text as value, '0' as expected
  from public.stove_transfer_history h
 where not exists (select 1 from public."recon_snapshot_transfers_20260829" s where s.id = h.id)
union all
select 'rows in the snapshot but missing now', count(*)::text, '0'
  from public."recon_snapshot_transfers_20260829" s
 where not exists (select 1 from public.stove_transfer_history h where h.id = s.id)
union all
select 'rows differing from the snapshot', count(*)::text, '0'
  from public.stove_transfer_history h
  join public."recon_snapshot_transfers_20260829" s on s.id = h.id
 where h.stove_count is distinct from s.stove_count
    or h.stove_ids is distinct from s.stove_ids
    or h.application_name is distinct from s.application_name;
