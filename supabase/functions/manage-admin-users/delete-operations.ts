// Delete operations for admin users

export async function deleteAdminUser(supabase: any, adminUserId: string) {
  console.log(`🗑️ Deleting admin user: ${adminUserId}`);

  // Check if admin user exists
  const { data: existingUser, error: checkError } = await supabase
    .from("profiles")
    .select("id, full_name, email, role, organization_id")
    .eq("id", adminUserId)
    .eq("role", "admin")
    .single();

  if (checkError || !existingUser) {
    throw new Error(`Admin user with ID ${adminUserId} not found`);
  }

  // Check if user has any dependent records (e.g., created sales, agents, etc.)
  const checks = await Promise.all([
    // Check for sales created by this admin
    supabase.from("sales").select("id").eq("created_by", adminUserId).limit(1),

    // Check for agents created by this admin
    supabase
      .from("profiles")
      .select("id")
      .eq("role", "agent")
      .eq("organization_id", existingUser.organization_id)
      .limit(1),
  ]);

  const [salesCheck, agentsCheck] = checks;

  // Prepare warning messages for dependent records
  const warnings: string[] = [];

  if (salesCheck.data && salesCheck.data.length > 0) {
    warnings.push("This admin has created sales records");
  }

  if (agentsCheck.data && agentsCheck.data.length > 0) {
    warnings.push("This admin's organization has agent users");
  }

  // For now, we'll proceed with deletion but log warnings
  if (warnings.length > 0) {
    console.warn(
      `⚠️ Warning: Deleting admin user with dependencies: ${warnings.join(
        ", "
      )}`
    );
  }

  try {
    // Start a transaction-like operation
    // First, delete from profiles table
    const { error: profileDeleteError } = await supabase
      .from("profiles")
      .delete()
      .eq("id", adminUserId);

    if (profileDeleteError) {
      throw new Error(
        `Failed to delete user profile: ${profileDeleteError.message}`
      );
    }

    // Then delete from auth (this will cascade delete the user)
    const { error: authDeleteError } = await supabase.auth.admin.deleteUser(
      adminUserId
    );

    if (authDeleteError) {
      console.warn(`Failed to delete auth user: ${authDeleteError.message}`);
      // Note: Profile is already deleted, but we continue as the main operation succeeded
    }

    console.log(`✅ Admin user deleted successfully: ${adminUserId}`);

    return {
      data: {
        deleted_user_id: adminUserId,
        deleted_user_email: existingUser.email,
        deleted_user_name: existingUser.full_name,
      },
      message: "Admin user deleted successfully",
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  } catch (error) {
    console.error(`❌ Failed to delete admin user: ${error.message}`);
    throw error;
  }
}
