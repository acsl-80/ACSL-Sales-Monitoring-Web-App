-- Slice 10a of the 2026-09-02 review (finding F8, the States Performance Report).
--
-- The report pulled every stove and every sale into the browser a thousand
-- rows at a time, paged every user through six role loops, probed two
-- assignment tables column by column, and joined it all in JavaScript. At
-- 22,000 stoves that is some forty requests and two megabytes before the
-- first row renders, and it grows with the table. These two functions
-- compute the same report in the database, once.
--
-- Definitions, stated so the screens agree:
--   * a stove counts when it is not archived; sold means status = 'sold',
--     the rule get_organization_stove_counts and get-stove-stats already use.
--     Not sold is the rest.
--   * a state is the organisation's state, trimmed; blank is 'Unknown'.
--   * an ACSL agent covers a state when acsl_agent_org_scope() resolves the
--     agent to an organisation in it, explicit assignment or state coverage,
--     the same rule the agents screens use. The old report read explicit
--     assignments only.
--   * stoves recorded by an agent are live sales the agent created, by the
--     partner's state. The old report counted archived sales too.
--
-- Rows for the stove modal are paged by report_state_stoves, with a search
-- and a status filter, so the modal and its export hold at any volume.
--
-- Execute is service_role only; the performance-report edge function calls
-- both with the service client after checking the caller's role.

create or replace function public.report_states_performance()
returns jsonb
language sql
stable
parallel safe
set search_path to 'public'
as $$
with orgs as (
  select o.id,
         o.partner_name,
         coalesce(nullif(btrim(o.state), ''), 'Unknown') as state,
         coalesce(nullif(o.contact_phone, ''), nullif(o.alternative_phone, '')) as phone
    from public.organizations o
),
stoves as (
  select b.organization_id,
         count(*)::int as total,
         count(*) filter (where b.status = 'sold')::int as sold
    from public.stove_ids_base b
   where b.is_archived is not true
   group by b.organization_id
),
partner_agents as (
  select o.state, count(*)::int as n
    from public.profiles p
    join orgs o on o.id = p.organization_id
   where p.role in ('partner', 'admin', 'partner_agent', 'agent')
   group by o.state
),
acsl_ids as (
  select array_agg(p.id) as ids
    from public.profiles p
   where p.role in ('acsl_agent', 'acsl_agent_manager')
),
acsl as (
  select distinct s.agent_id, o.state
    from acsl_ids, public.acsl_agent_org_scope(acsl_ids.ids) s
    join orgs o on o.id = s.organization_id
),
acsl_by_state as (
  select state, count(*)::int as n from acsl group by state
),
agent_states as (
  select agent_id, array_agg(state order by state) as states from acsl group by agent_id
),
recorded as (
  select s.created_by as agent_id, o.state, count(*)::int as n
    from public.sales s
    join orgs o on o.id = s.organization_id
   where s.is_archived is not true
     and s.created_by is not null
   group by s.created_by, o.state
),
partner_details as (
  select o.state,
         count(*)::int as partners,
         coalesce(sum(st.total), 0)::int as stoves,
         coalesce(sum(st.sold), 0)::int as sold,
         jsonb_agg(jsonb_build_object(
           'id', o.id,
           'name', o.partner_name,
           'phone', o.phone,
           'total_stoves', coalesce(st.total, 0),
           'stoves_sold', coalesce(st.sold, 0),
           'stoves_available', coalesce(st.total, 0) - coalesce(st.sold, 0)
         ) order by o.partner_name) as items
    from orgs o
    left join stoves st on st.organization_id = o.id
   group by o.state
),
agent_details as (
  select a.state,
         jsonb_agg(jsonb_build_object(
           'id', a.agent_id,
           'name', coalesce(nullif(p.full_name, ''), p.email, 'Unknown'),
           'role', p.role,
           'states_covered', to_jsonb(coalesce(ast.states, '{}'::text[])),
           'stoves_recorded', coalesce(r.n, 0)
         ) order by coalesce(nullif(p.full_name, ''), p.email)) as items
    from acsl a
    join public.profiles p on p.id = a.agent_id
    left join agent_states ast on ast.agent_id = a.agent_id
    left join recorded r on r.agent_id = a.agent_id and r.state = a.state
   group by a.state
),
states as (
  select distinct state from orgs
)
select jsonb_build_object(
  'states', coalesce((
    select jsonb_agg(jsonb_build_object(
             'state', s.state,
             'partners', coalesce(pd.partners, 0),
             'partner_agents', coalesce(pa.n, 0),
             'acsl_agents', coalesce(ab.n, 0),
             'stoves', coalesce(pd.stoves, 0),
             'sold', coalesce(pd.sold, 0),
             'not_sold', coalesce(pd.stoves, 0) - coalesce(pd.sold, 0),
             'partner_details', coalesce(pd.items, '[]'::jsonb),
             'agent_details', coalesce(ad.items, '[]'::jsonb)
           ) order by s.state)
      from states s
      left join partner_details pd on pd.state = s.state
      left join partner_agents pa on pa.state = s.state
      left join acsl_by_state ab on ab.state = s.state
      left join agent_details ad on ad.state = s.state
  ), '[]'::jsonb),
  'covered_states', coalesce((select jsonb_agg(distinct state) from acsl), '[]'::jsonb),
  'computed_at', now()
);
$$;

comment on function public.report_states_performance() is
  'The States Performance Report in one call: per state, partners, agents, stoves and sold, with the partner and agent detail lists the modals show. Service role only.';

revoke all on function public.report_states_performance() from public, anon, authenticated;
grant execute on function public.report_states_performance() to service_role;


create or replace function public.report_state_stoves(
  p_state  text,
  p_status text    default null,
  p_search text    default null,
  p_page   integer default 1,
  p_limit  integer default 25
)
returns jsonb
language sql
stable
parallel safe
set search_path to 'public'
as $$
with bounds as (
  select least(greatest(coalesce(p_limit, 25), 1), 500) as lim,
         greatest(coalesce(p_page, 1), 1) as pg
),
orgs as (
  select o.id, o.partner_name
    from public.organizations o
   where coalesce(nullif(btrim(o.state), ''), 'Unknown') = p_state
),
base as (
  select b.stove_id, o.partner_name, b.status
    from public.stove_ids_base b
    join orgs o on o.id = b.organization_id
   where b.is_archived is not true
     and (p_status is null or p_status = 'all' or b.status = p_status)
     and (p_search is null or btrim(p_search) = ''
          or b.stove_id ilike '%' || btrim(p_search) || '%'
          or o.partner_name ilike '%' || btrim(p_search) || '%')
),
page as (
  select stove_id, partner_name, status
    from base, bounds
   order by stove_id
  offset (select (pg - 1) * lim from bounds)
   limit (select lim from bounds)
)
select jsonb_build_object(
  'total', (select count(*) from base),
  'rows', coalesce((
    select jsonb_agg(jsonb_build_object(
             'stove_id', stove_id,
             'partner_name', partner_name,
             'status', status
           ) order by stove_id)
      from page
  ), '[]'::jsonb)
);
$$;

comment on function public.report_state_stoves(text, text, text, integer, integer) is
  'One page of the stoves in a state for the States Performance Report modal: search, status filter, page and limit (at most 500). Service role only.';

revoke all on function public.report_state_stoves(text, text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.report_state_stoves(text, text, text, integer, integer) to service_role;
