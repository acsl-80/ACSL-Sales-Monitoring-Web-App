-- Phase 30, slice 1 (2026-09-15): the Data Center listens to the sales app.
-- Decisions D54 to D56.
--
-- The gap, as found on production: a purchase cancelled in the sales app at
-- 15:52 (TR-08C94F, 350 stoves) was gone from stock and from the transfer
-- history within the second, but the Data Center's Partner Records still
-- listed it four hours later. `data_center.transfer_funnel` is a copy of the
-- transfers with the counts already added up, kept so a page never aggregates
-- over sales. The copy is rebuilt by the full computation, which only a super
-- admin pressing Recompute starts, and the sweep that removes a vanished
-- transfer lives inside that rebuild. Between two rebuilds, thirteen surfaces
-- read the copy as if it were the truth.
--
-- The rule now: the app owns the transfers and the sales; the Data Center owns
-- what it derives from them, and keeps its derivations current by listening,
-- with triggers it owns, on the app's tables. The app's functions change not
-- at all. Undo is dropping the triggers.
--
--   D54  transfer events   a transfer row appearing, changing or disappearing
--                          in public.stove_transfer_history updates or removes
--                          its funnel row at once. The counts on that row are
--                          still the computation's, dated as before.
--   D56  sale events       a sale archived (cancel_sale, the stove archive)
--                          leaves every agent's list at once; a hard delete of
--                          a sale carrying call-centre work is refused, the way
--                          the module's own rollback already refuses it.
--
-- Costs, measured on production before writing this: the funnel view narrowed
-- to one transfer plans as an index walk over that transfer's serials (3 ms
-- for the largest transfer, 500 serials), so one row per event is cheap and
-- scales with the transfer, not with the sales table.

-- ===========================================================================
-- 1. One transfer's funnel row, from the same view the full refresh reads
-- ===========================================================================
create or replace function data_center.refresh_transfer_funnel(p_transfer_id uuid)
returns integer
language plpgsql security definer set search_path = data_center, public as $fn$
declare
  n integer := 0;
begin
  if not exists (select 1 from public.stove_transfer_history h where h.id = p_transfer_id) then
    delete from data_center.transfer_funnel t where t.transfer_id = p_transfer_id;
    return 0;
  end if;

  insert into data_center.transfer_funnel
    (transfer_id, transaction_id, organization_id, partner_name, partner_id,
     transfer_state, transfer_branch, sales_rep, sales_date, transfer_date,
     issued_count, received_count, received_is_logged, digitalised_count,
     verified_count, unverified_count, unreachable_count, unresolved_count,
     outstanding_count, computed_at)
  select
    f.transfer_id, f.transaction_id, f.organization_id, f.partner_name, f.partner_id,
    f.transfer_state, f.transfer_branch, f.sales_rep, f.sales_date, f.transfer_date,
    f.issued_count, f.received_count, f.received_is_logged, f.digitalised_count,
    f.verified_count, f.unverified_count, f.unreachable_count, f.unresolved_count,
    f.outstanding_count,
    -- The identity is current; the counts are as current as the last full
    -- pass, which is what the page's "computed" line describes. A single row
    -- must not claim a newer moment than the rows beside it.
    coalesce((select max(computed_at) from data_center.transfer_funnel), now())
  from data_center.v_transfer_funnel f
  where f.transfer_id = p_transfer_id
  on conflict (transfer_id) do update set
    transaction_id     = excluded.transaction_id,
    organization_id    = excluded.organization_id,
    partner_name       = excluded.partner_name,
    partner_id         = excluded.partner_id,
    transfer_state     = excluded.transfer_state,
    transfer_branch    = excluded.transfer_branch,
    sales_rep          = excluded.sales_rep,
    sales_date         = excluded.sales_date,
    transfer_date      = excluded.transfer_date,
    issued_count       = excluded.issued_count,
    received_count     = excluded.received_count,
    received_is_logged = excluded.received_is_logged,
    digitalised_count  = excluded.digitalised_count,
    verified_count     = excluded.verified_count,
    unverified_count   = excluded.unverified_count,
    unreachable_count  = excluded.unreachable_count,
    unresolved_count   = excluded.unresolved_count,
    outstanding_count  = excluded.outstanding_count;
  get diagnostics n = row_count;
  return n;
end;
$fn$;

comment on function data_center.refresh_transfer_funnel(uuid) is
  'One transfer''s funnel row, written from v_transfer_funnel, or removed when the transfer no longer exists (D54). The full refresh_transfer_funnel() stays the computation''s.';

-- ===========================================================================
-- 2. Transfer events: the trigger the Data Center owns on the app's table
-- ===========================================================================
create or replace function data_center.on_transfer_history_change()
returns trigger
language plpgsql security definer set search_path = data_center, public as $fn$
begin
  if tg_op = 'DELETE' then
    delete from data_center.transfer_funnel t where t.transfer_id = old.id;
    -- A cancelled purchase takes its unsold serials out of stock. A bench
    -- claim on one of them was a hold on a stove that no longer exists, and
    -- would block the serial if the partner is ever issued it again.
    delete from data_center.import_claims c
     where c.sale_id is null
       and c.stove_serial_no in (
             select upper(trim(e.value ->> 'stove_id'))
               from jsonb_array_elements(coalesce(old.stove_ids, '[]'::jsonb)) e)
       and not exists (select 1 from public.stove_ids_base sb
                        where upper(sb.stove_id) = c.stove_serial_no);
    return old;
  end if;
  perform data_center.refresh_transfer_funnel(new.id);
  return new;
end;
$fn$;

comment on function data_center.on_transfer_history_change() is
  'Keeps transfer_funnel''s membership current with public.stove_transfer_history (D54): a row on insert, refreshed on update, removed on delete, with the bench''s claims on the vanished serials released.';

