-- Synthetic sales at capacity, for proving the Data Center's query shape.
--
-- WHY THIS EXISTS
--
-- Production holds 38 sales. The Data Center is designed for 500,000. No claim
-- about pagination, indexes or render cost can be tested against 38 rows, so
-- generating the volume is a deliverable of Phase 3 rather than a convenience.
--
-- WHAT IT WRITES
--
-- Everything the Table 1 view joins, so the seeded rows exercise the real query
-- and not a simplified one: organizations, payment models, agent profiles,
-- uploads, addresses, stove stock, and the sales themselves.
--
-- HOW TO RUN (local Supabase only)
--
--   docker exec -i supabase_db_<project> psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < scripts/seed-data-center.sql
--
-- Row count defaults to 500,000. Override before running:
--   set data_center.seed_rows = '50000';
--
-- TEARDOWN
--
--   scripts/seed-data-center-teardown.sql
--
-- Every row this writes is tagged, and the teardown removes exactly those. No
-- pre-existing row is read, updated or deleted by either script.

begin;

-- ---------------------------------------------------------------------------
-- Guard.
--
-- This writes hundreds of thousands of rows into public.sales. Running it
-- against the live project would be unrecoverable in practice, so it refuses
-- unless the operator has said so in the same session. There is no flag that
-- can be set by accident.
-- ---------------------------------------------------------------------------
do $$
begin
  if current_setting('data_center.seed_ok', true) is distinct from 'yes' then
    raise exception
      'Refusing to seed. This writes synthetic sales into public.sales and is for a LOCAL database only. If this is local, run:  set data_center.seed_ok = ''yes'';';
  end if;
end $$;

do $$
declare
  n bigint := coalesce(nullif(current_setting('data_center.seed_rows', true), ''), '500000')::bigint;
begin
  raise notice 'Seeding % synthetic sales', n;
end $$;

-- ---------------------------------------------------------------------------
-- Triggers off for the bulk load.
--
-- sales_history_trigger writes an audit row per sale, which would turn a
-- 500,000 row insert into a 1,000,000 row insert and take minutes. The status
-- triggers are replaced by computing `status` inline below, using the same rule
-- as calculate_sale_status().
--
-- These are restored at the end of this file, inside the same transaction, so a
-- failure rolls the disable back with everything else.
-- ---------------------------------------------------------------------------
alter table public.sales disable trigger user;

-- ---------------------------------------------------------------------------
-- Dimensions. Small, and shared by every generated sale.
-- ---------------------------------------------------------------------------

