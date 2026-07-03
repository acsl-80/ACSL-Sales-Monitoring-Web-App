// Organization assignment operations for super-admin-agents

/**
 * Replace all org assignments for an agent.
 * Deletes existing assignments and inserts the new set.
 * Body: { organization_ids: string[] }
 */
export async function setAgentOrganizations(
  supabase: any,
  agentId: string,
  orgIds: string[],
  assignedBy: string
) {
  console.log(`🔗 Setting org assignments for agent ${agentId}:`, orgIds);

  // Verify agent exists
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

  // Delete all existing assignments for this agent
  const { error: deleteError } = await supabase
    .from("acsl_agent_organizations")
    .delete()
    .eq("agent_id", agentId);

  if (deleteError) throw new Error(`Failed to clear assignments: ${deleteError.message}`);

  // Insert new assignments in batches to avoid request size limits
  if (orgIds.length > 0) {
    const BATCH_SIZE = 100;
    for (let i = 0; i < orgIds.length; i += BATCH_SIZE) {
      const batch = orgIds.slice(i, i + BATCH_SIZE).map((orgId) => ({
        agent_id: agentId,
        organization_id: orgId,
        assigned_by: assignedBy,
      }));
      const { error: insertError } = await supabase
        .from("acsl_agent_organizations")
        .insert(batch);
      if (insertError) throw new Error(`Failed to assign organizations: ${insertError.message}`);
    }
  }

  console.log(`✅ Assigned ${orgIds.length} organizations to agent ${agentId}`);

  // Return the updated list
  const { data: rows } = await supabase
    .from("acsl_agent_organizations")
    .select(`
      id, assigned_at,
      organizations ( id, partner_name, branch, state )
    `)
    .eq("agent_id", agentId);

  const organizations = (rows || []).map((row: any) => ({
    assignment_id: row.id,
    assigned_at: row.assigned_at,
    ...row.organizations,
  }));

  return {
    message: `Successfully assigned ${orgIds.length} organization(s)`,
    data: organizations,
  };
}

/**
 * Remove a single org assignment for an agent.
 */
export async function removeAgentOrganization(
  supabase: any,
  agentId: string,
  orgId: string
) {
  console.log(`🔗 Removing org ${orgId} from agent ${agentId}`);

  const { error } = await supabase
    .from("acsl_agent_organizations")
    .delete()
    .eq("agent_id", agentId)
    .eq("organization_id", orgId);

  if (error) throw new Error(`Failed to remove organization: ${error.message}`);

  console.log("✅ Organization removed from agent");

  return {
    message: "Organization removed from agent successfully",
    data: { agent_id: agentId, organization_id: orgId },
  };
}
