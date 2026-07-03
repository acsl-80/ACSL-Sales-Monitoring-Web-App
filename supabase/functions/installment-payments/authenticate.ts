// Authentication module for installment-payments
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveAssignedOrgIds } from "../_shared/resolveAssignedOrgIds.ts";

export interface AuthResult {
  userId: string;
  userRole: string;
  organizationId: string | null;
  assignedOrgIds?: string[];
}

export async function authenticate(
  supabase: any,
  authHeader: string
): Promise<AuthResult> {
  console.log("🔐 Authenticating for installment payments...");

  if (!authHeader) throw new Error("Unauthorized: Authorization required");

  const userSupabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: userData, error: authError } = await userSupabase.auth.getUser();
  if (authError || !userData?.user) {
    throw new Error("Unauthorized: Invalid or missing authentication token");
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, role, status, organization_id")
    .eq("id", userData.user.id)
    .single();

  if (profileError || !profile)
    throw new Error("Unauthorized: User profile not found");

  if (
    !["super_admin", "acsl_agent", "super_admin_agent", "partner", "admin", "partner_agent", "agent"].includes(
      profile.role
    )
  ) {
    throw new Error("Unauthorized: Insufficient permissions");
  }

  if (profile.status !== "active")
    throw new Error("Unauthorized: Account is not active");

  // For ACSL agent (formerly SAA), resolve assigned org IDs
  let assignedOrgIds: string[] | undefined;
  if (profile.role === "acsl_agent" || profile.role === "acsl_agent_manager" || profile.role === "super_admin_agent") {
    const resolved = await resolveAssignedOrgIds(supabase, profile.id);
    assignedOrgIds = resolved.assignedOrgIds;
  }

  console.log("✅ Authenticated:", profile.id, profile.role);
  return {
    userId: profile.id,
    userRole: profile.role,
    organizationId: profile.organization_id,
    assignedOrgIds,
  };
}
