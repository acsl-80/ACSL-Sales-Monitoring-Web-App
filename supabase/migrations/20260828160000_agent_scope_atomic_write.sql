-- Setting an agent's scope, atomically, in one call.
--
-- WHAT IS WRONG WITH THE CURRENT WRITE PATH
--
-- Two endpoints, each doing delete-then-insert with no transaction:
--
--   organizationOptions.ts  DELETE every row for the agent, then INSERT the
--                           new list in batches of 100.
--   stateOptions.ts         the same shape for states.
--
-- A failure between the delete and the last insert leaves the agent holding
-- part of a list, or nothing at all, with no way back. At 421 partners that is
-- five separate inserts after a full delete.
--
-- Worse, the client fires both endpoints together in a Promise.all, so states
-- and partners are never consistent as a pair even when both succeed. Under
-- the old precedence rule that race could flip an agent's entire coverage,
-- because "has any named partner" decided whether states counted at all.
--
-- One function is one transaction. Both problems go away by construction
-- rather than by adding a transaction to each endpoint and leaving them still
-- racing each other.
--
-- WHAT IT DOES NOT DO
--
-- It does not decide who may call it. Authorisation stays in the edge
-- function, where the caller's role and their scope over the target agent are
-- already known. A SECURITY DEFINER function that also authorised would be a
-- privilege boundary in the least reviewable place in the system.

create or replace function public.acsl_set_agent_scope(
  p_agent_id          uuid,
  p_mode              text,
  p_states            text[],
  p_org_ids           uuid[],
  p_excluded_org_ids  uuid[],
  p_actor             uuid
) returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_role text;
begin
  -- The target must be an agent. Anything else is a caller mistake worth
  -- refusing loudly rather than writing rows nobody will ever read.
  select role into v_role from public.profiles where id = p_agent_id;
  if v_role is null then
    raise exception 'No such profile: %', p_agent_id using errcode = '23503';
  end if;
  if v_role not in ('acsl_agent', 'acsl_agent_manager', 'super_admin_agent') then
    raise exception 'Profile % is a % and cannot hold agent scope', p_agent_id, v_role
      using errcode = '22023';
  end if;

  if p_mode is not null and p_mode not in ('state_coverage', 'explicit_partners') then
    raise exception 'Unknown coverage mode: %', p_mode using errcode = '22023';
  end if;

  insert into public.acsl_agent_scope (agent_id, mode, updated_by, updated_at)
  values (p_agent_id, p_mode, p_actor, now())
  on conflict (agent_id) do update
    set mode = excluded.mode,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at;

  /*
   * Replace all three lists.
   *
   * Deliberately replace rather than merge: the caller sends the whole
   * intended state, which is what the UI has in front of it, and a merge would
   * make "remove this partner" impossible to express.
   *
   * Both modes' rows are kept whichever mode is set. Coverage ignores the ones
   * that do not apply, so an agent switched from state to explicit and back
   * gets exactly what they had. That reversibility is what makes it safe to
   * try a switch on one live account.
   */
  delete from public.acsl_agent_states where agent_id = p_agent_id;
  if p_states is not null and array_length(p_states, 1) > 0 then
    insert into public.acsl_agent_states (agent_id, state, assigned_by)
    select p_agent_id, s, p_actor
      from unnest(p_states) as s
     where btrim(s) <> ''
    on conflict (agent_id, state) do nothing;
  end if;

  delete from public.acsl_agent_organizations where agent_id = p_agent_id;
  if p_org_ids is not null and array_length(p_org_ids, 1) > 0 then
    insert into public.acsl_agent_organizations (agent_id, organization_id, assigned_by)
    select distinct p_agent_id, o, p_actor
      from unnest(p_org_ids) as o
    on conflict (agent_id, organization_id) do nothing;
  end if;

  delete from public.acsl_agent_organization_exclusions where agent_id = p_agent_id;
  if p_excluded_org_ids is not null and array_length(p_excluded_org_ids, 1) > 0 then
    insert into public.acsl_agent_organization_exclusions (agent_id, organization_id, excluded_by)
    select distinct p_agent_id, o, p_actor
      from unnest(p_excluded_org_ids) as o
    on conflict (agent_id, organization_id) do nothing;
  end if;
end;
$$;

comment on function public.acsl_set_agent_scope(uuid, text, text[], uuid[], uuid[], uuid) is
  'Replace an agent''s coverage configuration in one transaction: mode, held states, named partners and exclusions. Replaces the delete-then-insert pairs in organizationOptions.ts and stateOptions.ts, which could leave a partial list and which the client raced against each other. Authorisation is the caller''s job, not this function''s.';

revoke all on function public.acsl_set_agent_scope(uuid, text, text[], uuid[], uuid[], uuid) from "anon", "authenticated";
grant execute on function public.acsl_set_agent_scope(uuid, text, text[], uuid[], uuid[], uuid) to "service_role";
