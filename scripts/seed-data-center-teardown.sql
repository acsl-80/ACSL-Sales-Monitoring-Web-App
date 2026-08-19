-- Removes everything scripts/seed-data-center.sql wrote, and nothing else.
--
-- Every seeded row carries a tag: UUIDs in the reserved f5eed... range,
-- organizations with partner_id like 'SEED-%', stove IDs prefixed 'SD',
-- profiles at @seed.invalid. Each delete below is anchored to one of those, so
-- a real row cannot be caught by it.
--
--   docker exec -i supabase_db_<project> psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < scripts/seed-data-center-teardown.sql

begin;

do $$
begin
  if current_setting('data_center.seed_ok', true) is distinct from 'yes' then
    raise exception
      'Refusing to run. If this is a LOCAL database, run:  set data_center.seed_ok = ''yes'';';
  end if;
end $$;

alter table public.sales disable trigger user;

-- Order matters: sales reference addresses and stock references sales.
delete from data_center.call_records
 where sale_id in (select id from public.sales where id::text like 'f5eed100-%');

delete from public.stove_ids_base where stove_id like 'SD%';
delete from public.sales         where id::text like 'f5eed100-%';
delete from public.addresses     where id::text like 'f5eed200-%';
delete from public.uploads       where id::text like 'f5eed003-%';
delete from public.profiles      where id::text like 'f5eed002-%';
delete from auth.users           where id::text like 'f5eed002-%';
delete from public.payment_models where id::text like 'f5eed001-%';
delete from public.organizations where partner_id like 'SEED-%';

alter table public.sales enable trigger user;

analyze public.sales;

commit;

select
  (select count(*) from public.sales)                                    as sales_remaining,
  (select count(*) from public.sales where id::text like 'f5eed100-%')   as seeded_remaining,
  (select count(*) from public.organizations where partner_id like 'SEED-%') as seed_orgs_remaining;
