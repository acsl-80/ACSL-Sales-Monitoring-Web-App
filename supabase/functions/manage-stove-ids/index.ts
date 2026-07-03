// Stove ID Management Edge Function
// Supports super_admin (all stove IDs), partner/admin (organization-specific), and acsl_agent access
// Provides pagination, filtering, and detailed stove ID information with sales data

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handleCors } from "./cors.ts";
import { handleStoveIdRoute } from "./route-handler.ts";
import { resolveAssignedOrgIds } from "../_shared/resolveAssignedOrgIds.ts";

console.log("🚀 Stove ID Management function initialized");

serve(async (req) => {
  console.log("📥 Request:", req.method, req.url);

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    console.log("✅ CORS preflight handled");
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  try {
    // Initialize Supabase with service role key for database operations
    console.log("🔧 Initializing Supabase with service role...");
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Get the authenticated user from the request
    console.log("🔐 Getting authenticated user...");
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      console.log("❌ No authorization header");
      throw new Error("Unauthorized: Authorization required");
    }

    // Create client with user's token to verify authentication
    const userSupabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      {
        global: {
          headers: { Authorization: authHeader },
        },
      }
    );

    const { data: userData, error: authError } =
      await userSupabase.auth.getUser();

    if (authError || !userData?.user) {
      console.log("❌ Invalid user token:", authError?.message);
      throw new Error("Unauthorized: Invalid authentication");
    }

    const userId = userData.user.id;
    console.log("✅ User authenticated:", userId);

    // Get user's profile to check role and organization
    console.log("👤 Fetching user profile...");
    const { data: userProfile, error: profileError } = await supabase
      .from("profiles")
      .select("id, role, organization_id, full_name, email")
      .eq("id", userId)
      .single();

    if (profileError || !userProfile) {
      console.log("❌ Could not fetch user profile:", profileError);
      throw new Error("Unauthorized: User profile not found");
    }

    console.log("👤 User role:", userProfile.role);
    console.log("🏢 User organization:", userProfile.organization_id);

    // Check if user has permission
    if (!["partner", "admin", "super_admin", "acsl_agent", "acsl_agent_manager", "super_admin_agent"].includes(userProfile.role)) {
      console.log("❌ Insufficient permissions");
      throw new Error(
        "Unauthorized: Access denied. Admin or Super Admin role required."
      );
    }

    // For acsl_agent (formerly super_admin_agent): resolve assigned org IDs (direct + state-based)
    let allowedOrgIds: string[] | null = null;
    if (userProfile.role === "acsl_agent" || userProfile.role === "acsl_agent_manager" || userProfile.role === "super_admin_agent") {
      const resolved = await resolveAssignedOrgIds(supabase, userId);
      allowedOrgIds = resolved.assignedOrgIds;
      console.log(
        `🔒 SAA allowed org IDs: ${resolved.directOrgIds.length} direct + ${resolved.stateResolvedOrgIds.length} state-resolved = ${allowedOrgIds.length} total`
      );
    }

    // Handle the stove ID route
    const result = await handleStoveIdRoute(
      req,
      supabase,
      userId,
      userProfile.role,
      userProfile.organization_id,
      allowedOrgIds
    );

    console.log("✅ Request processed successfully");

    // Return success response
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("❌ Error:", error);

    // Determine status code based on error type
    let statusCode = 500;
    if (
      error.message?.includes("Unauthorized") ||
      error.message?.includes("Invalid authentication")
    ) {
      statusCode = 401;
    } else if (error.message?.includes("Access denied")) {
      statusCode = 403;
    } else if (error.message?.includes("not allowed")) {
      statusCode = 405;
    } else if (error.message?.includes("required")) {
      statusCode = 400;
    }

    return new Response(
      JSON.stringify({
        error: error.message || "Internal server error",
        details: error.toString(),
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: statusCode,
      }
    );
  }
});
