-- Undo phone-buyer-kind-backfill.sql: every row it marked gets back the kind
-- it had, from data_center.shared_phones_kind_backfill.
--
-- A label only, as the backfill was: no sale moves in or out of the creditable
-- count. One caveat: a row that create-sale marked same_buyer after the
-- backfill ran was already same_buyer, so it is not in the snapshot and keeps
-- its mark. A row the backfill marked is put back even if a later sale would
-- also have marked it; the next sale on that number marks it again.
--
-- HOW: run this file. Its result row says how many rows were put back
-- (expect the backfill's rows_marked). Then, once you are satisfied, drop the
-- snapshot:
--   drop table data_center.shared_phones_kind_backfill;
-- Proof (expect 0):
--   select count(*) from data_center.shared_phones sp
--     join data_center.shared_phones_kind_backfill b on b.id = sp.id
--    where sp.kind is distinct from b.kind_before;

set local lock_timeout = '5s';

with restored as (
  update data_center.shared_phones sp
     set kind = b.kind_before
    from data_center.shared_phones_kind_backfill b
   where sp.id = b.id
     and sp.kind is distinct from b.kind_before
  returning sp.id
)
select count(*) as rows_restored from restored;
