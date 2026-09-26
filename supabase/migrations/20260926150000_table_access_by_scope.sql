-- Table access follows each account's scope.
--
-- Email settings and the email log belong to super admins and the server.
-- Payment models are managed by super admins and read by signed-in users.
-- Partner payment terms, instalments and sales history are read within the
-- organisations an account may see, and written only through the paths the app
-- uses. The service role bypasses row security and needs no policy.
--
-- Changes no rows. Every statement is re-runnable.

begin;

-- One definition of "the organisations this account may see", for policies.
-- super_admin: every organisation. Everyone else: their own organisation, plus,
-- for ACSL agents and managers, the coverage public.acsl_agent_org_scope gives
-- them and (managers) their acsl_agent team. The same composition as
-- supabase/functions/_shared/resolveAssignedOrgIds.ts. Disabled accounts see none.
create or replace function public.scope_organization_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select p.id, p.role, p.organization_id
      from public.profiles p
     where p.id = auth.uid()
       and p.status = 'active'
  )
  select o.id
    from public.organizations o
   where exists (select 1 from me where me.role = 'super_admin')
  union
  select me.organization_id
    from me
   where me.organization_id is not null
  union
  select s.organization_id
    from me
   cross join lateral public.acsl_agent_org_scope(
           array[me.id]
           || coalesce(array(select t.id from public.profiles t
                              where t.manager_id = me.id and t.role = 'acsl_agent'), '{}'::uuid[])
         ) s
   where me.role in ('acsl_agent', 'acsl_agent_manager', 'super_admin_agent')
$$;

revoke all on function public.scope_organization_ids() from public, anon;
grant execute on function public.scope_organization_ids() to authenticated, service_role;

-- A sale is in scope when its organisation is. Security definer, so a policy
-- can ask it without the caller needing read access to the sale itself.
create or replace function public.sale_in_scope(p_sale_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.sales s
     where s.id = p_sale_id
       and s.organization_id in (select public.scope_organization_ids())
  )
$$;

revoke all on function public.sale_in_scope(uuid) from public, anon;
grant execute on function public.sale_in_scope(uuid) to authenticated, service_role;

-- email_config: super admins (the Settings page) and the server only.
drop policy if exists "Service role full access" on public.email_config;
drop policy if exists email_config_super_admin on public.email_config;
create policy email_config_super_admin on public.email_config
  for all to authenticated
  using (public.has_role(auth.uid(), 'super_admin'))
  with check (public.has_role(auth.uid(), 'super_admin'));

-- email_logs: super admins read; the server writes.
drop policy if exists "Service role full access" on public.email_logs;
drop policy if exists email_logs_super_admin_read on public.email_logs;
create policy email_logs_super_admin_read on public.email_logs
  for select to authenticated
  using (public.has_role(auth.uid(), 'super_admin'));

-- payment_models: super admins manage; signed-in users read the active ones.
drop policy if exists super_admin_full_access on public.payment_models;
drop policy if exists payment_models_super_admin on public.payment_models;
create policy payment_models_super_admin on public.payment_models
  for all to authenticated
  using (public.has_role(auth.uid(), 'super_admin'))
  with check (public.has_role(auth.uid(), 'super_admin'));
alter policy authenticated_read_active on public.payment_models to authenticated;

-- organization_payment_models: super admins manage; read within scope.
drop policy if exists super_admin_full_access on public.organization_payment_models;
drop policy if exists org_members_read_own on public.organization_payment_models;
drop policy if exists organization_payment_models_super_admin on public.organization_payment_models;
drop policy if exists organization_payment_models_read_in_scope on public.organization_payment_models;
create policy organization_payment_models_super_admin on public.organization_payment_models
  for all to authenticated
  using (public.has_role(auth.uid(), 'super_admin'))
  with check (public.has_role(auth.uid(), 'super_admin'));
create policy organization_payment_models_read_in_scope on public.organization_payment_models
  for select to authenticated
  using (organization_id in (select public.scope_organization_ids()));

-- installment_payments: super admins manage; read and record within scope
-- (the Record Payment screen inserts from the browser).
drop policy if exists super_admin_full_access on public.installment_payments;
drop policy if exists service_role_access on public.installment_payments;
drop policy if exists org_members_read_own_sales on public.installment_payments;
drop policy if exists org_members_insert_own_sales on public.installment_payments;
drop policy if exists installment_payments_super_admin on public.installment_payments;
drop policy if exists installment_payments_read_in_scope on public.installment_payments;
drop policy if exists installment_payments_insert_in_scope on public.installment_payments;
create policy installment_payments_super_admin on public.installment_payments
  for all to authenticated
  using (public.has_role(auth.uid(), 'super_admin'))
  with check (public.has_role(auth.uid(), 'super_admin'));
create policy installment_payments_read_in_scope on public.installment_payments
  for select to authenticated
  using (public.sale_in_scope(sale_id));
create policy installment_payments_insert_in_scope on public.installment_payments
  for insert to authenticated
  with check (public.sale_in_scope(sale_id));

-- sales_history: rows come only from the create_sales_history trigger, which
-- runs as its owner; nobody inserts through the API. Reads stay as they were,
-- for signed-in users only.
drop policy if exists "System can insert history" on public.sales_history;
alter policy "Users can view their own history" on public.sales_history to authenticated;

commit;
