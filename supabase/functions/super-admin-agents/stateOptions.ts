// State assignment operations for super-admin-agents

/**
 * Get all state assignments for an agent.
 */
export async function getAgentStates(supabase: any, agentId: string) {
  console.log(`📍 Fetching state assignments for agent ${agentId}`);

  const { data, error } = await supabase
    .from("acsl_agent_states")
    .select("id, state, assigned_at, assigned_by")
    .eq("agent_id", agentId)
    .order("state", { ascending: true });

  if (error) throw new Error(`Database error: ${error.message}`);

  return {
    message: `Found ${(data || []).length} state assignment(s)`,
    data: data || [],
  };
}

/**
 * Replace all state assignments for an agent.
 * Deletes existing assignments and inserts the new set.
 * Body: { states: string[] }
 */
export async function setAgentStates(
  supabase: any,
  agentId: string,
  states: string[],
  assignedBy: string
) {
  console.log(`📍 Setting state assignments for agent ${agentId}:`, states);

  // Verify agent exists and is acsl_agent
  const { data: agent, error: agentError } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", agentId)
    .in("role", ["acsl_agent", "acsl_agent_manager"])
    .single();

  if (agentError) {
    if (agentError.code === "PGRST116") throw new Error("Agent not found");
    throw new Error(`Database error: ${agentError.message}`);
  }

  // Delete all existing state assignments for this agent
  const { error: deleteError } = await supabase
    .from("acsl_agent_states")
    .delete()
    .eq("agent_id", agentId);

  if (deleteError)
    throw new Error(`Failed to clear state assignments: ${deleteError.message}`);

  // Insert new state assignments
  if (states.length > 0) {
    const inserts = states.map((state) => ({
      agent_id: agentId,
      state,
      assigned_by: assignedBy,
    }));

    const { error: insertError } = await supabase
      .from("acsl_agent_states")
      .insert(inserts);

    if (insertError)
      throw new Error(`Failed to assign states: ${insertError.message}`);
  }

  console.log(`✅ Assigned ${states.length} state(s) to agent ${agentId}`);

  // Return the updated list
  const { data: rows } = await supabase
    .from("acsl_agent_states")
    .select("id, state, assigned_at")
    .eq("agent_id", agentId)
    .order("state", { ascending: true });

  return {
    message: `Successfully assigned ${states.length} state(s)`,
    data: rows || [],
  };
}

/**
 * Remove a single state assignment for an agent.
 */
export async function removeAgentState(
  supabase: any,
  agentId: string,
  state: string
) {
  console.log(`📍 Removing state "${state}" from agent ${agentId}`);

  const { error } = await supabase
    .from("acsl_agent_states")
    .delete()
    .eq("agent_id", agentId)
    .eq("state", state);

  if (error)
    throw new Error(`Failed to remove state: ${error.message}`);

  console.log("✅ State removed from agent");

  return {
    message: "State removed from agent successfully",
    data: { agent_id: agentId, state },
  };
}
