// Authentication module — requires acsl_agent (formerly super_admin_agent) or super_admin role
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface AuthResult {
  userId: string;
  userRole: string;
}

export async function authenticate(supabase: any, authHeader: string): Promise<AuthResult> {
  console.log("🔐 Authenticating for approve-sale...");

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
    .select("id, role, status")
    .eq("id", userData.user.id)
    .single();

  if (profileError || !profile) throw new Error("Unauthorized: User profile not found");

  if (!["acsl_agent", "acsl_agent_manager", "super_admin_agent", "super_admin"].includes(profile.role)) {
    throw new Error("Unauthorized: Only ACSL agents can approve sales");
  }

  if (profile.status !== "active") throw new Error("Unauthorized: Account is not active");

  console.log("✅ Authenticated:", profile.id, profile.role);
  return { userId: profile.id, userRole: profile.role };
}
