-- ===========================================================================
-- Cancelling a sale is one transaction.
--
-- Slice 3 of the 2026-09-02 review (finding F30). Until now the browser
-- cancelled a sale in two separate writes: first it released the stove
-- (stove_ids.sale_id = null, status = 'available'), then it archived the sale.
-- A failure between the two, a lost connection, a refused update, a closed
-- tab, left a released stove standing against a live sale, which is stock and
-- sales disagreeing, the one state every other part of this system works to
-- prevent. The first write's failure was only ever console.warn'ed.
--
-- This function does both inside one transaction with the same semantics the
-- browser applied: archive, stamp who and when and why, release the stove.
-- Either everything happens or nothing does.
--
-- WHO MAY CANCEL. A SECURITY DEFINER function bypasses row-level security, so
-- the rule the row policies on public.sales express today is carried here
-- word for word: a super admin; an admin, for a sale in their own
-- organisation; the person who created the sale. Nobody else. Reads are not
-- widened: the function returns only the ids it was given.
--
-- WHICH STOCK ROW. The browser matched the stove by serial alone. One serial
-- exists at two partners, so this matches the row this sale is linked to, or,
-- where the link was never written (older rows), the serial within the sale's
-- own organisation.
--
-- IDEMPOTENT. Cancelling an already cancelled sale changes nothing and says so.
--
-- Written for Orezi to run. Nothing here is executed by the agent.
-- ===========================================================================

create or replace function public.cancel_sale(_sale_id uuid, _reason text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  _uid uuid := auth.uid();
  _role text;
  _org uuid;
  _sale public.sales%rowtype;
  _released integer := 0;
begin
  if _uid is null then
    raise exception 'Not signed in';
  end if;

  select role, organization_id into _role, _org
    from public.profiles where id = _uid;

  select * into _sale from public.sales where id = _sale_id;
  if not found then
    raise exception 'Sale % not found', _sale_id;
  end if;

  -- The row policies, restated: super_admin_sales_access,
  -- admin_org_sales_management, users_own_sales.
  if not (
       _role = 'super_admin'
    or (_role = 'admin' and _org is not null and _sale.organization_id = _org)
    or _sale.created_by = _uid
  ) then
    raise exception 'Not permitted to cancel this sale';
  end if;

  if _sale.is_archived is true then
    return jsonb_build_object(
      'id', _sale.id, 'transaction_id', _sale.transaction_id,
      'already_cancelled', true, 'stove_released', false);
  end if;

  update public.sales
     set is_archived = true,
         cancelled_at = now(),
         cancelled_by = _uid,
         cancel_reason = nullif(btrim(coalesce(_reason, '')), '')
   where id = _sale_id;

  if _sale.stove_serial_no is not null then
    update public.stove_ids_base
       set sale_id = null, status = 'available'
     where stove_id = _sale.stove_serial_no
       and (sale_id = _sale_id
            or (sale_id is null and organization_id = _sale.organization_id));
    get diagnostics _released = row_count;
  end if;

  return jsonb_build_object(
    'id', _sale.id, 'transaction_id', _sale.transaction_id,
    'already_cancelled', false, 'stove_released', _released > 0);
end;
$function$;

comment on function public.cancel_sale(uuid, text) is
  'Archives a sale and releases its stove in one transaction, under the same rule as the sales row policies. Slice 3 of the 2026-09-02 review.';

-- Signed-in users call it; the function decides who may. Nothing anonymous.
revoke execute on function public.cancel_sale(uuid, text) from public, anon;
grant execute on function public.cancel_sale(uuid, text) to authenticated, service_role;
