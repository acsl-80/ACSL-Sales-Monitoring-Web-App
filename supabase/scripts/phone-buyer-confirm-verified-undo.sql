-- Undo phone-buyer-confirm-verified.sql: every row it confirmed gets back its
-- confirmed flag, note, updated_at and updated_by, from
-- data_center.shared_phones_confirm_backfill.
--
-- Rows the call centre has confirmed since are left alone: its confirm action
-- sets the row's source to call_centre, and those rows are skipped.
--
-- HOW: run this file. Its result row says how many rows were put back (expect
-- the confirm script's rows_confirmed). Rerun the analysis so the counts
-- follow. Then, once satisfied:
--   drop table data_center.shared_phones_confirm_backfill;

set local lock_timeout = '5s';

with restored as (
  update data_center.shared_phones sp
     set confirmed = b.confirmed_before,
         note = b.note_before,
         updated_at = b.updated_at_before,
         updated_by = b.updated_by_before
    from data_center.shared_phones_confirm_backfill b
   where sp.id = b.id
     and sp.confirmed is true
     and sp.source is distinct from 'call_centre'
     and sp.updated_at >= b.taken_at
  returning sp.id
)
select count(*) as rows_restored from restored;
