-- Proof that 20261021180000_credentials_server_only landed. Read-only.
-- Expected: anon and authenticated hold no right on the table, service_role does,
-- only the two service-role rules remain, and the ledger row exists.

select has_table_privilege('anon', 'public.credentials', 'SELECT')          as anon_select,
       has_table_privilege('authenticated', 'public.credentials', 'SELECT') as auth_select,
       has_table_privilege('authenticated', 'public.credentials', 'DELETE') as auth_delete,
       has_table_privilege('service_role', 'public.credentials', 'SELECT')  as service_select,
       (select string_agg(policyname, ', ' order by policyname)
          from pg_policies where schemaname = 'public' and tablename = 'credentials') as rules_left,
       (select count(*) from supabase_migrations.schema_migrations where version = '20261021180000') as ledger_row;
