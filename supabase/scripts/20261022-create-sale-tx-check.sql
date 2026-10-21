-- Proof that 20261022090000_create_sale_in_one_transaction landed. Read-only.
-- Expected: 2 rows, both with anon_exec false and auth_exec false;
-- create_sale_tx with service_exec true; both with search_path=public.
-- Then one ledger row.

select p.proname,
       has_function_privilege('anon', p.oid, 'EXECUTE')          as anon_exec,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec,
       has_function_privilege('service_role', p.oid, 'EXECUTE')  as service_exec,
       p.prosecdef                                               as definer,
       array_to_string(p.proconfig, ',')                         as config
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('create_sale_tx', '_insert_row_from_json')
order by 1;

select version, name
from supabase_migrations.schema_migrations
where version = '20261022090000';
