-- Slice 11c of the 2026-09-02 review (finding F7, the agents page's chart).
--
-- The "Records Collected" chart on the Agents Performance Report paged the
-- whole agent roster through three role loops, then read the sales table
-- twice per two hundred agents (by creator, then by whose behalf), and
-- bucketed the rows by month in the browser with no regard to the year, so
-- every January of every year landed in one bar. One call now answers the
-- twelve months of one year.
--
-- Definition: a record is a live sale created by, or made on behalf of, a
-- profile in one of the agent roles; each sale counts once however many of
-- its two people are agents; its month is the Lagos date of its sale, or of
-- its creation when the sale carries no date. Execute is service_role only;
-- the performance-report edge function serves it behind the agents gate.

create or replace function public.report_agent_records_by_month(p_year integer)
returns jsonb
language sql
stable
parallel safe
set search_path to 'public'
as $$
with agents as (
  select id from public.profiles
   where role in ('acsl_agent', 'acsl_agent_manager', 'super_admin_agent')
),
records as (
  select distinct s.id,
         coalesce(s.sales_date, (s.created_at at time zone 'Africa/Lagos')::date) as on_day
    from public.sales s
   where s.is_archived is not true
     and (s.created_by in (select id from agents) or s.sold_on_behalf_of in (select id from agents))
),
months as (
  select generate_series(1, 12) as m
),
counted as (
  select extract(month from on_day)::int as m, count(*)::int as n
    from records
   where extract(year from on_day)::int = p_year
   group by 1
)
select jsonb_build_object(
  'year', p_year,
  'months', (select jsonb_agg(jsonb_build_object('month', months.m, 'records', coalesce(counted.n, 0)) order by months.m)
               from months left join counted on counted.m = months.m),
  'total', (select coalesce(sum(n), 0)::int from counted),
  'computed_at', now()
);
$$;

comment on function public.report_agent_records_by_month(integer) is
  'The Agents Performance Report chart: live sales created by or on behalf of agent-role profiles, counted once each, by month of one year on Lagos dates. Service role only.';

revoke all on function public.report_agent_records_by_month(integer) from public, anon, authenticated;
grant execute on function public.report_agent_records_by_month(integer) to service_role;
