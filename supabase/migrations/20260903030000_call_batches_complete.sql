-- ===========================================================================
-- Batches complete.
--
-- Slice 5 of the 2026-09-02 review (finding F16). assignment_batches.state
-- could become 'completed' in exactly one place: inside reassign, for a batch
-- emptied by that reassignment. Nothing closed a batch because its calls were
-- finished. So My Work listed finished work for ever, and capacity, which
-- counts OPEN batches against assignment.max_open_batches (1), treated an
-- agent who had finished as full: they were handed no more work. On
-- 2026-09-02 one agent sat in exactly that state, 18 of 18 concluded, batch
-- still open, nothing new arriving.
--
-- A batch is complete when every active item on it has a concluded call
-- record: fully verified, partially verified, or unreachable. A record still
-- not_verified after the callback limit keeps the batch open on purpose; the
-- agent marks it Unreachable, which is the conclusion for that case. Drafts
-- and open send-backs do not hold a batch open: a draft is unfinished typing,
-- and a send-back is Sales' queue, not the caller's.
--
-- The check runs at the end of touch_assignment_batch(), the trigger that
-- already fires on every call record write and every attempt, so every path
-- that can conclude a record can close its batch: the editor, the quick edit,
-- the call-sheet import. 'completed' is a state change only: items stay
-- active and history stays whole (only 'reclaimed' releases items), and the
-- scorecards, which count state <> 'reclaimed', keep counting.
--
-- max_open_batches stays where it is. Completion is what frees the seat.
--
-- Written for Orezi to run; the backfill at the end closes the batches
-- already finished today.
-- ===========================================================================

create or replace function data_center.complete_finished_batches(p_sale_id uuid default null)
returns integer
language plpgsql
as $$
declare
  _closed integer := 0;
begin
  with finished as (
    select b.id
      from data_center.assignment_batches b
     where b.state = 'open'
       and (p_sale_id is null
            or exists (select 1 from data_center.assignment_items i
                        where i.batch_id = b.id and i.sale_id = p_sale_id))
       and not exists (
             select 1
               from data_center.assignment_items i
               left join data_center.call_records cr on cr.sale_id = i.sale_id
              where i.batch_id = b.id
                and i.is_active
                and coalesce(cr.verification_outcome, 'not_verified')
                    not in ('fully_verified', 'partially_verified', 'unreachable'))
       and exists (select 1 from data_center.assignment_items i
                    where i.batch_id = b.id and i.is_active)
  )
  update data_center.assignment_batches b
     set state = 'completed', completed_at = now(), updated_at = now()
    from finished f
   where b.id = f.id;
  get diagnostics _closed = row_count;
  return _closed;
end;
$$;

comment on function data_center.complete_finished_batches(uuid) is
  'Closes every open batch whose active items are all concluded (verified, partly verified or unreachable). With a sale id, only the batches holding that sale. Returns how many closed.';

-- The touch trigger, with the completion check at its end. Same signature,
-- same triggers; only the body grows.
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
  perform data_center.complete_finished_batches(new.sale_id);
  return new;
end;
$$;

-- Backfill: the batches already finished before this existed.
select data_center.complete_finished_batches(null) as batches_closed_by_backfill;
