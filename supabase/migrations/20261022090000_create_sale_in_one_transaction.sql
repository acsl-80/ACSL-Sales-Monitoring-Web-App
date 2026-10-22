-- ===========================================================================
-- Saving a sale is one transaction.
--
-- create-sale used to write a sale in four separate requests: the buyer's
-- address, the sale, the claim on the stove, and the first instalment. Each
-- committed on its own. A failure between them left part of a sale behind:
-- an address no sale points to, or a sale whose first payment was never
-- recorded while its total_paid said it was (that failure was only logged,
-- and the caller was told the sale saved). A claim lost to another seller was
-- undone by a second delete, which could itself fail.
--
-- create_sale_tx does all four inside one transaction. Either the address,
-- the sale, the claimed stove and the payment all exist afterwards, or none
-- of them does.
--
-- WHAT IT WRITES. Exactly what create-sale wrote before, the same way the
-- REST API writes a row: only the keys present in each JSON object become
-- columns, so a column left out keeps its default and every trigger on sales
-- (name parts, status, history) sees the same row as before. A key that is
-- not a column is refused rather than dropped, so a typo in the caller fails
-- loudly.
--
-- THE CLAIM. The stove is claimed with the same filter as before (serial,
-- organisation, status not sold). When another sale claimed it first, the
-- function raises SQLSTATE 'SC409' and everything it wrote is rolled back;
-- create-sale answers that with its existing 409.
--
-- WHICH STEP FAILED. Any other error is re-raised with its own SQLSTATE and
-- message, and a hint naming the step ('address', 'sale', 'claim',
-- 'payment'), which create-sale turns into its existing messages.
--
-- WHO MAY CALL IT. The service role only. create-sale has authenticated the
-- caller and resolved the organisation before it calls, and sets created_by
-- and recorded_by from that caller.
--
-- Written for Orezi to run. Nothing here is executed by the agent.
--
-- CHECK: supabase/scripts/20261022-create-sale-tx-check.sql
-- UNDO:  supabase/scripts/20261022-create-sale-tx-undo.sql (only after
--        create-sale has been redeployed without the call)
-- ===========================================================================

set local lock_timeout = '5s';

-- Inserts one row from a JSON object, the keys naming the columns. Returns the
-- new row as JSON. An empty object inserts a row of defaults, as the REST API
-- did. Internal to create_sale_tx: it runs with the rights of its caller, and
-- nobody may call it directly.
create or replace function public._insert_row_from_json(_table regclass, _row jsonb)
returns jsonb
language plpgsql
security invoker
set search_path to 'public'
as $function$
declare
  _cols text;
  _unknown text;
  _out jsonb;
begin
  if _row is null or jsonb_typeof(_row) <> 'object' then
    raise exception 'A row to insert into % must be a JSON object', _table;
  end if;

  select string_agg(k, ', ' order by k) into _unknown
    from jsonb_object_keys(_row) k
   where not exists (
     select 1 from pg_attribute a
      where a.attrelid = _table and a.attname = k and a.attnum > 0 and not a.attisdropped);
  if _unknown is not null then
    raise exception 'Not columns of %: %', _table, _unknown;
  end if;

  select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into _cols
    from pg_attribute a
   where a.attrelid = _table and a.attnum > 0 and not a.attisdropped
     and _row ? a.attname;
  if _cols is null then
    execute format('insert into %1$s default values returning to_jsonb(%1$s.*)', _table) into _out;
    return _out;
  end if;

  execute format(
    'insert into %1$s (%2$s) select %2$s from jsonb_populate_record(null::%1$s, $1) returning to_jsonb(%1$s.*)',
    _table, _cols)
    into _out using _row;
  return _out;
end;
$function$;

create or replace function public.create_sale_tx(
  _address jsonb,
  _sale jsonb,
  _payment jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  _step text;
  _address_row jsonb;
  _sale_row jsonb;
  _sale_id uuid;
  _claimed integer;
  _payment_row jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not allowed';
  end if;

  begin
    _step := 'address';
    _address_row := public._insert_row_from_json('public.addresses', _address);

    _step := 'sale';
    _sale_row := public._insert_row_from_json(
      'public.sales',
      _sale || jsonb_build_object('address_id', _address_row->>'id'));
    _sale_id := (_sale_row->>'id')::uuid;

    _step := 'claim';
    update public.stove_ids
       set status = 'sold', sale_id = _sale_id
     where stove_id = _sale->>'stove_serial_no'
       and organization_id = (_sale->>'organization_id')::uuid
       and status <> 'sold';
    get diagnostics _claimed = row_count;

    if _payment is not null then
      _step := 'payment';
      _payment_row := public._insert_row_from_json(
        'public.installment_payments',
        _payment || jsonb_build_object('sale_id', _sale_id));
    end if;
  exception when others then
    raise exception using
      errcode = sqlstate,
      message = sqlerrm,
      hint = 'step:' || _step;
  end;

  -- Outside the block above, so it keeps its own code. Raising rolls back the
  -- address and the sale with it.
  if _claimed = 0 then
    raise exception using
      errcode = 'SC409',
      message = format('Stove %s was claimed by another sale first', _sale->>'stove_serial_no'),
      hint = 'step:claim';
  end if;

  return jsonb_build_object(
    'sale_id', _sale_id,
    'status', _sale_row->>'status',
    'address_id', _address_row->>'id',
    'payment_id', _payment_row->>'id');
end;
$function$;

comment on function public.create_sale_tx(jsonb, jsonb, jsonb) is
  'Saves a sale in one transaction: address, sale, stove claim and first instalment. Service role only; called by create-sale.';

revoke execute on function public._insert_row_from_json(regclass, jsonb) from public, anon, authenticated, service_role;
revoke execute on function public.create_sale_tx(jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.create_sale_tx(jsonb, jsonb, jsonb) to service_role;
