-- ===========================================================================
-- The dashboard's numbers come from SQL.
--
-- Slice 6a of the 2026-09-02 review (findings F1, F2, F3). The three dashboard
-- functions (get-super-admin-dashboard, get-dashboard-stats,
-- super-admin-agent-dashboard) fetched every sale in the period into the edge
-- function and summed there. PostgREST stops an unranged select at 1,000 rows
-- (max_rows in supabase/config.toml), so once a scope passed a thousand sales
-- the money cards, the state table and the model donut were computed from the
-- first thousand and presented as totals. On 2026-09-02 production held 2,039
-- live sales: the donut centre read 1,000, Expected Receivable read
-- 44,155,700 naira against a true 87,826,000.
--
-- One function, one base filter, one period, every number: count, receivable,
-- received, owing, by state, by partner, by agent, by model, by month. Each
-- caller passes its own scope and keeps its own response shape; percentages
-- are still worked out in the caller from these counts, so nothing the mobile
-- app reads changes.
--
-- THREE RULES ARE NOW THE SAME EVERYWHERE, and each was checked against
-- production first (2026-09-03):
--   is_archived is not true. The host used = false, which drops a NULL; the
--     Data Center uses is not true. Zero NULLs today, so no figure moves.
--   received is what was collected, total_paid, for outright sales too. Two
--     of the three functions assumed an outright sale was paid in full; the
--     Paid badge stopped assuming that in slice 2. No outright sale differs
--     today, so no figure moves.
--   a sale with no state counts under "Unknown"; a sale with no amount still
--     counts. One function dropped both from its charts. Zero of either today.
--
-- SCOPE. The scope parameters OR together within the row set, which is
-- exactly the manager case: every sale of an assigned organisation plus every
-- sale the team recorded elsewhere, each sale counted once. With no scope
-- parameter the row set is every live sale, which is the super admin's view
-- before the partner, state and branch filters narrow it.
--
-- PERIOD. Inclusive dates, or a set of years for a non-contiguous selection.
-- sold_cumulative is the count before an exclusive date with no lower bound,
-- the balance-sheet count two callers already keep; without it, it is the
-- count of the whole scope.
--
-- ACCESS. Service role only. The edge functions decide who sees what, as they
-- do today; nothing signed in can call this directly.
-- ===========================================================================

create or replace function public.dashboard_sales_summary(
  p_organization_ids uuid[] default null,
  p_agent_ids uuid[] default null,
  p_team_ids uuid[] default null,
  p_partner_names text[] default null,
  p_state text default null,
  p_branch text default null,
  p_date_from date default null,
  p_date_to date default null,
  p_years integer[] default null,
  p_sold_before date default null,
  p_top_n integer default 5
)
returns jsonb
language sql
stable
parallel safe
set search_path to 'public'
as $$
with scoped as (
  select s.id, s.sales_date, s.amount, s.total_paid, s.is_installment,
         s.payment_status, s.state_backup, s.partner_name, s.retailer_branch,
         s.payment_model_id, s.created_by
    from public.sales s
   where s.is_archived is not true
     and (
           (p_organization_ids is null and p_agent_ids is null and p_team_ids is null)
        or s.organization_id = any(p_organization_ids)
        or s.sold_on_behalf_of = any(p_agent_ids)
        or (s.sold_on_behalf_of is null and s.created_by = any(p_agent_ids))
        or s.sold_on_behalf_of = any(p_team_ids)
        or s.created_by = any(p_team_ids)
         )
     and (p_partner_names is null or s.partner_name = any(p_partner_names))
     and (p_state is null or s.state_backup ilike p_state)
     and (p_branch is null or s.retailer_branch = p_branch)
),
period as (
  select *
    from scoped s
   where (p_years is null or extract(year from s.sales_date)::integer = any(p_years))
     and (p_date_from is null or s.sales_date >= p_date_from)
     and (p_date_to is null or s.sales_date <= p_date_to)
),
by_state as (
  select coalesce(nullif(state_backup, ''), 'Unknown') as state, count(*)::integer as n
    from period
   group by 1
),
by_partner as (
  select coalesce(nullif(btrim(partner_name), ''), 'Unknown') as name,
         nullif(btrim(retailer_branch), '') as branch,
         count(*)::integer as n
    from period
   group by 1, 2
),
by_agent as (
  select p.created_by,
         coalesce(nullif(pr.full_name, ''), nullif(pr.username, ''), nullif(pr.email, ''), 'Unknown') as name,
         count(*)::integer as n
    from period p
    left join public.profiles pr on pr.id = p.created_by
   where p.created_by is not null
   group by p.created_by, pr.full_name, pr.username, pr.email
),
by_model as (
  select case when p.payment_model_id is null then 'Outright'
              else coalesce(nullif(pm.name, ''), 'Other') end as model,
         count(*)::integer as n
    from period p
    left join public.payment_models pm on pm.id = p.payment_model_id
   group by 1
),
by_month as (
  select to_char(date_trunc('month', sales_date), 'YYYY-MM') as month,
         count(*)::integer as n,
         coalesce(sum(amount), 0) as amount,
         coalesce(sum(total_paid), 0) as received
    from period
   group by date_trunc('month', sales_date)
)
select jsonb_build_object(
  'total',               (select count(*) from period),
  'sold_cumulative',     (select count(*) from scoped
                           where p_sold_before is null or sales_date < p_sold_before),
  'expected_receivable', (select coalesce(sum(amount), 0) from period),
  'amount_received',     (select coalesce(sum(total_paid), 0) from period),
  'customers_owing',     (select count(*) from period
                           where is_installment and payment_status is distinct from 'fully_paid'),
  'by_state',   (select coalesce(jsonb_agg(jsonb_build_object('state', state, 'count', n)
                                           order by n desc, state), '[]'::jsonb)
                   from by_state),
  'by_partner', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'branch', branch, 'count', n)
                                           order by n desc, name, branch), '[]'::jsonb)
                   from (select * from by_partner order by n desc, name, branch limit p_top_n) t),
  'by_agent',   (select coalesce(jsonb_agg(jsonb_build_object('id', created_by, 'name', name, 'count', n)
                                           order by n desc, name), '[]'::jsonb)
                   from (select * from by_agent order by n desc, name limit p_top_n) t),
  'by_model',   (select coalesce(jsonb_agg(jsonb_build_object('model', model, 'count', n)
                                           order by n desc, model), '[]'::jsonb)
                   from by_model),
  'by_month',   (select coalesce(jsonb_agg(jsonb_build_object('month', month, 'count', n,
                                                              'amount', amount, 'received', received)
                                           order by month), '[]'::jsonb)
                   from by_month)
);
$$;

comment on function public.dashboard_sales_summary(uuid[], uuid[], uuid[], text[], text, text, date, date, integer[], date, integer) is
  'Every dashboard number over live sales (is_archived is not true) for one scope and one period, computed in SQL so no figure depends on how many rows an edge function could fetch. Slice 6a of the 2026-09-02 review.';

revoke all on function public.dashboard_sales_summary(uuid[], uuid[], uuid[], text[], text, text, date, date, integer[], date, integer)
  from public, anon, authenticated;
grant execute on function public.dashboard_sales_summary(uuid[], uuid[], uuid[], text[], text, text, date, date, integer[], date, integer)
  to service_role;
