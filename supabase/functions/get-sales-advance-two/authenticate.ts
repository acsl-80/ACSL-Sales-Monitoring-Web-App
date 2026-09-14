// Authentication module
export async function authenticateUser(supabase) {
  console.log("🔐 Getting user from token...");
  // Get authenticated user
  const { data: userData, error: authError } = await supabase.auth.getUser();
  if (authError || !userData?.user) {
    console.log("❌ Authentication failed:", authError?.message);
    console.log("❌ Full auth error:", JSON.stringify(authError, null, 2));
    console.log("❌ User data:", JSON.stringify(userData, null, 2));
    throw new Error("Unauthorized");
  }
  console.log("✅ User authenticated:", userData.user.email);
  let userRole;
  let userOrgId = null;
  // Check if user email is super admin first (simpler approach)
  if (userData.user.email === "superadmin@mail.com") {
    console.log("✅ Super admin identified by email");
    userRole = "super_admin";
    userOrgId = null;
  } else {
    // For non-super admin, try to get profile without RLS dependency
    console.log("� Fetching user profile from profiles table...");
    // Use the same supabase client (already configured with service role)
    const { data: profile, error: profileError } = await supabase.from("profiles").select("role, organization_id").eq("id", userData.user.id).single();
    if (profileError || !profile) {
      console.log("❌ Profile fetch failed:", profileError?.message);
      throw new Error("Profile not found and not super admin email");
    }
    console.log("✅ Profile fetched successfully");
    userRole = profile.role;
    userOrgId = profile.organization_id;
  }
  console.log("✅ User role determined:", {
    userRole,
    userOrgId
  });
  if (userRole !== "super_admin") {
    console.log("❌ Access denied - Role:", userRole);
    throw new Error("Access denied. Super admin role required.");
  }
  console.log("✅ Super admin access confirmed");
  return {
    userRole,
    userId: userData.user.id,
    userOrgId
  };
}
