// Authentication module for branch operations

export async function authenticateSuperAdmin(supabase: any) {
  console.log("🔐 Authenticating user for branch operations...");

  // Get user from JWT token
  const { data: userData, error: authError } = await supabase.auth.getUser();

  if (authError || !userData?.user) {
    console.log("❌ Authentication failed:", authError?.message);
    throw new Error("Unauthorized: Invalid or missing authentication token");
  }

  const userId = userData.user.id;
  console.log(`👤 User ID: ${userId}`);

  // Get user profile to check role
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, role, full_name, email, organization_id")
    .eq("id", userId)
    .single();

  if (profileError || !profile) {
    console.log("❌ Profile fetch failed:", profileError?.message);
    console.log("Profile error details:", profileError);
    throw new Error("Unauthorized: User profile not found or access denied");
  }

  console.log(`👤 User role: ${profile.role}`);
  console.log(`👤 User organization: ${profile.organization_id}`);

  // Check if user has sufficient privileges (super admin or organization admin)
  if (profile.role !== "super_admin" && profile.role !== "admin") {
    console.log("❌ Access denied: Insufficient privileges for branch operations");
    throw new Error(`Unauthorized: Admin or Super admin privileges required. Current role: ${profile.role}`);
  }

  console.log("✅ User authenticated successfully for branch operations");

  return {
    userId: profile.id,
    userRole: profile.role,
    userName: profile.full_name,
    userEmail: profile.email,
    organizationId: profile.organization_id,
  };
}
