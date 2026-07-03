// Authentication module for super admin operations

export async function authenticateSuperAdmin(supabase: any) {
  console.log("🔐 Authenticating super admin...");

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
    throw new Error("Unauthorized: User profile not found");
  }

  console.log(`👤 User role: ${profile.role}`);

  // Check if user is super admin
  if (profile.role !== "super_admin") {
    console.log("❌ Access denied: User is not super admin");
    throw new Error("Unauthorized: Super admin privileges required");
  }

  console.log("✅ Super admin authenticated successfully");

  return {
    userId: profile.id,
    userRole: profile.role,
    userName: profile.full_name,
    userEmail: profile.email,
    organizationId: profile.organization_id,
  };
}
