// Authentication module for stove ID management operations

export async function authenticateUser(supabase: any) {
  console.log("🔐 Authenticating user...");

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

  // Check if user is admin or super_admin
  if (profile.role !== "super_admin" && profile.role !== "admin") {
    console.log("❌ Access denied: User is not admin or super_admin");
    throw new Error("Unauthorized: Admin privileges required");
  }

  console.log("✅ User authenticated successfully");

  return {
    userId: profile.id,
    userRole: profile.role,
    userName: profile.full_name,
    userEmail: profile.email,
    organizationId: profile.organization_id,
  };
}
