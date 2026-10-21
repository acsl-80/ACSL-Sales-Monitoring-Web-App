-- Undo for 20261021120000_server_only_functions. Puts back the grants and the
-- two sales rules exactly as they were on 2026-10-21. The search_path settings
-- are harmless and stay. Run only if a screen or the phone app breaks.

grant execute on function public.generate_external_app_token(character varying, text, text[]) to public, anon, authenticated;
grant execute on function public.list_external_app_tokens() to public, anon, authenticated;
grant execute on function public.revoke_external_app_token(text) to public, anon, authenticated;
grant execute on function public.get_sales_history(uuid, uuid, integer, integer, character varying, timestamp without time zone, timestamp without time zone) to public, anon, authenticated;
grant execute on function public.add_custom_sales_history(uuid, character varying, text, jsonb) to public, anon, authenticated;
grant execute on function public.manual_create_sales_history(uuid, character varying, text, jsonb, uuid) to public, anon, authenticated;
grant execute on function public.check_profile_email_exists(text) to public, anon, authenticated;
grant execute on function public.get_table_count(text) to public, anon, authenticated;

drop policy if exists users_own_sales on public.sales;
create policy users_own_sales on public.sales
  for all to authenticated
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

drop policy if exists admin_org_sales_management on public.sales;
create policy admin_org_sales_management on public.sales
  for all to authenticated
  using (
    organization_id in (
      select profiles.organization_id from profiles
      where profiles.id = auth.uid()
        and profiles.role = any (array['admin'::text, 'super_admin'::text])
    )
  )
  with check (
    organization_id in (
      select profiles.organization_id from profiles
      where profiles.id = auth.uid()
        and profiles.role = any (array['admin'::text, 'super_admin'::text])
    )
  );
