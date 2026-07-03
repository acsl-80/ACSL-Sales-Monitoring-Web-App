// Authentication module
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveAssignedOrgIds } from "../_shared/resolveAssignedOrgIds.ts";

export interface AuthResult {
  userRole: string;
  userId: string;
  userOrgId: string | null;
  assignedOrgIds?: string[]; // populated for acsl_agent (formerly super_admin_agent)
  teamAgentIds?: string[]; // populated for acsl_agent_manager: self + subordinate acsl_agents
}

export async function authenticateUser(supabase: any): Promise<AuthResult> {
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

  let userRole: string;
  let userOrgId: string | null = null;

  // Check if user email is super admin first (simpler approach)
  if (userData.user.email === "superadmin@mail.com") {
    console.log("✅ Super admin identified by email");
    userRole = "super_admin";
    userOrgId = null;
  } else {
    // For non-super admin, try to get profile without RLS dependency
    console.log("� Fetching user profile from profiles table...");

    // Use the same supabase client (already configured with service role)
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role, organization_id")
      .eq("id", userData.user.id)
      .single();

    if (profileError || !profile) {
      console.log("❌ Profile fetch failed:", profileError?.message);
      throw new Error("Profile not found and not super admin email");
    }

    console.log("✅ Profile fetched successfully");
    userRole = profile.role;
    userOrgId = profile.organization_id;
  }

  console.log("✅ User role determined:", { userRole, userOrgId });

  // Allow super_admin, partner (admin), partner_agent (agent), and acsl_agent (super_admin_agent) roles
  if (!["super_admin", "partner", "admin", "partner_agent", "agent", "acsl_agent", "acsl_agent_manager", "super_admin_agent"].includes(userRole)) {
    console.log("❌ Access denied - Role:", userRole);
    throw new Error(
      "Access denied. Partner, Partner Agent, or Super Admin role required."
    );
  }

  console.log("✅ Access confirmed for role:", userRole);

  // For acsl_agent and acsl_agent_manager, resolve assigned org IDs (direct + state-based)
  let assignedOrgIds: string[] | undefined;
  if (userRole === "acsl_agent" || userRole === "acsl_agent_manager" || userRole === "super_admin_agent") {
    console.log("🔗 Resolving assigned organizations for acsl_agent...");
    const resolved = await resolveAssignedOrgIds(supabase, userData.user.id);
    assignedOrgIds = resolved.assignedOrgIds;
    console.log(
      `✅ ACSL agent: ${resolved.directOrgIds.length} direct orgs + ${resolved.assignedStates.length} states (${resolved.stateResolvedOrgIds.length} state orgs) = ${assignedOrgIds.length} total`
    );
  }

  // A manager must see every sale their team recorded, even for a partner org
  // that only their subordinate — not the manager themselves — is formally
  // assigned to. Org-based scoping alone can miss that, so also resolve the
  // team's agent IDs to match sales by attribution (sold_on_behalf_of).
  let teamAgentIds: string[] | undefined;
  if (userRole === "acsl_agent_manager") {
    const { data: subordinates } = await supabase
      .from("profiles")
      .select("id")
      .eq("manager_id", userData.user.id)
      .eq("role", "acsl_agent");
    teamAgentIds = [userData.user.id, ...(subordinates || []).map((s: any) => s.id)];
    console.log(`✅ Manager team: ${teamAgentIds.length} agents (self + subordinates)`);
  }

  return {
    userRole,
    userId: userData.user.id,
    userOrgId,
    assignedOrgIds,
    teamAgentIds,
  };
}
