-- Partner agents read their own sales; their organisation's stock stays visible.
--
-- ACCESS_CONTROL.md: a partner agent sees their own sales and the records that
-- hang off them, while stove inventory stays scoped to the whole organisation.
-- A sale is theirs when they created it or it was sold on their behalf. The
-- organisation-wide sales read no longer applies to them, and the scope sets
-- that drive instalments, addresses and history narrow the same way. Every
-- helper is read once per query, not once per row.
--
-- Changes no rows. Every statement is re-runnable.

begin;

create or replace function public.is_own_sales_only()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.profiles p
     where p.id = auth.uid()
       and p.role in ('partner_agent', 'agent')
  )
$$;

revoke all on function public.is_own_sales_only() from public, anon;
grant execute on function public.is_own_sales_only() to authenticated, service_role;

create or replace function public.scope_sale_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  with me as (select public.is_own_sales_only() as own, auth.uid() as uid)
  select s.id
    from public.sales s, me
   where s.organization_id in (select public.scope_organization_ids())
     and (not me.own or s.created_by = me.uid or s.sold_on_behalf_of = me.uid)
$$;

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
       and s.id in (select public.scope_sale_ids())
  )
$$;

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
     and s.id in (select public.scope_sale_ids())
$$;

-- sales: the organisation-wide read is for partners, not partner agents, who
-- read the sales they created (users_own_sales) or that were sold for them.
alter policy users_org_sales on public.sales
  using (
    organization_id in (
      select profiles.organization_id
        from public.profiles
       where profiles.id = auth.uid()
       limit 1
    )
    and not (select public.is_own_sales_only())
  );

drop policy if exists sales_sold_on_behalf_read on public.sales;
create policy sales_sold_on_behalf_read on public.sales
  for select to authenticated
  using (sold_on_behalf_of = auth.uid());

-- sales_history: the same split.
alter policy "Users can view their own history" on public.sales_history
  using (
    performed_by = auth.uid()
    or (
      not (select public.is_own_sales_only())
      and exists (
        select 1
          from public.sales s
         where s.id = sales_history.sale_id
           and s.organization_id in (
             select profiles.organization_id
               from public.profiles
              where profiles.id = auth.uid()
           )
      )
    )
    or (
      (select public.is_own_sales_only())
      and sale_id in (select public.scope_sale_ids())
    )
  );

commit;