-- 40 partner organizations, tagged SEED- so teardown can find them. Sales
-- cascade from here on delete.
insert into public.organizations (id, partner_name, partner_id, state, branch, address, partner_type, contact_person, contact_phone, email)
select
  ('f5eed000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid,
  'Seed Partner ' || g,
  'SEED-' || lpad(g::text, 4, '0'),
  (array['Lagos','Kano','Kaduna','Oyo','Rivers','Enugu','Borno','Sokoto','Plateau','Benue'])[1 + (g % 10)],
  'Branch ' || (1 + (g % 4)),
  'Plot ' || g || ', Seed Road',
  case when g % 5 = 0 then 'customer' else 'partner' end,
  'Seed Contact ' || g,
  '080' || lpad((10000000 + g)::text, 8, '0'),
  'seed.partner' || g || '@seed.invalid'
from generate_series(1, 40) g
on conflict (id) do nothing;

-- Payment models. One outright, the rest installment.
insert into public.payment_models (id, name, duration_months, fixed_price, min_down_payment, is_active)
select
  ('f5eed001-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid,
  (array['Full Payment','3 Month Plan','6 Month Plan','9 Month Plan','12 Month Plan','Seasonal Plan'])[g],
  (array[0,3,6,9,12,4])[g],
  (array[52000,56000,59000,62000,65000,58000])[g],
  (array[0,15000,15000,20000,20000,18000])[g],
  true
from generate_series(1, 6) g
on conflict (id) do nothing;

-- Sales agents, so `sale_agent_name` in the view resolves to something.
--
-- profiles.id references auth.users, so the auth rows come first, and the
-- identity is carried in raw_user_meta_data rather than written straight to
-- profiles. That is deliberate. The database syncs the two in both directions:
-- on_auth_user_created builds the profile from this metadata, and any later
-- write to profiles.role updates auth.users, which fires handle_user_update and
-- pushes the metadata back down. Setting full_name only on profiles loses it on
-- that return trip. Seeding through the metadata is also how the app itself
-- creates a user, so these rows behave like real ones.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_user_meta_data
)
select
  ('f5eed002-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid,
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated',
  'seed.agent' || g || '@seed.invalid',
  crypt('seed-not-a-real-account', gen_salt('bf')),
  now(), now(), now(),
  jsonb_build_object(
    'full_name', 'Seed Agent ' || g,
    'role', 'partner_agent',
    'organization_id', ('f5eed000-0000-4000-8000-' || lpad((1 + (g % 40))::text, 12, '0'))
  )
from generate_series(1, 60) g
on conflict (id) do nothing;

insert into public.profiles (id, email, full_name, role, organization_id, status)
select
  ('f5eed002-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid,
  'seed.agent' || g || '@seed.invalid',
  'Seed Agent ' || g,
  'partner_agent',
  ('f5eed000-0000-4000-8000-' || lpad((1 + (g % 40))::text, 12, '0'))::uuid,
  'active'
from generate_series(1, 60) g
-- auth.users carries a handle_new_user trigger that creates the profile row
-- before this statement runs, so correct it rather than skipping it.
on conflict (id) do update set
  full_name       = excluded.full_name,
  role            = excluded.role,
  organization_id = excluded.organization_id,
  status          = excluded.status;

-- A small pool of uploads. Sales that reference one can reach `completed`
-- status, which is what makes the status filter worth testing.
insert into public.uploads (id, public_id, url, type, created_by)
select
  ('f5eed003-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid,
  'seed/upload/' || g,
  'https://seed.invalid/upload/' || g || '.jpg',
  case when g % 2 = 0 then 'stove' else 'agreement' end,
  'f5eed002-0000-4000-8000-000000000001'::uuid
from generate_series(1, 200) g
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- The volume.
--
-- One temp table drives all three inserts so a sale, its address and its stove
-- share the same derived values without recomputing them.
-- ---------------------------------------------------------------------------
create temporary table _seed_rows on commit drop as
select
  g                                                            as n,
  ('f5eed100-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid as sale_id,
  ('f5eed200-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid as address_id,
  ('f5eed000-0000-4000-8000-' || lpad((1 + (g % 40))::text, 12, '0'))::uuid  as org_id,
  ('f5eed002-0000-4000-8000-' || lpad((1 + (g % 60))::text, 12, '0'))::uuid  as agent_id,
  ('f5eed001-0000-4000-8000-' || lpad((1 + (g % 6))::text,  12, '0'))::uuid  as model_id,
  'SD' || lpad(to_hex(g), 8, '0')                              as stove_serial,
  -- Three years of history, so a keyset cursor has somewhere to walk and the
  -- date filter has range to bite on.
  (current_date - (((g * 7919) % 1095))::int)                   as sales_date,
  (g % 4) = 0                                                  as is_installment,
  -- A quarter of rows carry both images, which is what lets them reach
  -- `completed`. The rest sit `incomplete`, mirroring production, where the
  -- form stopped requiring images but calculate_sale_status() did not.
  (g % 4) = 1                                                  as has_images
from generate_series(1, coalesce(nullif(current_setting('data_center.seed_rows', true), ''), '500000')::bigint) g;

create index on _seed_rows (n);

-- Addresses first: sales reference them.
insert into public.addresses (id, full_address, street, city, state, country, latitude, longitude)
select
  r.address_id,
  'No ' || r.n || ', Seed Street, ' || (array['Ikeja','Nassarawa','Chikun','Ibadan North','Obio-Akpor','Nsukka','Jere','Wamakko','Jos North','Gboko'])[1 + (r.n % 10)],
  'Seed Street',
  (array['Ikeja','Nassarawa','Chikun','Ibadan North','Obio-Akpor','Nsukka','Jere','Wamakko','Jos North','Gboko'])[1 + (r.n % 10)],
  (array['Lagos','Kano','Kaduna','Oyo','Rivers','Enugu','Borno','Sokoto','Plateau','Benue'])[1 + (r.n % 10)],
  'Nigeria',
  4.0 + ((r.n % 900)::numeric / 100),
  3.0 + ((r.n % 1000)::numeric / 100)
from _seed_rows r;

-- The sales themselves.
--
-- `status` is computed here rather than by the trigger, which is disabled for
-- the load. The rule is copied from calculate_sale_status(): every required
-- field present, plus a signature, plus both images.
insert into public.sales (
  id, transaction_id, stove_serial_no, sales_date,
  contact_person, contact_phone, end_user_name, aka,
  state_backup, lga_backup, phone, other_phone,
  partner_name, retailer_branch, amount, signature,
  created_by, sold_on_behalf_of, organization_id, address_id,
  stove_image_id, agreement_image_id,
  created_at, status, is_installment, payment_model_id,
  total_paid, payment_status,
  pot_quantity, heat_retention_device,
  previous_stove_type, meals_per_day, cooking_fuel_source, cooking_location,
  terms_accepted, is_archived, platform
)
select
  r.sale_id,
  upper(substr(md5(r.n::text), 1, 6)),
  r.stove_serial,
  r.sales_date,
  'Seed Buyer ' || r.n,
  '080' || lpad(((r.n * 37) % 100000000)::text, 8, '0'),
  'Seed User ' || r.n,
  case when r.n % 11 = 0 then 'Mama ' || r.n else null end,
  (array['Lagos','Kano','Kaduna','Oyo','Rivers','Enugu','Borno','Sokoto','Plateau','Benue'])[1 + (r.n % 10)],
  (array['Ikeja','Nassarawa','Chikun','Ibadan North','Obio-Akpor','Nsukka','Jere','Wamakko','Jos North','Gboko'])[1 + (r.n % 10)],
  '070' || lpad(((r.n * 53) % 100000000)::text, 8, '0'),
  case when r.n % 7 = 0 then '090' || lpad(((r.n * 71) % 100000000)::text, 8, '0') else null end,
  'Seed Partner ' || (1 + (r.n % 40)),
  'Branch ' || (1 + (r.n % 4)),
  (array[52000,56000,59000,62000,65000,58000])[1 + (r.n % 6)],
  'data:image/png;base64,seed',
  r.agent_id,
  r.agent_id,
  r.org_id,
  r.address_id,
  case when r.has_images then ('f5eed003-0000-4000-8000-' || lpad((2 + (r.n % 99) * 2)::text, 12, '0'))::uuid end,
  case when r.has_images then ('f5eed003-0000-4000-8000-' || lpad((1 + (r.n % 99) * 2)::text, 12, '0'))::uuid end,
  r.sales_date::timestamp + ((r.n % 86400) * interval '1 second'),
  case when r.has_images then 'completed' else 'incomplete' end,
  r.is_installment,
  r.model_id,
  case
    when r.is_installment then ((array[52000,56000,59000,62000,65000,58000])[1 + (r.n % 6)] * (1 + (r.n % 4)) / 4.0)::numeric(12,2)
    else (array[52000,56000,59000,62000,65000,58000])[1 + (r.n % 6)]
  end,
  case
    when not r.is_installment then 'fully_paid'
    when (r.n % 4) = 3 then 'fully_paid'
    else 'partially_paid'
  end,
  (r.n % 3),
  (r.n % 2) = 0,
  (array['charcoal','wood_stove','other'])[1 + (r.n % 3)],
  (1 + (r.n % 3)) || ' meals',
  (array['Local market','Own farm','Roadside vendor'])[1 + (r.n % 3)],
  (array['Outdoors','Kitchen','Veranda'])[1 + (r.n % 3)],
  '{"poaGoverned":true,"monitoring":true,"noResell":true,"emissionReductions":true,"noExport":true,"demonstration":true}'::jsonb,
  (r.n % 25) = 0,
  case when r.n % 3 = 0 then 'mobile' else 'web' end
from _seed_rows r;

-- Stove stock last: stove_ids_base.sale_id references sales, so the sales rows
-- have to exist first. This is what makes the view's join to stock resolve, and
-- what gives Phase 5's import path real serials to match against.
insert into public.stove_ids_base (id, stove_id, organization_id, status, factory, sale_id)
select
  ('f5eed300-0000-4000-8000-' || lpad(r.n::text, 12, '0'))::uuid,
  r.stove_serial,
  r.org_id,
  'sold',
  (array['Factory A','Factory B','Factory C'])[1 + (r.n % 3)],
  r.sale_id
from _seed_rows r;

-- Unsold stock, so the import path has something to import against.
--
-- Every stove above is attached to a sale, which is what makes Table 1 and the
-- call centre queue realistic. Bulk import needs the opposite: stoves a partner
-- holds and has not sold yet. Without these the import can only ever produce
-- exceptions, and the happy path is untestable.
--
-- The serial prefix differs (SA for available, SD for sold) so the two sets are
-- distinguishable at a glance, and the teardown removes both.
insert into public.stove_ids_base (id, stove_id, organization_id, status, factory)
select
  ('f5eed400-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid,
  'SA' || lpad(to_hex(g), 8, '0'),
  ('f5eed000-0000-4000-8000-' || lpad((1 + (g % 40))::text, 12, '0'))::uuid,
  'available',
  (array['Factory A','Factory B','Factory C'])[1 + (g % 3)]
from generate_series(1, 2000) g;


-- ---------------------------------------------------------------------------
-- Restore.
-- ---------------------------------------------------------------------------
alter table public.sales enable trigger user;

analyze public.sales;
analyze public.addresses;
analyze public.stove_ids_base;

commit;

-- What landed.
select
  (select count(*) from public.sales where id::text like 'f5eed100-%')            as seeded_sales,
  (select count(*) from public.sales)                                            as total_sales,
  (select count(*) from public.addresses where id::text like 'f5eed200-%')       as seeded_addresses,
  (select count(*) from public.stove_ids_base where stove_id like 'SD%')         as seeded_stoves,
  (select count(*) from public.stove_ids_base where stove_id like 'SA%')         as available_stoves,
  (select min(sales_date) from public.sales where id::text like 'f5eed100-%')    as earliest,
  (select max(sales_date) from public.sales where id::text like 'f5eed100-%')    as latest;
