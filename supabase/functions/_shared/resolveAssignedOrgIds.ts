/**
 * Shared helper: which organizations an ACSL agent or manager can reach.
 *
 * The rule itself lives in the database, in public.acsl_agent_org_scope. This
 * file composes it: an agent's own coverage, plus the coverage of the
 * acsl_agents reporting to them.
 *
 * WHY THE RULE MOVED INTO SQL
 *
 * It used to live here, and in four other hand-written copies that had already
 * drifted apart. One of them ignored states entirely while gating writes;
 * another derived states from partners, the inverse of what this did. Having
 * one definition is the point, and a set-returning function is what lets the
 * callers that resolve a page of agents at a time use it too, rather than
 * writing a sixth version.
 *
 * WHAT CHANGED FOR CALLERS
 *
 * Nothing in the shape of the answer. The same five fields come back and every
 * consumer compiles untouched. What changed is that a state assignment is now
 * live rather than a snapshot: a partner created in an assigned state is
 * covered from the moment it exists, without anyone re-saving the agent.
 * Whether an account works that way is stored per account, and every existing
 * account was backfilled with the mode it already behaved as, so nobody's
 * coverage moved when this shipped.
 *
 * WHAT IS DELIBERATELY NOT HERE
 *
 * Which rule an agent resolved under would be a useful thing to log, and it is
 * one query away. It is not fetched, because create-sale calls this on every
 * sale and nothing consumes the answer yet. A round trip on the write path
 * buys a log line; it can be added when something actually reads it.
 */

export interface ResolvedAssignments {
  /** Final merged, deduplicated org IDs */
  assignedOrgIds: string[];
  /** Org IDs from direct acsl_agent_organizations assignments */
  directOrgIds: string[];
  /** State names from acsl_agent_states */
  assignedStates: string[];
  /** Org IDs resolved from assigned states */
  stateResolvedOrgIds: string[];
  /** Org IDs inherited from subordinate acsl_agents (manager_id = agentId) */
  subordinateOrgIds: string[];
}

/**
 * Resolves the full set of organization IDs an ACSL agent (or ACSL agent
 * manager) has access to: their own coverage, plus - for managers - every org
 * covered by the acsl_agents reporting to them (profiles.manager_id =
 * agentId). Managers rarely hold assignments themselves; their scope is
 * effectively the union of their team's.
 *
 * Throws if the database refuses. That is deliberate and it is a change: this
 * function used to destructure `{ data }` and ignore `error`, so a transient
 * failure was indistinguishable from "this agent is assigned nothing". Callers
 * that gate reads would quietly show an empty list, and the one place that
 * folds a caller-supplied organization id into scope would have treated it as
 * the entire scope. A permission resolver that fails silently fails open
 * somewhere; better to be loud.
 */
export async function resolveAssignedOrgIds(
  supabase: any,
  agentId: string
): Promise<ResolvedAssignments> {
  const fail = (what: string, error: any) => {
    throw new Error(
      `resolveAssignedOrgIds: could not ${what} for ${agentId}: ${error?.message ?? error}`
    );
  };

  /*
   * 1. Everything that depends on nothing, at once.
   *
   * Only the subordinate list feeds the next step. The other two are
   * descriptive and could be fetched at any point, so they go here rather than
   * adding a round trip after it. create-sale runs this on every sale.
   *
   * `directOrgIds` means "partners named against this agent" and
   * `assignedStates` means "states held". Both stay true regardless of which
   * rule is in force, which is what makes them worth logging: an agent on
   * state coverage may still hold named rows that are not contributing, and a
   * log line that hid that would be the confusing kind.
   *
   * The role filter on subordinates is unchanged. It is what stops a manager
   * inheriting another manager's whole tree.
   */
  const [
    { data: subordinates, error: subError },
    { data: directRows, error: directError },
    { data: stateRows, error: stateError },
  ] = await Promise.all([
    supabase.from("profiles").select("id").eq("manager_id", agentId).eq("role", "acsl_agent"),
    supabase.from("acsl_agent_organizations").select("organization_id").eq("agent_id", agentId),
    supabase.from("acsl_agent_states").select("state").eq("agent_id", agentId),
  ]);
  if (subError) fail("read subordinates", subError);
  if (directError) fail("read named partners", directError);
  if (stateError) fail("read assigned states", stateError);

  const subordinateIds: string[] = (subordinates ?? []).map((s: any) => s.id);
  const directOrgIds: string[] = (directRows ?? []).map((a: any) => a.organization_id);
  const assignedStates: string[] = (stateRows ?? []).map((s: any) => s.state);

  // 2. One call resolves this agent and the whole team, under whichever rule
  //    each of them is on.
  const { data: scopeRows, error: scopeError } = await supabase.rpc(
    "acsl_agent_org_scope",
    { p_agent_ids: [agentId, ...subordinateIds] }
  );
  if (scopeError) fail("resolve coverage", scopeError);

  const own = (scopeRows ?? []).filter((r: any) => r.agent_id === agentId);
  const stateResolvedOrgIds: string[] = [
    ...new Set<string>(
      own.filter((r: any) => r.source === "state").map((r: any) => r.organization_id as string)
    ),
  ];
  const subordinateOrgIds: string[] = [
    ...new Set<string>(
      (scopeRows ?? [])
        .filter((r: any) => r.agent_id !== agentId)
        .map((r: any) => r.organization_id as string)
    ),
  ];

  /*
   * 3. The answer.
   *
   * Own coverage comes from the function, not from directOrgIds, because under
   * state coverage a named row is deliberately not a grant. Unioning them here
   * would reintroduce exactly the ambiguity this change removes.
   */
  const ownOrgIds: string[] = own.map((r: any) => r.organization_id as string);
  const assignedOrgIds = [...new Set([...ownOrgIds, ...subordinateOrgIds])];

  return {
    assignedOrgIds,
    directOrgIds,
    assignedStates,
    stateResolvedOrgIds,
    subordinateOrgIds,
  };
}
