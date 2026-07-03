// Authentication module for organization management operations.
// Super admins get full access; ACSL agents/managers get read-only access
// scoped to their assigned organizations (resolved by the caller); partners
// get read-only access scoped to their own organization.

const READ_SCOPED_ROLES = ["acsl_agent", "acsl_agent_manager", "super_admin_agent"];
const OWN_ORG_ROLES = ["partner", "admin"];

export async function authenticateOrganizationAccess(supabase: any) {
  console.log("🔐 Authenticating organization access...");

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

  const isSuperAdmin = profile.role === "super_admin";
  const isScopedReader = READ_SCOPED_ROLES.includes(profile.role);
  const isOwnOrgReader = OWN_ORG_ROLES.includes(profile.role);

  if (!isSuperAdmin && !isScopedReader && !isOwnOrgReader) {
    console.log("❌ Access denied for role:", profile.role);
    throw new Error("Unauthorized: Super admin privileges required");
  }

  return {
    userId: profile.id,
    userRole: profile.role,
    userName: profile.full_name,
    userEmail: profile.email,
    organizationId: profile.organization_id,
    isSuperAdmin,
    isOwnOrgReader,
  };
}
