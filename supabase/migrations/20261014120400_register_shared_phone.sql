-- Phone number and buyer rule, Phase 4: every shared number reaches the
-- call centre's register, whichever door the sale came through.
--
-- Plan: docs/plans/phone-and-buyer-rule.md. Decision 1 (2026-10-15): a field
-- sale on a shared number is held from the creditable count until a call
-- confirms it, as a digitised one is. compute_analysis already holds any sale
-- with an unconfirmed row here, so registering is all it takes.
--
-- public.register_shared_phone(p_sale_id, p_same_buyer_ids, p_source, p_actor)
--   Called by create-sale and update-sale, as the server, after the reply has
--   gone. For the sale's current number:
--
--   1. The sale moved off another number: its unconfirmed rows there are
--      removed, and a number left with fewer than two live sales is no longer
--      shared, so its unconfirmed rows go too. Confirmed rows stay as history.
--   2. When two or more live sales are on the number, every one of them is on
--      the register (both ends, never half a sharing, as data-center-write's
--      confirm and the import already do). A new row is unconfirmed, so it is
--      held until a call. A row already there keeps its source, its confirmed
--      flag and its note.
--   3. kind is 'same_buyer' for the sales named in p_same_buyer_ids, otherwise
--      'shared_number'. A row already 'same_buyer' is never downgraded: the
--      call centre clears a repeat by confirming it, not by a later sale.
--
--   Server only: execute is granted to service_role alone.

set lock_timeout = '5s';

create or replace function public.register_shared_phone(
  p_sale_id uuid,
  p_same_buyer_ids uuid[] default '{}',
  p_source text default 'sales_app',
  p_actor uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public, data_center
as $$
declare
  v_tail text;
  v_old record;
  v_live integer;
  v_written integer := 0;
begin
  if p_source not in ('sales_app', 'digitalisation') then
    raise exception 'register_shared_phone: source % is not allowed', p_source;
  end if;

  select right(regexp_replace(coalesce(s.phone, ''), '[^0-9]', '', 'g'), 10)
    into v_tail
    from public.sales s
   where s.id = p_sale_id and s.is_archived is not true;
  if not found then
    return 0;
  end if;

  -- 1. Numbers this sale no longer holds.
  for v_old in
    select distinct sp.phone_tail
      from data_center.shared_phones sp
     where sp.sale_id = p_sale_id
       and sp.phone_tail is distinct from v_tail
  loop
    delete from data_center.shared_phones sp
     where sp.sale_id = p_sale_id
       and sp.phone_tail = v_old.phone_tail
       and sp.confirmed is false;

    select count(*) into v_live
      from public.sales s
     where s.is_archived is not true
       and right(regexp_replace(coalesce(s.phone, ''), '[^0-9]', '', 'g'), 10) = v_old.phone_tail;
    if v_live < 2 then
      delete from data_center.shared_phones sp
       where sp.phone_tail = v_old.phone_tail
         and sp.confirmed is false;
    end if;
  end loop;

  if v_tail !~ '^[0-9]{10}$' then
    return 0;
  end if;

  select count(*) into v_live
    from public.sales s
   where s.is_archived is not true
     and right(regexp_replace(coalesce(s.phone, ''), '[^0-9]', '', 'g'), 10) = v_tail;
  if v_live < 2 then
    return 0;
  end if;

  -- 2 and 3. Every live sale on the number, both ends.
  insert into data_center.shared_phones
         (phone_tail, sale_id, stove_id, phone_as_written, source, kind,
          created_by, updated_by)
  select v_tail, s.id, s.stove_serial_no, s.phone, p_source,
         case when s.id = any (coalesce(p_same_buyer_ids, '{}'::uuid[]))
              then 'same_buyer' else 'shared_number' end,
         p_actor, p_actor
    from public.sales s
   where s.is_archived is not true
     and right(regexp_replace(coalesce(s.phone, ''), '[^0-9]', '', 'g'), 10) = v_tail
  on conflict (phone_tail, sale_id) do update
     set kind = case when excluded.kind = 'same_buyer' then 'same_buyer'
                     else data_center.shared_phones.kind end,
         stove_id = excluded.stove_id,
         phone_as_written = excluded.phone_as_written,
         updated_at = now(),
         updated_by = coalesce(excluded.updated_by, data_center.shared_phones.updated_by);
  get diagnostics v_written = row_count;
  return v_written;
end;
$$;

comment on function public.register_shared_phone(uuid, uuid[], text, uuid) is
  'Puts every live sale on a sale''s phone number on data_center.shared_phones (both ends, unconfirmed when new, kind same_buyer for the named sales and never downgraded), and clears unconfirmed rows for a number the sale left. Server only. Phone and buyer rule, docs/plans/phone-and-buyer-rule.md.';

revoke all on function public.register_shared_phone(uuid, uuid[], text, uuid) from public, anon, authenticated;
grant execute on function public.register_shared_phone(uuid, uuid[], text, uuid) to service_role;

-- Proof it landed (expect: definer = true, authenticated = false, server = true):
--   select p.prosecdef as definer,
--          has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
--          has_function_privilege('service_role', p.oid, 'execute') as server
--     from pg_proc p where p.proname = 'register_shared_phone';
