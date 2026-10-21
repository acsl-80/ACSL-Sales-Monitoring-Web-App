-- Proof that 20261021120000_server_only_functions landed. Read-only.
-- Expected: 8 rows with anon_exec false, auth_exec false, service_exec true and
-- a search_path; then 2 rows with cmd SELECT; then one ledger row.

select p.proname,
       has_function_privilege('anon', p.oid, 'EXECUTE')          as anon_exec,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec,
       has_function_privilege('service_role', p.oid, 'EXECUTE')  as service_exec,
       array_to_string(p.proconfig, ',')                         as config
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('generate_external_app_token', 'list_external_app_tokens', 'revoke_external_app_token',
                    'get_sales_history', 'add_custom_sales_history', 'manual_create_sales_history',
                    'check_profile_email_exists', 'get_table_count')
order by 1;

select policyname, cmd, roles::text
from pg_policies
where schemaname = 'public' and tablename = 'sales'
  and policyname in ('users_own_sales', 'admin_org_sales_management')
order by 1;

select version, name
from supabase_migrations.schema_migrations
where version = '20261021120000';
