-- Eight older public functions become server-only, and two sales row rules
-- become read-only.
--
-- WHAT THIS DOES
--
-- 1. The three integration token functions (generate, list, revoke) can be
--    run only by the service role, the way the ERP integration and the
--    server functions already use them. Nothing in the web app, the phone
--    app or the ERP calls them as a signed-in user.
-- 2. Five baseline helpers (get_sales_history, add_custom_sales_history,
--    manual_create_sales_history, check_profile_email_exists,
--    get_table_count) can be run only by the service role. No database
--    function or cron job calls them, and no screen does. The one edge
--    function that called add_custom_sales_history with the caller's token,
--    create-sales-history, is called by nothing (checked in sales-web, the
--    phone app's lib/ and erp-web on 2026-10-21).
-- 3. All eight get a fixed search_path, so they resolve names the same way
--    whoever runs them. `extensions` stays on the path for gen_random_bytes.
-- 4. The sales rules users_own_sales and admin_org_sales_management keep
--    their exact conditions but apply to reading only. Every sale write runs
--    in an edge function with the service role: create-sale, update-sale,
--    approve-sale, delete-sale, installment-payments, manage-stove-ids and
--    backfill-sale-status. assign-sale-to-agent writes with the caller's
--    token and is called by nothing; after this only a super admin could use
--    it.
--
-- WHY NOTHING BREAKS
--
-- The phone app reaches the database only through edge functions (v1.0.19,
-- checked 2026-10-21): no table and no database function calls. The web app
-- reads sales directly but never writes them. The service role keeps
-- EXECUTE on every function and bypasses row rules.
--
-- CHECK: supabase/scripts/20261021-server-only-functions-check.sql
-- UNDO:  supabase/scripts/20261021-server-only-functions-undo.sql

set local lock_timeout = '5s';

-- 1 and 2. Server only.
revoke execute on function public.generate_external_app_token(character varying, text, text[]) from public, anon, authenticated;
revoke execute on function public.list_external_app_tokens() from public, anon, authenticated;
revoke execute on function public.revoke_external_app_token(text) from public, anon, authenticated;
revoke execute on function public.get_sales_history(uuid, uuid, integer, integer, character varying, timestamp without time zone, timestamp without time zone) from public, anon, authenticated;
revoke execute on function public.add_custom_sales_history(uuid, character varying, text, jsonb) from public, anon, authenticated;
revoke execute on function public.manual_create_sales_history(uuid, character varying, text, jsonb, uuid) from public, anon, authenticated;
revoke execute on function public.check_profile_email_exists(text) from public, anon, authenticated;
revoke execute on function public.get_table_count(text) from public, anon, authenticated;

grant execute on function public.generate_external_app_token(character varying, text, text[]) to service_role;
grant execute on function public.list_external_app_tokens() to service_role;
grant execute on function public.revoke_external_app_token(text) to service_role;
grant execute on function public.get_sales_history(uuid, uuid, integer, integer, character varying, timestamp without time zone, timestamp without time zone) to service_role;
grant execute on function public.add_custom_sales_history(uuid, character varying, text, jsonb) to service_role;
grant execute on function public.manual_create_sales_history(uuid, character varying, text, jsonb, uuid) to service_role;
grant execute on function public.check_profile_email_exists(text) to service_role;
grant execute on function public.get_table_count(text) to service_role;

-- 3. A fixed search_path.
alter function public.generate_external_app_token(character varying, text, text[]) set search_path = public, extensions;
alter function public.list_external_app_tokens() set search_path = public, extensions;
alter function public.revoke_external_app_token(text) set search_path = public, extensions;
alter function public.get_sales_history(uuid, uuid, integer, integer, character varying, timestamp without time zone, timestamp without time zone) set search_path = public, extensions;
alter function public.add_custom_sales_history(uuid, character varying, text, jsonb) set search_path = public, extensions;
alter function public.manual_create_sales_history(uuid, character varying, text, jsonb, uuid) set search_path = public, extensions;
alter function public.check_profile_email_exists(text) set search_path = public, extensions;
alter function public.get_table_count(text) set search_path = public, extensions;

-- 4. Two sales rules, same conditions, reading only.
drop policy if exists users_own_sales on public.sales;
create policy users_own_sales on public.sales
  for select to authenticated
  using (created_by = auth.uid());

drop policy if exists admin_org_sales_management on public.sales;
create policy admin_org_sales_management on public.sales
  for select to authenticated
  using (
    organization_id in (
      select profiles.organization_id
      from profiles
      where profiles.id = auth.uid()
        and profiles.role = any (array['admin'::text, 'super_admin'::text])
    )
  );
