-- Does the new coverage rule resolve exactly what the old one does?
--
-- Read-only. Run against production BEFORE deploying any function that calls
-- acsl_agent_org_scope, while the old rule is still the one serving traffic.
-- Then run it again immediately before the create-sale and approve-sale
-- deploys, because a partner created in between legitimately changes what
-- state coverage resolves to and you want to see that rather than discover it.
--
-- THE GATE
--
-- Query 1 must return ZERO ROWS. Not few. Not "only gains". Zero.
--
-- It is deliberately an EXCEPT in both directions, because set equality is the
-- claim. A containment check ("nothing was lost") passes happily while
-- silently widening 48 of the 89 field agents, twenty of them by more than
-- fifty partners. That is the one outcome this whole design exists to prevent,
-- so the check has to be able to fail on it.
--
-- WHY OWN COVERAGE IS ENOUGH
--
-- The resolver's full answer is an agent's own coverage unioned with each
-- subordinate's own coverage. Manager inheritance is not being changed. So if
-- own coverage is identical for every agent, the composed answer is identical
-- too, and comparing own coverage for all agents proves the whole thing.
--
-- WHICH AGENTS TO COMPARE, AND WHY IT IS NOT JUST THE ACSL ROLES
--
-- Three super_admin accounts still hold 1,294 assignment rows between them,
-- almost certainly managers who were promoted and left their rows behind. They
-- are harmless, because super admins bypass scope resolution entirely, and the
-- backfill deliberately does not give them a scope row.
--
-- But the old rule resolves whatever id it is handed, without looking at the
-- role. So comparing only the three ACSL roles compares two different
-- populations and reports 1,183 rows "lost" that were never in play. The first
-- run of this check did exactly that. The population below is every id the
-- resolver could be handed, which also exercises the NULL fallback those three
-- accounts resolve through.

-- ===========================================================================
-- 1. THE GATE. Zero rows, or stop.
-- ===========================================================================

with legacy as (
  -- Transcribed from resolveAssignedOrgIds.ts as deployed: a state expands
  -- only when the agent holds no named partner at all.
  select o.agent_id, o.organization_id
    from public.acsl_agent_organizations o
  union
  select s.agent_id, org.id
    from public.acsl_agent_states s
    join public.organizations org on org.state = s.state
   where s.agent_id not in (select distinct agent_id from public.acsl_agent_organizations)
),
next as (
  select agent_id, organization_id
    from public.acsl_agent_org_scope(
           array(
             select id from public.profiles
              where role in ('acsl_agent', 'acsl_agent_manager', 'super_admin_agent')
             union
             select agent_id from public.acsl_agent_organizations
             union
             select agent_id from public.acsl_agent_states
           )
         )
)
select 'LOST: the new rule does not grant this, the old one did' as problem,
       agent_id, organization_id
  from (select * from legacy except select * from next) a
union all
select 'GAINED: the new rule grants this, the old one did not',
       agent_id, organization_id
  from (select * from next except select * from legacy) b;

-- ===========================================================================
-- 2. Per account, for the PR body. legacy_n must equal next_n on every row.
-- ===========================================================================

with legacy as (
  select o.agent_id, o.organization_id
    from public.acsl_agent_organizations o
  union
  select s.agent_id, org.id
    from public.acsl_agent_states s
    join public.organizations org on org.state = s.state
   where s.agent_id not in (select distinct agent_id from public.acsl_agent_organizations)
),
next as (
  select agent_id, organization_id
    from public.acsl_agent_org_scope(
           array(
             select id from public.profiles
              where role in ('acsl_agent', 'acsl_agent_manager', 'super_admin_agent')
             union
             select agent_id from public.acsl_agent_organizations
             union
             select agent_id from public.acsl_agent_states
           )
         )
)
select p.email,
       p.role,
       sc.mode,
       (select count(*) from legacy l where l.agent_id = p.id) as legacy_n,
       (select count(*) from next   n where n.agent_id = p.id) as next_n,
       (select count(*) from legacy l where l.agent_id = p.id)
         = (select count(*) from next n where n.agent_id = p.id) as agrees
  from public.profiles p
  left join public.acsl_agent_scope sc on sc.agent_id = p.id
 where p.role in ('acsl_agent', 'acsl_agent_manager', 'super_admin_agent')
 order by agrees, legacy_n desc;

-- ===========================================================================
-- 3. Did the backfill reach everyone, and does the stored mode match reality?
-- ===========================================================================

select count(*) filter (where sc.agent_id is null)                    as missing_a_scope_row,
       count(*) filter (where sc.mode = 'explicit_partners')          as explicit,
       count(*) filter (where sc.mode = 'state_coverage')             as state_coverage,
       count(*) filter (where sc.mode is null and sc.agent_id is not null) as null_mode,
       -- A stored mode that disagrees with the legacy derivation would mean
       -- the backfill and the old rule part company for that account.
       count(*) filter (
         where sc.mode is not null
           and sc.mode <> case when exists (select 1 from public.acsl_agent_organizations o
                                             where o.agent_id = p.id)
                               then 'explicit_partners' else 'state_coverage' end
       ) as mode_disagrees_with_legacy
  from public.profiles p
  left join public.acsl_agent_scope sc on sc.agent_id = p.id
 where p.role in ('acsl_agent', 'acsl_agent_manager', 'super_admin_agent');

-- ===========================================================================
-- 4. The snapshot agrees with the legacy rule computed now
-- ===========================================================================
-- Confirms the snapshot table captured what it claims to have captured, so it
-- is worth something as a baseline later.

with legacy_full as (
  select o.agent_id, o.organization_id from public.acsl_agent_organizations o
  union
  select s.agent_id, org.id
    from public.acsl_agent_states s
    join public.organizations org on org.state = s.state
   where s.agent_id not in (select distinct agent_id from public.acsl_agent_organizations)
),
inherited as (
  select p.manager_id as agent_id, lf.organization_id
    from public.profiles p
    join legacy_full lf on lf.agent_id = p.id
   where p.role = 'acsl_agent' and p.manager_id is not null
),
expected as (
  select * from legacy_full union select * from inherited
)
select (select count(*) from (select * from expected except
        select * from public.acsl_scope_snapshot_20260828) x) as snapshot_missing,
       (select count(*) from (select * from public.acsl_scope_snapshot_20260828
        except select * from expected) y) as snapshot_extra;
