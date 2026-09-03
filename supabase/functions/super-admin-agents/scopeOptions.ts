/**
 * Reading and writing an agent's coverage configuration as one thing.
 *
 * The old shape was two endpoints, `POST /{id}/organizations` and
 * `POST /{id}/states`, each doing delete-then-insert with no transaction, and
 * a client that fired both together in a Promise.all. So a failure could leave
 * a partial list, and even on success the two tables were never written as a
 * pair.
 *
 * One call, one transaction, one intended state. `public.acsl_set_agent_scope`
 * does the writing; this decides who is allowed to ask.
 */

type ManagerScope = string | null;

/**
 * May this caller change this agent's scope?
 *
 * A super admin may change anyone's. A manager may change their own, or that
 * of an acsl_agent reporting to them.
 *
 * This check is the reason the function exists as a separate step. The four
 * pre-existing assignment routes authenticate the caller as manager-or-admin
 * and then act on whatever `agentId` is in the URL, with no check that the
 * target is theirs. Every other manager-scoped route passes a managerScopeId;
 * those four do not, so today any of the sixteen managers can rewrite any
 * other agent's partners, including another manager's.
 */
export async function assertMayEditScope(
  supabase: any,
  agentId: string,
  actorId: string,
  managerScopeId: ManagerScope,
): Promise<void> {
  const { data: target, error } = await supabase
    .from("profiles")
    .select("id, role, manager_id")
    .eq("id", agentId)
    .maybeSingle();

  if (error) throw new Error(`Database error: ${error.message}`);
  if (!target) throw new Error("Agent not found");

  if (!["acsl_agent", "acsl_agent_manager", "super_admin_agent"].includes(target.role)) {
    throw new Error("validation: only ACSL agents and managers hold partner scope");
  }

  // managerScopeId is null for a super admin, who may edit anyone.
  if (managerScopeId) {
    const ownScope = target.id === actorId;
    const reportsToCaller = target.manager_id === managerScopeId;
    if (!ownScope && !reportsToCaller) {
      throw new Error("Unauthorized: that agent does not report to you");
    }
  }
}

/** What the admin screens need to render the current configuration. */
export async function getAgentScope(supabase: any, agentId: string) {
  const [{ data: scope }, { data: states }, { data: orgs }, { data: exclusions }] =
    await Promise.all([
      supabase.from("acsl_agent_scope").select("mode, updated_at, updated_by")
        .eq("agent_id", agentId).maybeSingle(),
      supabase.from("acsl_agent_states").select("state").eq("agent_id", agentId).order("state"),
      supabase.from("acsl_agent_organizations").select("organization_id").eq("agent_id", agentId),
      supabase.from("acsl_agent_organization_exclusions").select("organization_id")
        .eq("agent_id", agentId),
    ]);

  /*
   * `mode` may legitimately be null, meaning this agent has no scope row and
   * resolves the way the pre-change code did. The UI needs to be able to tell
   * that apart from "state coverage with nothing assigned", so it is reported
   * rather than defaulted here.
   */
  return {
    mode: scope?.mode ?? null,
    updated_at: scope?.updated_at ?? null,
    updated_by: scope?.updated_by ?? null,
    states: (states ?? []).map((r: any) => r.state),
    organization_ids: (orgs ?? []).map((r: any) => r.organization_id),
    excluded_organization_ids: (exclusions ?? []).map((r: any) => r.organization_id),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_SCOPE_IDS = 500;

/**
 * Several agents' scopes in one call: states, resolved organisations,
 * exclusions and mode per agent, plus the direct assignment rows when asked
 * (`with_assignments=true`, for one agent's edit form). Slice 10c of the
 * 2026-09-02 review; the SQL is public.agent_scopes.
 */
export async function getAgentScopes(supabase: any, params: URLSearchParams) {
  const ids = [
    ...new Set(
      String(params.get("ids") ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter((s) => UUID.test(s)),
    ),
  ].slice(0, MAX_SCOPE_IDS);
  if (ids.length === 0) return { message: "No agents named", data: {} };
  const { data, error } = await supabase.rpc("agent_scopes", {
    p_agent_ids: ids,
    p_with_assignments: params.get("with_assignments") === "true",
  });
  if (error) throw new Error(`Database error: ${error.message}`);
  return { message: `Scopes for ${ids.length} agent(s)`, data: data ?? {} };
}

/** Replace the whole configuration, in one transaction. */
export async function setAgentScope(
  supabase: any,
  agentId: string,
  body: any,
  actorId: string,
  managerScopeId: ManagerScope = null,
) {
  await assertMayEditScope(supabase, agentId, actorId, managerScopeId);

  const mode: string | null = body?.mode ?? null;
  if (mode !== null && mode !== "state_coverage" && mode !== "explicit_partners") {
    throw new Error(`validation: unknown coverage mode "${mode}"`);
  }

  /*
   * The "validation:" prefix is load-bearing: index.ts maps it to a 400 and
   * everything else to a 500. Without it a malformed request reports an
   * internal error, which sends whoever hit it looking in the wrong place.
   *
   * Missing keys are refused rather than treated as empty.
   *
   * The routes this replaces default a missing body key to [], so a malformed
   * request silently cleared every assignment the agent had. Requiring the
   * caller to send the whole intended state means "clear it" has to be said
   * out loud, as [].
   */
  for (const key of ["states", "organization_ids", "excluded_organization_ids"]) {
    if (!Array.isArray(body?.[key])) {
      throw new Error(`validation: ${key} must be an array. Send [] to clear it.`);
    }
  }

  const { error } = await supabase.rpc("acsl_set_agent_scope", {
    p_agent_id: agentId,
    p_mode: mode,
    p_states: body.states,
    p_org_ids: body.organization_ids,
    p_excluded_org_ids: body.excluded_organization_ids,
    p_actor: actorId,
  });
  if (error) throw new Error(`Failed to set scope: ${error.message}`);

  console.log(
    `✅ Scope set for ${agentId}: mode=${mode ?? "legacy"}, ${body.states.length} states, ` +
      `${body.organization_ids.length} named, ${body.excluded_organization_ids.length} excluded`
  );

  return await getAgentScope(supabase, agentId);
}
