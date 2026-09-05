-- ===========================================================================
-- Data Center, slice F2b: the transfer's order model reaches the module.
--
-- v_transfers carries the three new columns of stove_transfer_history and
-- the payment model's current name beside them; the digitisation sheet gains
-- a Sales model column, prefilled from the transfer and free to change, right
-- after the partner. The column is not locked: the receipt wins over the
-- consignment when they disagree, and the import already reads Sales model
-- to price a row and to match the model.
-- ===========================================================================

create or replace view data_center.v_transfers as
select
  t.id                        as transfer_id,
  t.transaction_id,
  t.organization_id,
  coalesce(o.partner_name, t.partner_name) as partner_name,
  t.partner_id,
  t.state                     as transfer_state,
  t.branch                    as transfer_branch,
  t.stove_count               as issued_count,
  t.sales_rep,
  t.sales_factory,
  t.customer,
  t.sales_date::text          as sales_date,
  t.transfer_date,
  t.source,
  t.order_payment_model_id,
  t.order_sales_model_name,
  t.order_sales_model_duration,
  pm.name                     as order_payment_model_label
from public.stove_transfer_history t
left join public.organizations o on o.id = t.organization_id
left join public.payment_models pm on pm.id = t.order_payment_model_id;

comment on view data_center.v_transfers is
  'One row per consignment from the ERP, read never copied. Since F2b it carries the Order Sales Model the ERP named for the consignment, as sent and as resolved.';

-- The sheet's Sales model column, after the partner, prefilled from the
-- transfer. Idempotent: only when the anchor exists and the column does not.
update data_center.workflow_config w
   set value = (
     select coalesce(jsonb_agg(e.col order by e.ord, e.sub), '[]'::jsonb)
       from jsonb_array_elements(w.value) with ordinality as t(col, ord)
       cross join lateral (
         values (t.col, 0),
                (case when t.col ->> 'field' = 'partnerName'
                      then '{"field":"salesModel","header":"Sales model","required":false,"type":"text","help":"Prefilled from the transfer. Change it if the receipt names another model."}'::jsonb
                      else null end, 1)
       ) as e(col, sub)
      where e.col is not null)
 where w.key = 'digitisation.sheet_columns'
   and exists (select 1 from jsonb_array_elements(w.value) c where c ->> 'field' = 'partnerName')
   and not exists (select 1 from jsonb_array_elements(w.value) c where c ->> 'field' = 'salesModel');
