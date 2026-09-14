// Write operations for branch management

import { validateBranchCreateData, validateBranchUpdateData, validateUUID } from "./validate.ts";

export async function createBranch(
  supabase: any,
  data: any,
  userId: string,
  userRole: string
) {
  console.log("✏️ Creating new branch");

  try {
    // Validate input data
    const validatedData = validateBranchCreateData(data);
    console.log("📝 Validated branch data:", validatedData);

    // Check if organization exists
    const { data: organization, error: orgError } = await supabase
      .from("organizations")
      .select("id, name")
      .eq("id", validatedData.organization_id)
      .single();

    if (orgError || !organization) {
      console.error("❌ Organization not found:", orgError?.message);
      throw new Error("Organization not found");
    }

    // Check authorization for organization admin
    if (userRole === "admin") {
      const { data: userProfile } = await supabase
        .from("profiles")
        .select("organization_id")
        .eq("id", userId)
        .single();

      if (!userProfile || userProfile.organization_id !== validatedData.organization_id) {
        throw new Error("Unauthorized: You can only create branches for your organization");
      }
    }

    // Check if branch name already exists in the organization
    const { data: existingBranch } = await supabase
      .from("organization_branches")
      .select("id")
      .eq("organization_id", validatedData.organization_id)
      .eq("name", validatedData.name)
      .maybeSingle();

    if (existingBranch) {
      throw new Error(`Branch with name "${validatedData.name}" already exists in this organization`);
    }

    // Create the branch
    const branchData = {
      ...validatedData,
      created_by: userId,
    };

    const { data: newBranch, error: createError } = await supabase
      .from("organization_branches")
      .insert(branchData)
      .select(`
        id,
        organization_id,
        name,
        country,
        state,
        lga,
        created_at,
        updated_at,
        created_by
      `)
      .single();

    if (createError) {
      console.error("❌ Error creating branch:", createError);
      throw new Error(`Failed to create branch: ${createError.message}`);
    }

    // Get organization details separately
    const { data: orgDetails } = await supabase
      .from("organizations")
      .select("id, name, partner_email")
      .eq("id", newBranch.organization_id)
      .single();

    // Get creator profile separately from public.profiles
    const { data: creatorProfile } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .eq("id", newBranch.created_by)
      .single();

    // Combine the results
    const branchWithDetails = {
      ...newBranch,
      organizations: orgDetails,
      profiles: creatorProfile,
    };

    console.log("✅ Branch created successfully:", newBranch.id);

    return {
      message: "Branch created successfully",
      data: { branch: branchWithDetails },
    };
  } catch (error) {
    console.error("❌ Error in createBranch:", error);
    throw error;
  }
}

export async function updateBranch(
  supabase: any,
  branchId: string,
  data: any,
  userId: string,
  userRole: string
) {
  console.log(`✏️ Updating branch: ${branchId}`);

  try {
    validateUUID(branchId, "branch_id");
    const validatedData = validateBranchUpdateData(data);
    console.log("📝 Validated update data:", validatedData);

    // Check if branch exists and get current data
    const { data: existingBranch, error: fetchError } = await supabase
      .from("organization_branches")
      .select("id, organization_id, name, country, state, lga")
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
        throw new Error("Unauthorized: You can only update branches from your organization");
      }
    }

    // If updating name, check for duplicates in the same organization
    if (validatedData.name && validatedData.name !== existingBranch.name) {
      const { data: duplicateBranch } = await supabase
        .from("organization_branches")
        .select("id")
        .eq("organization_id", existingBranch.organization_id)
        .eq("name", validatedData.name)
        .neq("id", branchId)
        .maybeSingle();

      if (duplicateBranch) {
        throw new Error(`Branch with name "${validatedData.name}" already exists in this organization`);
      }
    }

    // Update the branch
    const { data: updatedBranch, error: updateError } = await supabase
      .from("organization_branches")
      .update(validatedData)
      .eq("id", branchId)
      .select(`
        id,
        organization_id,
        name,
        country,
        state,
        lga,
        created_at,
        updated_at,
        created_by
      `)
      .single();

    if (updateError) {
      console.error("❌ Error updating branch:", updateError);
      throw new Error(`Failed to update branch: ${updateError.message}`);
    }

    // Get organization details separately
    const { data: orgDetails } = await supabase
      .from("organizations")
      .select("id, name, partner_email")
      .eq("id", updatedBranch.organization_id)
      .single();

    // Get creator profile separately from public.profiles
    const { data: creatorProfile } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .eq("id", updatedBranch.created_by)
      .single();

    // Combine the results
    const branchWithDetails = {
      ...updatedBranch,
      organizations: orgDetails,
      profiles: creatorProfile,
    };

    console.log("✅ Branch updated successfully");

    return {
      message: "Branch updated successfully",
      data: { branch: branchWithDetails },
    };
  } catch (error) {
    console.error("❌ Error in updateBranch:", error);
    throw error;
  }
}
