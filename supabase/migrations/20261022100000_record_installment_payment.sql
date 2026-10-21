-- ===========================================================================
-- An instalment payment and the sale's total are written together.
--
-- installment-payments read the sale's total_paid when the request arrived,
-- inserted the payment, then wrote back the total it had read plus the new
-- amount. Two payments recorded at the same moment both read the same total,
-- so the second write replaced the first: two payments on the ledger, one
-- counted in total_paid. The balance check had the same gap, so two payments
-- that each fitted the remaining balance could together pay more than the
-- sale amount.
--
-- record_installment_payment locks the sale row, checks the payment against
-- the balance as it stands under that lock, inserts the payment and adds it
-- to total_paid in the same transaction. A second payment at the same moment
-- waits for the first and is checked against the new balance.
--
-- REFUSALS. A sale that is not an instalment sale, one already fully paid, or
-- a payment above the remaining balance raises SQLSTATE 'IP400' with the same
-- sentence installment-payments has always returned; it answers 400.
--
-- WHO MAY CALL IT. The service role only. installment-payments has
-- authenticated the caller and checked their access to the sale first, and
-- sets recorded_by from that caller.
--
-- Written for Orezi to run. Nothing here is executed by the agent.
--
-- CHECK: supabase/scripts/20261022-record-installment-payment-check.sql
-- UNDO:  supabase/scripts/20261022-record-installment-payment-undo.sql (only
--        after installment-payments has been redeployed without the call)
-- ===========================================================================

set local lock_timeout = '5s';

create or replace function public.record_installment_payment(
  _sale_id uuid,
  _amount numeric,
  _payment_method text,
  _recorded_by uuid,
  _payment_date date default current_date,
  _proof_image_id uuid default null,
  _proof_image_url text default null,
  _notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  _sale record;
  _remaining numeric;
  _payment public.installment_payments%rowtype;
  _total numeric;
  _status text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not allowed';
  end if;

  select id, amount, total_paid, is_installment, payment_status
    into _sale
    from public.sales
   where id = _sale_id
     for update;
  if not found then
    raise exception 'Sale not found' using errcode = 'IP404';
  end if;

  if _sale.is_installment is not true then
    raise exception 'This sale is not an installment payment sale' using errcode = 'IP400';
  end if;
  if _sale.payment_status = 'fully_paid' then
    raise exception 'This sale is already fully paid' using errcode = 'IP400';
  end if;

  _remaining := coalesce(_sale.amount, 0) - coalesce(_sale.total_paid, 0);
  if _amount > _remaining then
    raise exception 'Payment amount (%) exceeds remaining balance (%)',
      trim_scale(_amount), trim_scale(_remaining) using errcode = 'IP400';
  end if;

  insert into public.installment_payments
    (sale_id, amount, payment_method, proof_image_id, proof_image_url, notes, recorded_by, payment_date)
  values
    (_sale_id, _amount, _payment_method, _proof_image_id, _proof_image_url, _notes, _recorded_by,
     coalesce(_payment_date, current_date))
  returning * into _payment;

  _total := coalesce(_sale.total_paid, 0) + _amount;
  _status := case when _total >= coalesce(_sale.amount, 0) then 'fully_paid' else 'partially_paid' end;

  update public.sales
     set total_paid = _total,
         payment_status = _status
   where id = _sale_id;

  return jsonb_build_object(
    'payment', to_jsonb(_payment),
    'total_paid', _total,
    'payment_status', _status,
    'remaining', coalesce(_sale.amount, 0) - _total);
end;
$function$;

comment on function public.record_installment_payment(uuid, numeric, text, uuid, date, uuid, text, text) is
  'Records an instalment payment and adds it to the sale''s total_paid in one transaction, under a lock on the sale. Service role only; called by installment-payments.';

revoke execute on function public.record_installment_payment(uuid, numeric, text, uuid, date, uuid, text, text) from public, anon, authenticated;
grant execute on function public.record_installment_payment(uuid, numeric, text, uuid, date, uuid, text, text) to service_role;
