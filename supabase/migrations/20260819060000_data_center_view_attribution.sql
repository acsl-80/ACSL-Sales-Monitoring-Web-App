-- Add `sold_on_behalf_of` to Table 1.
--
-- WHY
--
-- The sales app scopes what a user may see by three columns: organization_id,
-- created_by, and sold_on_behalf_of. A partner agent sees their own sales,
-- which means rows they created OR rows recorded on their behalf; an ACSL
-- manager additionally sees anything attributed to their team. The Data Center
-- mirrors that rule (supabase/functions/data-center-read/scope.ts) so it can
-- never show a user a row the sales app would hide.
--
-- v_sold_stoves carried the first two and not the third, so every scoped read
-- failed with "column v.sold_on_behalf_of does not exist". A super admin never
-- hit it, because their branch of the rule needs no column at all. It surfaced
-- the moment a viewer and an editor were tested.
--
-- The column is added to the view but is NOT returned by the records endpoint.
-- It is an internal attribution key, not something the table needs to render.
--
-- `create or replace view` is safe here: it appends a column and leaves the
-- existing ones in place, in order, unchanged.

create or replace view data_center.v_sold_stoves as
select
  s.id                     as sale_id,
  s.transaction_id,
  s.sales_date,
  s.stove_serial_no,
  s.end_user_name,
  s.aka,
  s.phone                  as primary_phone,
  s.other_phone            as alternative_phone,
  s.contact_person         as buyer_name,
  s.contact_phone          as buyer_phone,
  s.partner_name,
  s.retailer_branch,
  s.state_backup           as user_state,
  s.lga_backup             as user_lga,
  s.amount,
  s.total_paid,
  s.payment_status,
  s.is_installment,
  s.status                 as sale_status,
  s.is_archived,
  s.platform,
  s.created_at,
  s.organization_id,
  s.created_by,
  a.full_address           as user_residential_address,
  a.latitude,
  a.longitude,
  o.state                  as partner_state,
  o.address                as partner_address,
  o.branch                 as partner_branch,
  o.partner_id,
  pm.name                  as sales_model,
  pr.full_name             as sale_agent_name,
  s.previous_stove_type,
  s.previous_stove_other,
  s.pot_quantity,
  s.heat_retention_device,
  b.factory,
  b.status                 as stove_stock_status,
  -- Appended. Attribution only: who the sale was recorded for, which is null on
  -- older rows and is why scope.ts checks created_by as well.
  s.sold_on_behalf_of
from public.sales s
left join public.addresses      a  on a.id  = s.address_id
left join public.organizations  o  on o.id  = s.organization_id
left join public.payment_models pm on pm.id = s.payment_model_id
left join public.profiles       pr on pr.id = s.created_by
left join public.stove_ids_base b  on b.stove_id = s.stove_serial_no;

comment on view data_center.v_sold_stoves is
  'Table 1. Sold stove records assembled from public. Owns no data.';
