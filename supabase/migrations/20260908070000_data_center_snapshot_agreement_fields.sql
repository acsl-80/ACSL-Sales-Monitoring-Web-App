-- ===========================================================================
-- Data Center, slice F2: the correction snapshot carries the agreement's new
-- fields (first name, surname, the sales agent's name, the city), so a
-- disputed record shows them and a fix can change them. The snapshot's other
-- keys are unchanged. Additive; the function is re-created whole.
-- ===========================================================================

create or replace function data_center.sale_snapshot(p_sale_id uuid)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'end_user_name',         s.end_user_name,
    'end_user_first_name',   s.end_user_first_name,
    'end_user_surname',      s.end_user_surname,
    'sales_agent_name',      s.selling_agent_name,
    'aka',                   s.aka,
    'phone',                 s.phone,
    'other_phone',           s.other_phone,
    'contact_person',        s.contact_person,
    'contact_phone',         s.contact_phone,
    'full_address',          a.full_address,
    'city',                  a.city,
    'state_backup',          s.state_backup,
    'lga_backup',            s.lga_backup,
    'stove_serial_no',       s.stove_serial_no,
    'sales_date',            s.sales_date,
    'pot_quantity',          s.pot_quantity,
    'heat_retention_device', s.heat_retention_device,
    'previous_stove_type',   s.previous_stove_type,
    'previous_stove_other',  s.previous_stove_other,
    'meals_per_day',         s.meals_per_day,
    'cooking_fuel_source',   s.cooking_fuel_source,
    'cooking_location',      s.cooking_location,
    'amount',                s.amount,
    'total_paid',            s.total_paid,
    'signature',             nullif(trim(coalesce(s.signature, '')), '') is not null,
    'agreement_image_id',    s.agreement_image_id is not null,
    'stove_image_id',        s.stove_image_id is not null
  )
  from public.sales s
  left join public.addresses a on a.id = s.address_id
  where s.id = p_sale_id;
$$;
