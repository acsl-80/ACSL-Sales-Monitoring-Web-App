// Authentication module for super-admin-agents (ACSL Agent management) operations
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface AuthResult {
  userId: string;
  userRole: string;
  userName: string;
  userEmail: string;
}

/**
 * Authenticates a super_admin caller (for write operations).
 * Throws on failure.
 */
export async function authenticateSuperAdmin(
  supabase: any,
  authHeader: string
): Promise<AuthResult> {
  console.log("🔐 Authenticating super admin...");

  if (!authHeader) {
    throw new Error("Unauthorized: Authorization required");
  }

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
    .select("id, role, full_name, email, status")
    .eq("id", userData.user.id)
    .single();

  if (profileError || !profile) {
    throw new Error("Unauthorized: User profile not found");
  }

  if (profile.role !== "super_admin") {
    throw new Error("Unauthorized: Super Admin privileges required");
  }

  if (profile.status !== "active") {
    throw new Error("Unauthorized: Your account is not active");
  }

  console.log("✅ Super admin authenticated:", profile.id);

  return {
    userId: profile.id,
    userRole: profile.role,
    userName: profile.full_name,
    userEmail: profile.email,
  };
}

/**
 * Authenticates a super_admin OR acsl_agent_manager caller (for write operations).
 * acsl_agent_manager can create/manage acsl_agent accounts under themselves.
 */
export async function authenticateManagerOrAdmin(
  supabase: any,
  authHeader: string
): Promise<AuthResult> {
  console.log("🔐 Authenticating manager or admin...");

  if (!authHeader) {
    throw new Error("Unauthorized: Authorization required");
  }

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
    .select("id, role, full_name, email, status")
    .eq("id", userData.user.id)
    .single();

  if (profileError || !profile) {
    throw new Error("Unauthorized: User profile not found");
  }

  if (!["super_admin", "acsl_agent_manager"].includes(profile.role)) {
    throw new Error("Unauthorized: Super Admin or ACSL Agent Manager privileges required");
  }

  if (profile.status !== "active") {
    throw new Error("Unauthorized: Your account is not active");
  }

  console.log("✅ Manager/admin authenticated:", profile.id, profile.role);

  return {
    userId: profile.id,
    userRole: profile.role,
    userName: profile.full_name,
    userEmail: profile.email,
  };
}

/**
 * Authenticates any valid caller (super_admin or acsl_agent).
 * Used for read operations where both roles are allowed.
 */
export async function authenticateReadAccess(
  supabase: any,
  authHeader: string
): Promise<AuthResult> {
  console.log("🔐 Authenticating read access...");

  if (!authHeader) {
    throw new Error("Unauthorized: Authorization required");
  }

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
    .select("id, role, full_name, email, status")
    .eq("id", userData.user.id)
    .single();

  if (profileError || !profile) {
    throw new Error("Unauthorized: User profile not found");
  }

  const allowedRoles = ["super_admin", "acsl_agent", "super_admin_agent", "acsl_agent_manager"];
  if (!allowedRoles.includes(profile.role)) {
    throw new Error("Unauthorized: Insufficient permissions");
  }

  if (profile.status !== "active") {
    throw new Error("Unauthorized: Your account is not active");
  }

  console.log("✅ Read access granted:", profile.id, profile.role);

  return {
    userId: profile.id,
    userRole: profile.role,
    userName: profile.full_name,
    userEmail: profile.email,
  };
}
