// Authentication module for super admin operations
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export async function authenticateSuperAdmin(
  supabase: any,
  authHeader: string
) {
  console.log("🔐 Authenticating super admin...");

  if (!authHeader) {
    console.log("❌ No authorization header");
    throw new Error("Unauthorized: Authorization required");
  }

  // Create client with user's token to get their info
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
    .select("id, role, full_name, email, status")
    .eq("id", userId)
    .single();

  if (profileError || !profile) {
    console.log("❌ Profile fetch failed:", profileError?.message);
    throw new Error("Unauthorized: User profile not found");
  }

  console.log(`👤 User role: ${profile.role}`);
  console.log(`📊 User status: ${profile.status}`);

  // Check if user is super_admin
  if (profile.role !== "super_admin") {
    console.log("❌ Access denied: User is not super_admin");
    throw new Error("Unauthorized: Super Admin privileges required");
  }

  // Check if user account is active
  if (profile.status !== "active") {
    console.log("❌ Access denied: User account is not active");
    throw new Error("Unauthorized: Your account is not active");
  }

  console.log("✅ Super admin authenticated successfully");

  return {
    userId: profile.id,
    userRole: profile.role,
    userName: profile.full_name,
    userEmail: profile.email,
  };
}
