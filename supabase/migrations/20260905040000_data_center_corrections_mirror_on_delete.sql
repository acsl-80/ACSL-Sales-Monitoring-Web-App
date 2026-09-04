-- ===========================================================================
-- The mirror follows a deleted episode too
-- ===========================================================================
--
-- sync_correction_mirror() ran on insert and update only. Delete an episode
-- (a spec's cleanup, an administrator undoing a mistaken send-back) and the
-- six columns on call_records kept saying "open" with nothing behind them, so
-- v_send_backs counted a ghost and the next open on that sale changed nothing
-- the banner could see. The trigger now runs on delete as well, recomputing
-- from whatever episodes remain and clearing the columns when none do.
--
-- Rollback: re-create the trigger from 20260905010000 (insert or update).
-- ===========================================================================

create or replace function data_center.sync_correction_mirror()
returns trigger
language plpgsql
as $$
declare
  the_sale uuid := coalesce(new.sale_id, old.sale_id);
  c data_center.corrections%rowtype;
begin
  select * into c
    from data_center.corrections
   where sale_id = the_sale
   order by seq desc
   limit 1;

  if not found then
    -- Nothing left: the record carries no request.
    update data_center.call_records cr
       set correction_requested_at = null,
           correction_requested_by = null,
           correction_reason_id    = null,
           correction_note         = null,
           correction_resolved_at  = null,
           correction_resolved_by  = null
     where cr.sale_id = the_sale
       and (cr.correction_requested_at is not null or cr.correction_resolved_at is not null);
    return coalesce(new, old);
  end if;

  insert into data_center.call_records (sale_id, created_by)
  values (the_sale, c.opened_by)
  on conflict (sale_id) do nothing;

  update data_center.call_records cr
     set correction_requested_at = c.opened_at,
         correction_requested_by = c.opened_by,
         correction_reason_id    = c.reason_id,
         correction_note         = c.note,
         correction_resolved_at  = case when c.state = 'resolved' then c.reviewed_at end,
         correction_resolved_by  = case when c.state = 'resolved' then c.reviewed_by end
   where cr.sale_id = the_sale
     and (cr.correction_requested_at is distinct from c.opened_at
       or cr.correction_requested_by is distinct from c.opened_by
       or cr.correction_reason_id    is distinct from c.reason_id
       or cr.correction_note         is distinct from c.note
       or cr.correction_resolved_at  is distinct from (case when c.state = 'resolved' then c.reviewed_at end)
       or cr.correction_resolved_by  is distinct from (case when c.state = 'resolved' then c.reviewed_by end));
  return coalesce(new, old);
end;
$$;

drop trigger if exists corrections_mirror on data_center.corrections;
create trigger corrections_mirror
  after insert or update or delete on data_center.corrections
  for each row execute function data_center.sync_correction_mirror();
