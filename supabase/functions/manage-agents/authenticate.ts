// Authentication module for admin operations
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export async function authenticateAdmin(supabase: any, authHeader: string) {
  console.log("🔐 Authenticating admin...");

  if (!authHeader) {
    console.log("❌ No authorization header");
    throw new Error("Unauthorized: Authorization required");
  }

  // Create client with user's token to get their info (like in get-sales-agents)
  const userSupabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    }
  );

  // Get user from JWT token using user client
  const { data: userData, error: authError } =
    await userSupabase.auth.getUser();

  if (authError || !userData?.user) {
    console.log("❌ Authentication failed:", authError?.message);
    throw new Error("Unauthorized: Invalid or missing authentication token");
  }

  const userId = userData.user.id;
  console.log(`👤 User ID: ${userId}`);

  // Get user profile to check role using service role client
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
  console.log(`🏢 User organization: ${profile.organization_id}`);

  // Check if user is admin, agent, or super_admin
  if (!["partner", "admin", "partner_agent", "agent", "super_admin"].includes(profile.role)) {
    console.log("❌ Access denied: User is not admin, agent, or super_admin");
    throw new Error(
      "Unauthorized: Admin, Agent, or Super Admin privileges required"
    );
  }

  console.log("✅ Admin authenticated successfully");

  return {
    userId: profile.id,
    userRole: profile.role,
    userName: profile.full_name,
    userEmail: profile.email,
    organizationId: profile.organization_id,
  };
}
