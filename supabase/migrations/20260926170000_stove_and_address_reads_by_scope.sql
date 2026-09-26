-- Stove records, customer addresses and instalments are read within each account's scope.
--
-- Super admins read every row. Everyone else reads the stove records of the
-- organisations public.scope_organization_ids() gives them, and the addresses
-- of sales in those organisations. The stove_ids view now runs with the
-- caller's rights, so the base table's rule applies through it. Writes stay
-- with the server (no insert or update grant for signed-in users since
-- 20260924234000); the policies that would have allowed them are removed so a
-- future grant cannot reopen them.
--
-- Changes no rows. Every statement is re-runnable.

begin;

-- The sales and addresses an account may see, as sets, so a policy computes the
-- account's scope once per query rather than once per row. Security definer,
-- so the caller needs no read access to sales to be answered.
create or replace function public.scope_sale_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select s.id
    from public.sales s
   where s.organization_id in (select public.scope_organization_ids())
$$;

revoke all on function public.scope_sale_ids() from public, anon;
grant execute on function public.scope_sale_ids() to authenticated, service_role;

create or replace function public.scope_address_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select distinct s.address_id
    from public.sales s
   where s.address_id is not null
     and s.organization_id in (select public.scope_organization_ids())
$$;

revoke all on function public.scope_address_ids() from public, anon;
grant execute on function public.scope_address_ids() to authenticated, service_role;

-- stove_ids_base
drop policy if exists "Authenticated and service role can select stove_ids" on public.stove_ids_base;
drop policy if exists "Authenticated and service role can update stove_ids" on public.stove_ids_base;
drop policy if exists "Allow organization members to insert stove_ids" on public.stove_ids_base;
drop policy if exists stove_ids_read_in_scope on public.stove_ids_base;
create policy stove_ids_read_in_scope on public.stove_ids_base
  for select to authenticated
  using (
    public.has_role(auth.uid(), 'super_admin')
    or organization_id in (select public.scope_organization_ids())
  );

alter view public.stove_ids set (security_invoker = true);

-- addresses
drop policy if exists authenticated_users_read_addresses on public.addresses;
drop policy if exists authenticated_users_insert_addresses on public.addresses;
drop policy if exists addresses_read_in_scope on public.addresses;
create policy addresses_read_in_scope on public.addresses
  for select to authenticated
  using (
    public.has_role(auth.uid(), 'super_admin')
    or id in (select public.scope_address_ids())
  );

-- installment_payments: the same read rule as a set, replacing the per-row
-- check from 20260926150000 (inserts keep public.sale_in_scope, one row each).
drop policy if exists installment_payments_read_in_scope on public.installment_payments;
create policy installment_payments_read_in_scope on public.installment_payments
  for select to authenticated
  using (sale_id in (select public.scope_sale_ids()));

commit;
