-- Phase 30, slice 2 (2026-09-16): a refused finish leaves a record. Decision D57.
--
-- The gap, found chasing a typist's report on 2026-09-15: stove 101114218 was
-- typed at the bench, the typist pressed Finish, and it stayed a draft. The
-- receipt carried every field it needed, its partner's one sales model, and a
-- part payment that model allows; an identical receipt for the same partner
-- finished two minutes earlier. Nothing could say what happened, because a
-- refused finish returns 400 and writes nothing at all. The row keeps whatever
-- the twenty-second autosave last left, which is indistinguishable from a
-- receipt nobody ever pressed Finish on.
--
-- So the question "why did this not finish" had no answer anywhere: not on the
-- row, not in the edge logs (which return only the last minute or two), and
-- not from the typist, who had moved on to the next receipt.
--
-- One column holds the last refusal: what was said, what to do about it, which
-- field it belongs to, when, and whose attempt it was. The bench shows it when
-- the stove is opened again, and it can be counted, so "which rule refuses the
-- most receipts" becomes a query rather than an afternoon.
--
-- Additive: one nullable column. Undo: drop it.

alter table data_center.import_rows
  add column if not exists finish_refusal jsonb;

comment on column data_center.import_rows.finish_refusal is
  'The last refusal of a Finish on this row (D57): {reason, hint, field, at, by}. Written when a finish is refused, cleared when one succeeds, untouched by a draft save. Null means the last finish attempt was accepted, or none has been made.';

-- Counting them is the point, and every read is "the newest refusals" or
-- "refusals by field", so the index carries the timestamp.
create index if not exists import_rows_finish_refusal_idx
  on data_center.import_rows ((finish_refusal ->> 'field'), (finish_refusal ->> 'at'))
  where finish_refusal is not null;

-- Readback: the column exists, nothing is recorded yet, and the bench rows
-- this will speak for are still where they were.
select 'column present' as what, count(*)::int as n
  from information_schema.columns
 where table_schema = 'data_center' and table_name = 'import_rows'
   and column_name = 'finish_refusal'
union all
select 'rows carrying a refusal', count(*)::int
  from data_center.import_rows where finish_refusal is not null
union all
select 'bench rows still drafting', count(*)::int
  from data_center.import_rows r join data_center.import_batches b on b.id = r.batch_id
 where b.source = 'workbench' and r.status = 'draft' and b.state <> 'rolled_back'
order by 1;
