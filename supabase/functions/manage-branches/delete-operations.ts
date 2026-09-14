// Delete operations for branch management

import { validateUUID } from "./validate.ts";

export async function deleteBranch(
  supabase: any,
  branchId: string,
  userId: string,
  userRole: string
) {
  console.log(`🗑️ Deleting branch: ${branchId}`);

  try {
    validateUUID(branchId, "branch_id");

    // Check if branch exists and get current data
    const { data: existingBranch, error: fetchError } = await supabase
      .from("organization_branches")
      .select(`
        id,
        organization_id,
        name,
        country,
        state,
        lga,
        created_at,
        organizations:organization_id (
          id,
          name,
          partner_email
        )
      `)
      .eq("id", branchId)
      .single();

    if (fetchError || !existingBranch) {
      console.error("❌ Branch not found:", fetchError?.message);
      throw new Error("Branch not found");
    }

    // Check authorization for organization admin
    if (userRole === "admin") {
      const { data: userProfile } = await supabase
        .from("profiles")
        .select("organization_id")
        .eq("id", userId)
        .single();

      if (!userProfile || userProfile.organization_id !== existingBranch.organization_id) {
        throw new Error("Unauthorized: You can only delete branches from your organization");
      }
    }

    // TODO: Add checks for related data before deletion
    // For example, check if there are any sales, agents, or other entities linked to this branch
    // This would prevent accidental deletion of branches with important data
    
    // Example check (uncomment when you have related tables):
    /*
    const { data: relatedSales } = await supabase
      .from("sales")
      .select("id")
      .eq("branch_id", branchId)
      .limit(1);

    if (relatedSales && relatedSales.length > 0) {
      throw new Error("Cannot delete branch with existing sales records. Please transfer or delete related data first.");
    }

    const { data: relatedAgents } = await supabase
      .from("profiles")
      .select("id")
      .eq("branch_id", branchId)
      .eq("role", "agent")
      .limit(1);

    if (relatedAgents && relatedAgents.length > 0) {
      throw new Error("Cannot delete branch with assigned agents. Please reassign agents to other branches first.");
    }
    */

    // Perform the deletion
    const { error: deleteError } = await supabase
      .from("organization_branches")
      .delete()
      .eq("id", branchId);

    if (deleteError) {
      console.error("❌ Error deleting branch:", deleteError);
      throw new Error(`Failed to delete branch: ${deleteError.message}`);
    }

    console.log("✅ Branch deleted successfully");

    return {
      message: "Branch deleted successfully",
      data: { 
        deletedBranch: {
          id: existingBranch.id,
          name: existingBranch.name,
          organization: existingBranch.organizations,
        }
      },
    };
  } catch (error) {
    console.error("❌ Error in deleteBranch:", error);
    throw error;
  }
}
