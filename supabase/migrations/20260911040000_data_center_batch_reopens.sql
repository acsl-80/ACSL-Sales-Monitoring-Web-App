-- Phase 28, slice 6 (2026-09-11): a reopened verdict reopens its batch.
-- Decision D52.
--
-- A batch closes itself when its last active record is concluded (verified,
-- partly verified or unreachable). If somebody then edits one of those
-- records back to not verified, the record was neither callable (its item is
-- still active) nor closable (the batch stayed completed), and the board and
-- the capacity rule did not count it as work in hand. Since slice 5 the
-- record still shows on its agent's page (D50), so the missing half is the
-- batch: it comes back to open the moment one of its records is no longer
-- concluded, and closes again through the same rule when it is.
--
-- The touch trigger already runs on every call_records insert or update and
-- ends by asking complete_finished_batches; this gives it the other
-- direction. Additive: one function body, then a backfill of the batches
-- already in that state. Undo: re-run the 20260903030000 definition.

create or replace function data_center.touch_assignment_batch()
returns trigger
language plpgsql
as $$
begin
  update data_center.assignment_batches b
     set last_activity_at = now()
    from data_center.assignment_items i
   where i.batch_id = b.id
     and i.sale_id = new.sale_id
     and i.is_active
     and b.state = 'open';

  -- D52: a record that is no longer concluded reopens the completed batch
  -- that holds it. Only a call_records row carries a verdict, so the check
  -- is nested under the table test rather than joined to it.
  if tg_table_name = 'call_records' then
    if coalesce(new.verification_outcome, 'not_verified')
       not in ('fully_verified', 'partially_verified', 'unreachable') then
      update data_center.assignment_batches b
         set state = 'open',
             completed_at = null,
             last_activity_at = now(),
             updated_at = now()
        from data_center.assignment_items i
       where i.batch_id = b.id
         and i.sale_id = new.sale_id
         and i.is_active
         and b.state = 'completed';
    end if;
  end if;

  perform data_center.complete_finished_batches(new.sale_id);
  return new;
end;
$$;

comment on function data_center.touch_assignment_batch() is
  'Marks the open batch holding a record as active on every call or record change, reopens a completed batch when one of its records is no longer concluded (D52), then asks complete_finished_batches whether the batch is finished.';

-- Backfill: batches that closed and were later given an unfinished record.
update data_center.assignment_batches b
   set state = 'open', completed_at = null, updated_at = now()
 where b.state = 'completed'
   and exists (
     select 1
       from data_center.assignment_items i
       left join data_center.call_records cr on cr.sale_id = i.sale_id
      where i.batch_id = b.id
        and i.is_active
        and coalesce(cr.verification_outcome, 'not_verified')
            not in ('fully_verified', 'partially_verified', 'unreachable'));

-- Readback: no completed batch holds an unfinished record, and the trigger
-- carries its new comment.
select
  (select count(*) from data_center.assignment_batches b
    where b.state = 'completed'
      and exists (select 1 from data_center.assignment_items i
                    left join data_center.call_records cr on cr.sale_id = i.sale_id
                   where i.batch_id = b.id and i.is_active
                     and coalesce(cr.verification_outcome, 'not_verified')
                         not in ('fully_verified', 'partially_verified', 'unreachable'))) as completed_holding_unfinished,
  (select obj_description('data_center.touch_assignment_batch()'::regprocedure) like '%D52%') as trigger_rewritten;
