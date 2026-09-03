-- Slice 10c of the 2026-09-02 review (finding F9, User Management).
--
-- User Management asked the agents function for every manager's states and
-- organisations one manager at a time (two requests each, 46 for today's 23
-- managers) to know which manager covers which partner, and asked three more
-- times when an agent's edit form opened, after probing an assignment table
-- column by column for a column that has always been agent_id. This function
-- answers every agent in one call.
--
-- Per agent: the states assigned to them, the organisations their scope
-- resolves to (acsl_agent_org_scope, the rule every screen uses), the direct
-- assignment rows with who assigned them, the partners carved out of a state
-- coverage, and the scope mode. Execute is service_role only; the
-- super-admin-agents function serves it behind its manager-or-admin gate.

create or replace function public.agent_scopes(
  p_agent_ids        uuid[],
  p_with_assignments boolean default false
)
returns jsonb
language sql
stable
parallel safe
set search_path to 'public'
as $$
with agents as (
  select distinct unnest(p_agent_ids) as id
),
scope as (
  select s.agent_id, s.organization_id, s.source
    from public.acsl_agent_org_scope(array(select id from agents)) s
),
states as (
  select st.agent_id, array_agg(distinct st.state order by st.state) as states
    from public.acsl_agent_states st
   where st.agent_id = any(p_agent_ids)
   group by st.agent_id
),
orgs as (
  select sc.agent_id, array_agg(sc.organization_id order by sc.organization_id) as org_ids
    from scope sc
   group by sc.agent_id
),
direct as (
  select o.agent_id,
         count(*)::int as n,
         jsonb_agg(jsonb_build_object('organization_id', o.organization_id, 'assigned_by', o.assigned_by)
                   order by o.organization_id) as rows
    from public.acsl_agent_organizations o
   where o.agent_id = any(p_agent_ids)
   group by o.agent_id
),
excluded as (
  select x.agent_id, array_agg(x.organization_id order by x.organization_id) as org_ids
    from public.acsl_agent_organization_exclusions x
   where x.agent_id = any(p_agent_ids)
   group by x.agent_id
),
modes as (
  select a.id as agent_id,
         coalesce(m.mode,
                  case when exists (select 1 from public.acsl_agent_organizations o where o.agent_id = a.id)
                       then 'explicit_partners' else 'state_coverage' end) as mode
    from agents a
    left join public.acsl_agent_scope m on m.agent_id = a.id
)
select coalesce(jsonb_object_agg(a.id, jsonb_build_object(
         'states', to_jsonb(coalesce(st.states, '{}'::text[])),
         'organization_ids', to_jsonb(coalesce(o.org_ids, '{}'::uuid[])),
         -- The assignment rows carry who assigned each partner; a manager map
         -- does not need them and they weigh more than everything else together.
         'direct_assignments', case when p_with_assignments then coalesce(d.rows, '[]'::jsonb) else '[]'::jsonb end,
         'direct_count', coalesce(d.n, 0),
         'excluded_organization_ids', to_jsonb(coalesce(x.org_ids, '{}'::uuid[])),
         'mode', md.mode
       )), '{}'::jsonb)
  from agents a
  left join states st on st.agent_id = a.id
  left join orgs o on o.agent_id = a.id
  left join direct d on d.agent_id = a.id
  left join excluded x on x.agent_id = a.id
  left join modes md on md.agent_id = a.id;
$$;

comment on function public.agent_scopes(uuid[], boolean) is
  'Each listed agent''s states, resolved organisations, exclusions and scope mode, keyed by agent id; with the direct assignment rows and their assigner when asked. Service role only.';

revoke all on function public.agent_scopes(uuid[], boolean) from public, anon, authenticated;
grant execute on function public.agent_scopes(uuid[], boolean) to service_role;
