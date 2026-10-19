-- Agent coverage resolves the same whoever asks.
--
-- WHAT WAS WRONG
--
-- acsl_agent_org_scope ran with the rights of whoever called it. Its state and
-- every-partner branches read public.organizations, and an ACSL agent or
-- manager can read only their own organization there, which is none. So when a
-- server function asked the question while wearing the signed-in user's token
-- (Sales Records, Sell Stove, editing a sale), every account on state coverage,
-- including every "all partners" manager, resolved to no partners at all and
-- the screen came back empty. Named-partner accounts were unaffected because
-- that branch never touches organizations. Functions that ask with the service
-- key, and scope_organization_ids(), already got the right answer.
--
-- On 19 Oct this was 20 of 26 active managers and 25 of 91 active agents.
--
-- WHAT THIS DOES
--
--   1. The rule runs with the owner's rights, so the answer no longer depends
--      on what the caller can read. The body is unchanged apart from step 2.
--   2. It answers only for agents the caller may ask about: themselves, the
--      acsl_agents who report to them, anyone for a super admin, and anyone
--      for the service role or a direct database connection. Other ids are
--      dropped, which is what those callers already received.
--   3. Execute is held by authenticated and service_role only.
--
-- This reverses the "security invoker, not definer" note in 20260828120000.
-- That note assumed every caller held the service role; Sales Records, Sell
-- Stove and sale edits do not. Step 2 is what keeps the owner's rights from
-- reaching further than the caller may already ask.
--
-- Undo: recreate the function from 20261005120000 section 1 (security
-- invoker) and grant execute back to public.

create or replace function public.acsl_agent_org_scope(p_agent_ids uuid[])
 returns table(agent_id uuid, organization_id uuid, source text)
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  with caller as (
    select auth.uid() as uid, coalesce(auth.role(), '') as role
  ),
  -- Who the caller may ask about. A server function wearing the user's token
  -- arrives as that user; one using the service key, or SQL run directly,
  -- carries no user and may ask about anyone.
  agents as (
    select distinct a.id
      from unnest(p_agent_ids) as a(id), caller c
     where (c.uid is null and c.role not in ('anon', 'authenticated'))
        or a.id = c.uid
        or exists (
             select 1 from public.profiles t
              where t.id = a.id
                and t.manager_id = c.uid
                and t.role = 'acsl_agent'
           )
        or exists (
             select 1 from public.profiles me
              where me.id = c.uid
                and me.role = 'super_admin'
           )
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
  -- Holding every canonical state means every partner. The first condition
  -- keeps an unreadable or empty state list from turning everyone into this.
  everywhere as (
    select e.id
      from effective e
     where e.mode = 'state_coverage'
       and exists (select 1 from public.nigeria_states)
       and not exists (
             select 1 from public.nigeria_states ns
              where not exists (
                      select 1 from public.acsl_agent_states st
                       where st.agent_id = e.id
                         and st.state = ns.name
                    )
           )
  ),
  explicit as (
    select e.id as agent_id, o.organization_id, 'explicit'::text as source
      from effective e
      join public.acsl_agent_organizations o on o.agent_id = e.id
     where e.mode = 'explicit_partners'
  ),
  all_partners as (
    select w.id as agent_id, org.id as organization_id, 'state'::text as source
      from everywhere w
     cross join public.organizations org
     where not exists (
             select 1 from public.acsl_agent_organization_exclusions x
              where x.agent_id = w.id
                and x.organization_id = org.id
           )
  ),
  by_state as (
    select e.id as agent_id, org.id as organization_id, 'state'::text as source
      from effective e
      join public.acsl_agent_states st on st.agent_id = e.id
      join public.organizations org on org.state = st.state
     where e.mode = 'state_coverage'
       and e.id not in (select id from everywhere)
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
    from (
      select * from explicit
      union all select * from all_partners
      union all select * from by_state
    ) u
   group by u.agent_id, u.organization_id
$function$;

revoke all on function public.acsl_agent_org_scope(uuid[]) from public, "anon";
grant execute on function public.acsl_agent_org_scope(uuid[]) to "authenticated", "service_role";
