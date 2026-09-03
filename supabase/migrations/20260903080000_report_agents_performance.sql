-- Slice 10b of the 2026-09-02 review (finding F8, the agents and partners tabs).
--
-- The Agents Performance Report hydrated its rows with two requests per agent
-- (the agent's organisations through an edge function that itself made seven
-- database calls, then a count of the agent's sales) and paged every stove of
-- every assigned partner into the browser. The Partners tab asked for the
-- agents covering each partner one row at a time. These functions answer both
-- in one call each.
--
-- Definitions, the ones the screens already use, stated once:
--   * an agent's partners are the organisations acsl_agent_org_scope() resolves
--     for the agent; the "direct" ones are the explicit assignments, and they
--     are the ones whose stock counts as received. States are the distinct
--     states of every organisation in scope.
--   * received is the live stock (not archived) of the direct partners; sold
--     is the live sales the agent created, wherever they were made; available
--     is received less sold, never below zero. The totals count each partner's
--     stock once however many agents share it.
--   * the agents covering a partner are acsl_agents_covering_org(); for each,
--     sold in that partner is the live sales the agent created there,
--     attended is the sold stock of that partner, unattended its available
--     stock.
--
-- Execute is service_role only; the performance-report edge function calls
-- both with the service client after checking the caller's role.

create or replace function public.report_agents_performance(p_agent_ids uuid[])
returns jsonb
language sql
stable
parallel safe
set search_path to 'public'
as $$
with agents as (
  select p.id, p.role
    from public.profiles p
   where p.id = any(p_agent_ids)
),
acsl_ids as (
  select coalesce(array_agg(id), '{}'::uuid[]) as ids
    from agents
   where role in ('acsl_agent', 'acsl_agent_manager')
),
scope as (
  select s.agent_id, s.organization_id, s.source
    from acsl_ids, public.acsl_agent_org_scope(acsl_ids.ids) s
),
stoves as (
  select b.organization_id, count(*)::int as total
    from public.stove_ids_base b
   where b.is_archived is not true
   group by b.organization_id
),
direct as (
  select agent_id, organization_id from scope where source = 'explicit'
),
states as (
  select sc.agent_id,
         array_agg(distinct btrim(o.state) order by btrim(o.state)) as states
    from scope sc
    join public.organizations o on o.id = sc.organization_id
   where nullif(btrim(o.state), '') is not null
   group by sc.agent_id
),
received as (
  select d.agent_id,
         coalesce(sum(st.total), 0)::int as received,
         count(*)::int as orgs,
         array_agg(d.organization_id) as org_ids
    from direct d
    left join stoves st on st.organization_id = d.organization_id
   group by d.agent_id
),
sold as (
  select s.created_by as agent_id, count(*)::int as sold
    from public.sales s
   where s.is_archived is not true
     and s.created_by = any(p_agent_ids)
   group by s.created_by
),
per_agent as (
  select a.id,
         coalesce(r.received, 0) as received,
         coalesce(so.sold, 0) as sold,
         greatest(0, coalesce(r.received, 0) - coalesce(so.sold, 0)) as available,
         coalesce(r.orgs, 0) as direct_org_count,
         coalesce(r.org_ids, '{}'::uuid[]) as direct_org_ids,
         coalesce(st.states, '{}'::text[]) as states
    from agents a
    left join received r on r.agent_id = a.id
    left join sold so on so.agent_id = a.id
    left join states st on st.agent_id = a.id
),
totals as (
  select (select coalesce(sum(st.total), 0)::int
            from (select distinct organization_id from direct) u
            join stoves st on st.organization_id = u.organization_id) as assigned,
         (select coalesce(sum(sold), 0)::int from per_agent) as sold
)
select jsonb_build_object(
  'agents', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', id,
             'received', received,
             'sold', sold,
             'available', available,
             'direct_org_count', direct_org_count,
             'direct_org_ids', to_jsonb(direct_org_ids),
             'states', to_jsonb(states)
           ))
      from per_agent
  ), '[]'::jsonb),
  'totals', (select jsonb_build_object(
               'assigned', assigned,
               'sold', sold,
               'unsold', greatest(0, assigned - sold)
             ) from totals),
  'computed_at', now()
);
$$;

comment on function public.report_agents_performance(uuid[]) is
  'The Agents Performance Report rows in one call: per agent, received, sold, available, direct partners and states, with the totals across the listed agents. Service role only.';

revoke all on function public.report_agents_performance(uuid[]) from public, anon, authenticated;
grant execute on function public.report_agents_performance(uuid[]) to service_role;


create or replace function public.report_partner_agents(
  p_org_ids    uuid[],
  p_manager_id uuid default null
)
returns jsonb
language sql
stable
parallel safe
set search_path to 'public'
as $$
with orgs as (
  select distinct unnest(p_org_ids) as id
),
-- Every agent with an assignment or a state row, resolved once; filtering the
-- resolved pairs by partner gives exactly what acsl_agents_covering_org()
-- gives per partner, without resolving the scope once per row.
candidates as (
  select agent_id from public.acsl_agent_organizations
  union
  select agent_id from public.acsl_agent_states
),
covering as (
  select s.organization_id, s.agent_id, s.source
    from public.acsl_agent_org_scope(array(select agent_id from candidates)) s
   where s.organization_id = any(p_org_ids)
),
agents as (
  select p.id, p.full_name, p.email, p.phone, p.role, p.status, p.manager_id
    from public.profiles p
   where p.id in (select agent_id from covering)
     and (p_manager_id is null or p.manager_id = p_manager_id or p.id = p_manager_id)
),
org_sales as (
  select s.organization_id,
         s.created_by as agent_id,
         count(distinct s.id)::int as sales,
         coalesce(sum(s.amount), 0) as amount,
         count(b.id)::int as stoves
    from public.sales s
    left join public.stove_ids_base b on b.sale_id = s.id
   where s.organization_id = any(p_org_ids)
     and s.is_archived is not true
     and s.created_by is not null
   group by s.organization_id, s.created_by
),
stock as (
  select b.organization_id,
         count(*) filter (where b.status = 'available')::int as available
    from public.stove_ids_base b
   where b.organization_id = any(p_org_ids)
     and b.is_archived is not true
   group by b.organization_id
)
select coalesce(jsonb_object_agg(o.id, coalesce(list.items, '[]'::jsonb)), '{}'::jsonb)
  from orgs o
  left join lateral (
    select jsonb_agg(jsonb_build_object(
             'id', a.id,
             'full_name', a.full_name,
             'email', a.email,
             'phone', a.phone,
             'role', a.role,
             'status', a.status,
             'source', c.source,
             'partner_sales_count', coalesce(os.sales, 0),
             'partner_sales_amount', coalesce(os.amount, 0),
             'partner_sold_stoves_count', coalesce(os.stoves, 0),
             'partner_attended_count', coalesce(os.stoves, 0),
             'partner_unattended_count', coalesce(st.available, 0)
           ) order by coalesce(os.stoves, 0) desc, a.full_name) as items
      from covering c
      join agents a on a.id = c.agent_id
      left join org_sales os on os.organization_id = c.organization_id and os.agent_id = c.agent_id
      left join stock st on st.organization_id = c.organization_id
     where c.organization_id = o.id
  ) list on true;
$$;

comment on function public.report_partner_agents(uuid[], uuid) is
  'The agents covering each listed partner, with what each sold there and the partner''s stock, keyed by organisation id. A manager id narrows the agents to that manager''s. Service role only.';

revoke all on function public.report_partner_agents(uuid[], uuid) from public, anon, authenticated;
grant execute on function public.report_partner_agents(uuid[], uuid) to service_role;
