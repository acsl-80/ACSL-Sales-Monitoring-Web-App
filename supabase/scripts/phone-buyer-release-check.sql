-- Phone number and buyer rule: the release's figures. Read only; nothing here
-- writes. Runs the same before the release and after it.
--
-- Runbook: docs/plans/phone-and-buyer-rule-release.md. Run it at each point
-- the runbook says and paste the row into the release log.
--
--   migrations       of the five 20261014 migrations, how many are applied (0, then 5)
--   new_functions    of the four functions they add, how many exist (0, then 4)
--   register_rows    rows on data_center.shared_phones
--   register_open    of those, not yet confirmed
--   register_numbers distinct numbers on the register
--   same_buyer_rows  rows marked as the same customer twice (0 until the kind backfill)
--   live_sales       live (not archived) sales
--   creditable       live sales that pass every gate of the creditable count
--   held_by_register live sales that pass every gate but the register: the
--                    ones a confirmation would release
--
-- creditable and held_by_register apply the gates of
-- data_center.compute_analysis in its order, now, so they move as soon as a
-- script runs. The dashboard's own figure moves only at the next Recompute.
-- kind is read through to_jsonb so this runs before the column exists.

with complete(id) as (
  select x.id
    from xmltable('/table/row'
           passing query_to_xml(
             format('select s.id from public.sales s where s.is_archived is not true and (%s)',
                    data_center.completeness_predicate('s')),
             false, false, '')
           columns id uuid path 'id') as x
)
, ladder as (
  select s.id,
         case
           when cr.correction_requested_at is not null and cr.correction_resolved_at is null then 'correction_open'
           when cr.verification_outcome is distinct from 'fully_verified' then 'not_fully_verified'
           when not exists (select 1 from complete c where c.id = s.id) then 'incomplete'
           when cr.serial_unconfirmed_at is not null then 'serial_unconfirmed'
           when coalesce(cr.answers ->> 'double_counting', 'only_stove') <> 'only_stove' then 'double_counted'
           when exists (select 1 from data_center.shared_phones sp
                         where sp.sale_id = s.id and sp.confirmed is false) then 'held_by_register'
           else 'creditable'
         end as reason
    from public.sales s
    left join data_center.call_records cr on cr.sale_id = s.id
   where s.is_archived is not true
)
select (select count(*) from supabase_migrations.schema_migrations
         where version in ('20261014120000', '20261014120100', '20261014120200',
                           '20261014120300', '20261014120400')) as migrations,
       (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.proname in ('sales_sharing_phone', 'visible_sales_on_phone',
                             'buyer_key_inputs', 'register_shared_phone')) as new_functions,
       (select count(*) from data_center.shared_phones) as register_rows,
       (select count(*) from data_center.shared_phones where confirmed is false) as register_open,
       (select count(distinct phone_tail) from data_center.shared_phones) as register_numbers,
       (select count(*) from data_center.shared_phones sp
         where to_jsonb(sp) ->> 'kind' = 'same_buyer') as same_buyer_rows,
       (select count(*) from ladder) as live_sales,
       (select count(*) from ladder where reason = 'creditable') as creditable,
       (select count(*) from ladder where reason = 'held_by_register') as held_by_register;
