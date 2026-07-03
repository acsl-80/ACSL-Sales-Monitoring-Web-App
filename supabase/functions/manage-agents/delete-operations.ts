// Delete operations for agents

export async function deleteAgent(
  supabase: any,
  agentId: string,
  userRole: string,
  organizationId: string | null
) {
  console.log("🗑️ Deleting agent:", agentId);

  try {
    // First, check if the agent exists and admin has permission to delete
    let checkQuery = supabase
      .from("profiles")
      .select("id, organization_id, role, full_name, email")
      .eq("id", agentId)
      .in("role", ["partner_agent", "agent"]);

    // Apply organization filter for partner (formerly admin) users
    if ((userRole === "partner" || userRole === "admin") && organizationId) {
      checkQuery = checkQuery.eq("organization_id", organizationId);
    } else if (userRole !== "super_admin") {
      throw new Error("Insufficient permissions to delete agents");
    }

    const { data: existingAgent, error: checkError } =
      await checkQuery.single();

    if (checkError) {
      if (checkError.code === "PGRST116") {
        throw new Error("Agent not found or access denied");
      }
      console.error("❌ Error checking agent:", checkError);
      throw new Error(`Database error: ${checkError.message}`);
    }

    console.log("🔍 Agent found, proceeding with deletion");

    // Check if agent has any sales records (optional - depending on your business logic)
    const { data: salesRecords, error: salesError } = await supabase
      .from("sales")
      .select("id")
      .eq("created_by", agentId)
      .limit(1);

    if (salesError) {
      console.error("❌ Error checking sales records:", salesError);
      throw new Error(`Database error: ${salesError.message}`);
    }

    if (salesRecords && salesRecords.length > 0) {
      throw new Error(
        "Cannot delete agent with existing sales records. Please transfer or archive the sales first."
      );
    }

    // Delete from Auth (this should cascade to profiles due to foreign key constraints)
    const { error: authDeleteError } = await supabase.auth.admin.deleteUser(
      agentId
    );

    if (authDeleteError) {
      console.error("❌ Error deleting user from Auth:", authDeleteError);
      throw new Error(`Failed to delete user: ${authDeleteError.message}`);
    }

    console.log("✅ Agent deleted successfully from Auth");

    // Verify deletion from profiles table
    const { data: stillExists, error: verifyError } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", agentId)
      .maybeSingle();

    if (verifyError) {
      console.warn("⚠️ Error verifying deletion:", verifyError.message);
    }

    if (stillExists) {
      // If profile still exists, delete it manually
      const { error: profileDeleteError } = await supabase
        .from("profiles")
        .delete()
        .eq("id", agentId);

      if (profileDeleteError) {
        console.error("❌ Error deleting profile:", profileDeleteError);
        throw new Error(
          `Failed to delete agent profile: ${profileDeleteError.message}`
        );
      }
    }

    console.log("✅ Agent completely deleted:", agentId);

    return {
      message: "Agent deleted successfully",
      data: {
        id: agentId,
        deleted_agent: {
          id: existingAgent.id,
          full_name: existingAgent.full_name,
          email: existingAgent.email,
        },
      },
    };
  } catch (error) {
    console.error("❌ Error in deleteAgent:", error);
    throw error;
  }
}
