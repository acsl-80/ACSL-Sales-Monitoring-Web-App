-- A manager's team, the same whoever asks.
--
-- WHAT WAS WRONG
--
-- A manager covers their own partners plus those of the acsl_agents who
-- report to them. scope_organization_ids() and the row rules get this right.
-- Sales Records and Sell Stove do not: their server functions find the team
-- by reading profiles while wearing the signed-in user's token, and a user can
-- read only their own profile row, so the team always came back empty. On
-- 20 Oct this cost one manager 21 partners and 433 sales on Sales Records.
--
-- WHAT THIS DOES
--
-- acsl_agent_team(manager) returns the acsl_agents whose manager_id is that
-- manager, running with its owner's rights so the answer does not depend on
-- what the caller can read. It answers the manager asking about themselves,
-- a super admin, and the service role or a direct database connection; anyone
-- else gets nothing. It returns ids only, so no profile detail is exposed.
-- The server functions call it in place of the profiles read (same PR).
--
-- Undo: drop function public.acsl_agent_team(uuid); the functions then need
-- their previous version deployed.

create or replace function public.acsl_agent_team(p_manager uuid)
 returns table(id uuid)
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select t.id
    from public.profiles t,
         (select auth.uid() as uid, coalesce(auth.role(), '') as role) c
   where t.manager_id = p_manager
     and t.role = 'acsl_agent'
     and (   (c.uid is null and c.role not in ('anon', 'authenticated'))
          or p_manager = c.uid
          or exists (select 1 from public.profiles me
                      where me.id = c.uid
                        and me.role = 'super_admin'))
$function$;

revoke all on function public.acsl_agent_team(uuid) from public, "anon";
grant execute on function public.acsl_agent_team(uuid) to "authenticated", "service_role";
