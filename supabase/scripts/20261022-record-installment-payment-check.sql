-- Proof that 20261022100000_record_installment_payment landed. Read-only.
-- Expected: 1 row with anon_exec false, auth_exec false, service_exec true,
-- definer true and search_path=public. Then one ledger row.

select p.proname,
       has_function_privilege('anon', p.oid, 'EXECUTE')          as anon_exec,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec,
       has_function_privilege('service_role', p.oid, 'EXECUTE')  as service_exec,
       p.prosecdef                                               as definer,
       array_to_string(p.proconfig, ',')                         as config
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'record_installment_payment';

select version, name
from supabase_migrations.schema_migrations
where version = '20261022100000';
