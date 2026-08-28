-- Agent coverage: the rule, in one place, plus the backfill that freezes
-- today's behaviour as data.
--
-- Still nothing calls this. The resolver change that starts using it is a
-- separate PR, deliberately, so the rule can be proved equivalent to the
-- existing one while the existing one is still the thing serving traffic.
--
-- THE RULE
--
--   explicit_partners : exactly the rows in acsl_agent_organizations.
--   state_coverage    : every organization whose state the agent holds,
--                       minus anything in acsl_agent_organization_exclusions,
--                       and therefore including organizations created later.
--   NULL              : resolve the way the current code does, which is
--                       explicit when any named partner exists and state
--                       coverage otherwise.
--
-- The NULL branch is not a courtesy. It means an agent whose row is missing,
-- or written by older code mid-deploy, resolves identically under the old and
-- new resolvers. Equivalence stops depending on the backfill being complete.

-- ---------------------------------------------------------------------------
-- 1. One agent's coverage
-- ---------------------------------------------------------------------------
--
-- Takes an array rather than one id so the callers that resolve a page of
-- agents at a time can use this instead of hand-rolling their own per-agent
-- maps. That is what lets the duplicated copies of this rule be deleted rather
-- than merely re-expressed elsewhere.
--
-- Own coverage only. Manager inheritance from subordinates stays in the
-- resolver, where it already lives, because it is composition rather than the
-- rule itself: a manager's set is the union of their own and each
-- subordinate's, and each of those is this function.
--
-- security invoker, not definer. A function that resolves permissions must not
-- also bypass the row security on the tables it reads. Every current caller
-- holds the service role already.

create or replace function public.acsl_agent_org_scope(p_agent_ids uuid[])
returns table (agent_id uuid, organization_id uuid, source text)
language sql
stable
security invoker
set search_path = public
as $$
  with agents as (
    select distinct unnest(p_agent_ids) as id
  ),
  effective as (
    select a.id,
           coalesce(
             s.mode,
             case when exists (
                    select 1 from public.acsl_agent_organizations o
                     where o.agent_id = a.id
                  )
                  then 'explicit_partners'
                  else 'state_coverage'
             end
           ) as mode
      from agents a
      left join public.acsl_agent_scope s on s.agent_id = a.id
  ),
  explicit as (
    select e.id as agent_id, o.organization_id, 'explicit'::text as source
      from effective e
      join public.acsl_agent_organizations o on o.agent_id = e.id
     where e.mode = 'explicit_partners'
  ),
  by_state as (
    select e.id as agent_id, org.id as organization_id, 'state'::text as source
      from effective e
      join public.acsl_agent_states st on st.agent_id = e.id
      join public.organizations org on org.state = st.state
     where e.mode = 'state_coverage'
       and not exists (
             select 1 from public.acsl_agent_organization_exclusions x
              where x.agent_id = e.id
                and x.organization_id = org.id
           )
  )
  -- An agent resolves under exactly one branch, so the union cannot produce
  -- two sources for one pair. Grouping is belt and braces against a future
  -- branch being added without thinking about it.
  select u.agent_id, u.organization_id, min(u.source) as source
    from (select * from explicit union all select * from by_state) u
   group by u.agent_id, u.organization_id
$$;

comment on function public.acsl_agent_org_scope(uuid[]) is
  'Which organizations each given agent covers, and whether by explicit assignment or by state. Own coverage only; manager inheritance is composed by the caller. The single definition of the coverage rule.';

-- ---------------------------------------------------------------------------
-- 2. The same question asked backwards
-- ---------------------------------------------------------------------------
--
-- "Which agents cover this partner?" cannot be answered efficiently by running
-- the forward function over every agent, so it gets its own definition. Kept
-- in the same migration as its twin so the two are reviewed together and
-- cannot quietly drift apart, which is precisely what happened to the four
-- hand-written copies of the old rule.

create or replace function public.acsl_agents_covering_org(p_org_id uuid)
returns table (agent_id uuid, source text)
language sql
stable
security invoker
set search_path = public
as $$
  with candidates as (
    select o.agent_id from public.acsl_agent_organizations o where o.organization_id = p_org_id
    union
    select s.agent_id
      from public.acsl_agent_states s
      join public.organizations org on org.id = p_org_id and org.state = s.state
  ),
  scoped as (
    select * from public.acsl_agent_org_scope(array(select agent_id from candidates))
  )
  select sc.agent_id, sc.source
    from scoped sc
   where sc.organization_id = p_org_id
$$;

comment on function public.acsl_agents_covering_org(uuid) is
  'Which agents cover one organization, by the same rule as acsl_agent_org_scope, so the forward and reverse answers cannot disagree. Honours exclusions, which the hand-written reverse query it replaces did not.';

-- ---------------------------------------------------------------------------
-- 3. Backfill: today's behaviour, frozen as data
-- ---------------------------------------------------------------------------
--
-- Not a judgement about how anyone ought to be scoped. This is the existing
-- condition in resolveAssignedOrgIds evaluated once and stored:
--
--     if (assignedStates.length > 0 && directOrgIds.length === 0)
--
-- An agent holding any named partner is explicit, because that is what the
-- running code does with them today. An agent holding none is state coverage,
-- which is also what the running code does. Nobody moves.
--
-- This matters because 48 of the 89 field agents hold both a state and a small
-- named list. Unioning the two would expand 20 of them by more than fifty
-- partners, several from one partner to a hundred and thirty six. Whether any
-- of them should be widened is a decision for a person, taken one account at a
-- time, after this ships.

insert into public.acsl_agent_scope (agent_id, mode, updated_by)
select p.id,
       case when exists (select 1 from public.acsl_agent_organizations o where o.agent_id = p.id)
            then 'explicit_partners'
            else 'state_coverage'
       end,
       null
  from public.profiles p
 where p.role in ('acsl_agent', 'acsl_agent_manager', 'super_admin_agent')
on conflict (agent_id) do nothing;

-- ---------------------------------------------------------------------------
-- 4. What coverage looked like before any of this
-- ---------------------------------------------------------------------------
--
-- Once the old resolver is gone there is no way to answer "did anything shift
-- overnight?" except against a record of what was true beforehand. A few
-- thousand rows. Dropped once the change has been live long enough to trust.
--
-- Transcribed from the deployed resolver, including manager inheritance and
-- the per-subordinate application of the same precedence rule.

create table if not exists public."acsl_scope_snapshot_20260828" as
  with direct as (
    select agent_id, organization_id from public.acsl_agent_organizations
  ),
  has_direct as (
    select distinct agent_id from direct
  ),
  state_resolved as (
    select s.agent_id, o.id as organization_id
      from public.acsl_agent_states s
      join public.organizations o on o.state = s.state
     where s.agent_id not in (select agent_id from has_direct)
  ),
  own as (
    select * from direct
    union
    select * from state_resolved
  ),
  inherited as (
    select p.manager_id as agent_id, own.organization_id
      from public.profiles p
      join own on own.agent_id = p.id
     where p.role = 'acsl_agent' and p.manager_id is not null
  )
  select * from own
  union
  select * from inherited;

comment on table public."acsl_scope_snapshot_20260828" is
  'Effective agent coverage as resolved by the pre-change code, captured before anything started using acsl_agent_org_scope. The only baseline available once the old rule is deleted. Drop after the change has been trusted for a while.';

revoke all on public."acsl_scope_snapshot_20260828" from "anon", "authenticated";
grant select on public."acsl_scope_snapshot_20260828" to "service_role";
