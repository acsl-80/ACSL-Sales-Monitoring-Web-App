// Delete operations for organizations with user management
import { disableUser, findOrganizationAdmin } from "./user-utils.ts";

export async function deleteOrganization(
  supabase: any,
  organizationId: string
) {
  console.log(`🗑️ Deleting organization: ${organizationId}`);

  // Check if organization exists
  const { data: existingOrg, error: checkError } = await supabase
    .from("organizations")
    .select("id, name, status")
    .eq("id", organizationId)
    .single();

  if (checkError || !existingOrg) {
    throw new Error(`Organization with ID ${organizationId} not found`);
  }

  // Check if organization has associated sales records
  const { count: salesCount, error: salesError } = await supabase
    .from("sales")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId);

  if (salesError) {
    console.warn("Could not check sales records:", salesError.message);
  }

  // Check if organization has associated users (other than admin)
  const { count: usersCount, error: usersError } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId);

  if (usersError) {
    console.warn("Could not check user records:", usersError.message);
  }

  // Find and handle the organization admin user
  let adminUser: any = null;
  let adminDisabled = false;

  try {
    adminUser = await findOrganizationAdmin(supabase, organizationId);

    if (adminUser) {
      console.log(`🚫 Disabling admin user: ${adminUser.id}`);
      await disableUser(supabase, adminUser.id);
      adminDisabled = true;
      console.log("✅ Admin user disabled successfully");
    }
  } catch (error) {
    console.error("❌ Error disabling admin user:", error);
    // Continue with organization deletion even if user disable fails
  }

  // Implement soft delete by updating status instead of hard delete
  // This preserves data integrity while removing access
  const { data: updatedOrg, error: deleteError } = await supabase
    .from("organizations")
    .update({
      status: "deleted",
      updated_at: new Date().toISOString(),
    })
    .eq("id", organizationId)
    .select()
    .single();

  if (deleteError) {
    throw new Error(`Failed to delete organization: ${deleteError.message}`);
  }

  // Prepare warnings array
  const warnings: string[] = [];

  if (salesCount && salesCount > 0) {
    warnings.push(`Organization had ${salesCount} associated sales records`);
  }

  if (usersCount && usersCount > 0) {
    warnings.push(`Organization had ${usersCount} associated users`);
  }

  if (adminDisabled) {
    warnings.push("Organization admin user has been disabled");
  } else if (adminUser) {
    warnings.push("Could not disable organization admin user");
  }

  return {
    data: {
      id: organizationId,
      name: existingOrg.name,
      deletedAt: new Date().toISOString(),
      admin_user_disabled: adminDisabled,
      soft_deleted: true, // Indicate this was a soft delete
    },
    message: "Organization soft-deleted successfully (status set to 'deleted')",
    warnings,
  };
}

// For cases where hard delete is absolutely necessary (use with extreme caution)
export async function hardDeleteOrganization(
  supabase: any,
  organizationId: string
) {
  console.log(`💥 HARD DELETING organization: ${organizationId}`);
  console.warn("⚠️ This is a destructive operation that cannot be undone!");

  // Check if organization exists
  const { data: existingOrg, error: checkError } = await supabase
    .from("organizations")
    .select("id, name")
    .eq("id", organizationId)
    .single();

  if (checkError || !existingOrg) {
    throw new Error(`Organization with ID ${organizationId} not found`);
  }

  // Find and delete the organization admin user
  let adminUser: any = null;
  let adminDeleted = false;

  try {
    adminUser = await findOrganizationAdmin(supabase, organizationId);

    if (adminUser) {
      console.log(`💥 HARD DELETING admin user: ${adminUser.id}`);
      const { error: userDeleteError } = await supabase.auth.admin.deleteUser(
        adminUser.id
      );

      if (userDeleteError) {
        throw new Error(
          `Failed to delete admin user: ${userDeleteError.message}`
        );
      }

      adminDeleted = true;
      console.log("✅ Admin user hard deleted successfully");
    }
  } catch (error) {
    console.error("❌ Error hard deleting admin user:", error);
    throw new Error(`Failed to delete admin user: ${error.message}`);
  }

  // Hard delete the organization record
  const { error: deleteError } = await supabase
    .from("organizations")
    .delete()
    .eq("id", organizationId);

  if (deleteError) {
    throw new Error(
      `Failed to hard delete organization: ${deleteError.message}`
    );
  }

  console.log("💥 Organization hard deleted successfully");

  return {
    data: {
      id: organizationId,
      name: existingOrg.name,
      deletedAt: new Date().toISOString(),
      admin_user_deleted: adminDeleted,
      hard_deleted: true,
    },
    message: "Organization permanently deleted (IRREVERSIBLE)",
    warnings: [
      "This was a hard delete operation",
      "All data has been permanently removed",
      "This action cannot be undone",
    ],
  };
}