drop trigger if exists dc_transfer_funnel_row on public.stove_transfer_history;
create trigger dc_transfer_funnel_row
  after insert or update or delete on public.stove_transfer_history
  for each row execute function data_center.on_transfer_history_change();

-- ===========================================================================
-- 3. Sale events: an archived sale leaves the agents; a worked sale is not
--    hard-deleted from under them
-- ===========================================================================

-- What the module calls work on a sale: a call logged, a verdict reached, or
-- a correction opened. Read by the delete guard below; the same question the
-- import's rollback asks before it will delete a batch's sales.
create or replace function data_center.sale_call_work(p_sale_id uuid)
returns jsonb
language sql stable security definer set search_path = data_center, public as $fn$
  select jsonb_build_object(
    'attempts', (select count(*) from data_center.call_attempts a where a.sale_id = p_sale_id),
    'verdict', (select cr.verification_outcome from data_center.call_records cr
                 where cr.sale_id = p_sale_id
                   and cr.verification_outcome is not null
                   and cr.verification_outcome <> 'not_verified'),
    'corrections', (select count(*) from data_center.corrections x where x.sale_id = p_sale_id));
$fn$;

create or replace function data_center.guard_sale_delete()
returns trigger
language plpgsql security definer set search_path = data_center, public as $fn$
declare
  w jsonb := data_center.sale_call_work(old.id);
  n_attempts integer := coalesce((w ->> 'attempts')::integer, 0);
  n_corrections integer := coalesce((w ->> 'corrections')::integer, 0);
  verdict text := w ->> 'verdict';
begin
  if n_attempts = 0 and n_corrections = 0 and verdict is null then
    return old;
  end if;
  raise exception using
    errcode = 'P0001',
    message = format(
      'This sale carries call-centre work (%s logged call%s%s%s). Cancel the sale instead of deleting it, so the record and its history stay.',
      n_attempts, case when n_attempts = 1 then '' else 's' end,
      case when verdict is not null then ', a verdict of ' || replace(verdict, '_', ' ') else '' end,
      case when n_corrections > 0 then format(', %s correction%s', n_corrections, case when n_corrections = 1 then '' else 's' end) else '' end),
    hint = 'data_center.guard_sale_delete';
end;
$fn$;

comment on function data_center.guard_sale_delete() is
  'Refuses a hard delete of a sale that carries call-centre work (D56). Deleting cascades the call record, its attempts and its corrections away; cancelling keeps them.';

drop trigger if exists dc_guard_sale_delete on public.sales;
create trigger dc_guard_sale_delete
  before delete on public.sales
  for each row execute function data_center.guard_sale_delete();

-- An archived sale is no longer anybody's call. Its active assignment items
-- are retired (not released: an archived sale is not callable), and the batch
-- closes if that was its last open record. The agent's list, the board and
-- the batch counts all read is_active, so they agree at once.
create or replace function data_center.on_sale_archived()
returns trigger
language plpgsql security definer set search_path = data_center, public as $fn$
begin
  update data_center.assignment_items i
     set is_active = false
   where i.sale_id = new.id
     and i.is_active;
  -- The closure rule asks for at least one active item, so a batch emptied by
  -- this archive is closed here: the agent finished everything left to them.
  update data_center.assignment_batches b
     set state = 'completed', completed_at = now(), updated_at = now()
   where b.state = 'open'
     and exists (select 1 from data_center.assignment_items i
                  where i.batch_id = b.id and i.sale_id = new.id)
     and not exists (select 1 from data_center.assignment_items i
                      where i.batch_id = b.id and i.is_active);
  perform data_center.complete_finished_batches(new.id);
  return new;
end;
$fn$;

comment on function data_center.on_sale_archived() is
  'When the sales app archives a sale (cancel_sale, the stove archive), its active assignment items are retired and its batch may close (D56).';

drop trigger if exists dc_sale_archived on public.sales;
create trigger dc_sale_archived
  after update of is_archived on public.sales
  for each row
  when (new.is_archived is true and old.is_archived is not true)
  execute function data_center.on_sale_archived();

-- ===========================================================================
-- 4. Catch up: what the triggers would have done had they been listening
-- ===========================================================================
-- Funnel rows whose transfer is gone (production: one, TR-08C94F).
delete from data_center.transfer_funnel t
 where not exists (select 1 from public.stove_transfer_history h where h.id = t.transfer_id);

-- Transfers the computation has not seen yet.
select count(data_center.refresh_transfer_funnel(h.id))
  from public.stove_transfer_history h
 where not exists (select 1 from data_center.transfer_funnel t where t.transfer_id = h.id);

-- Active items on sales already archived.
update data_center.assignment_items i
   set is_active = false
  from public.sales s
 where s.id = i.sale_id
   and i.is_active
   and s.is_archived is true;

select data_center.complete_finished_batches();

-- ===========================================================================
-- 5. Readback
-- ===========================================================================
select 'funnel rows' as what, count(*)::int as n from data_center.transfer_funnel
union all
select 'funnel rows without a transfer', count(*)::int
  from data_center.transfer_funnel t
 where not exists (select 1 from public.stove_transfer_history h where h.id = t.transfer_id)
union all
select 'transfers without a funnel row', count(*)::int
  from public.stove_transfer_history h
 where not exists (select 1 from data_center.transfer_funnel t where t.transfer_id = h.id)
union all
select 'active items on archived sales', count(*)::int
  from data_center.assignment_items i join public.sales s on s.id = i.sale_id
 where i.is_active and s.is_archived is true
union all
select 'triggers in place', count(*)::int
  from pg_trigger where tgname in ('dc_transfer_funnel_row', 'dc_guard_sale_delete', 'dc_sale_archived')
order by 1;
