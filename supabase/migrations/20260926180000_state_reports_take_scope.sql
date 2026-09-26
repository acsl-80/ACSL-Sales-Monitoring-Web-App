-- The state reports take an optional list of organisations.
--
-- Called with no list they answer for every organisation, exactly as before;
-- the performance-report function now passes the caller's scope for everyone
-- but a super admin. Only the organisations filter is new; each body is the
-- live definition otherwise. Both stay service-role only.
--
-- Changes no rows.

begin;

drop function if exists public.report_states_performance();
drop function if exists public.report_state_stoves(text, text, text, integer, integer);

CREATE OR REPLACE FUNCTION public.report_states_performance(p_organization_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE PARALLEL SAFE
 SET search_path TO 'public'
AS $function$
with orgs as (
  select o.id,
         o.partner_name,
         coalesce(nullif(btrim(o.state), ''), 'Unknown') as state,
         coalesce(nullif(o.contact_phone, ''), nullif(o.alternative_phone, '')) as phone
    from public.organizations o
   where p_organization_ids is null
      or o.id = any(p_organization_ids)
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
$function$;

revoke all on function public.report_states_performance(uuid[]) from public, anon, authenticated;
grant execute on function public.report_states_performance(uuid[]) to service_role;

CREATE OR REPLACE FUNCTION public.report_state_stoves(p_state text, p_status text DEFAULT NULL::text, p_search text DEFAULT NULL::text, p_page integer DEFAULT 1, p_limit integer DEFAULT 25, p_organization_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE PARALLEL SAFE
 SET search_path TO 'public'
AS $function$
with bounds as (
  select least(greatest(coalesce(p_limit, 25), 1), 500) as lim,
         greatest(coalesce(p_page, 1), 1) as pg
),
orgs as (
  select o.id, o.partner_name
    from public.organizations o
   where coalesce(nullif(btrim(o.state), ''), 'Unknown') = p_state
     and (p_organization_ids is null or o.id = any(p_organization_ids))
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
$function$;

revoke all on function public.report_state_stoves(text, text, text, integer, integer, uuid[]) from public, anon, authenticated;
grant execute on function public.report_state_stoves(text, text, text, integer, integer, uuid[]) to service_role;

commit;
