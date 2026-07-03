import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withCors } from "./cors.ts";
import { handleUserRoute } from "./route-handler.ts";
import { ALLOWED_CALLER_ROLES } from "./scope.ts";

serve(async (req) => {
  console.log("🚀 User Management API started");
  console.log("📥 Request:", req.method, req.url);

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    console.log("✅ CORS preflight handled");
    return withCors(new Response("ok", { status: 200 }));
  }

  try {
    // Add request timeout
    const REQUEST_TIMEOUT = 30000; // 30 seconds
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error("Request timeout - operation took too long")),
        REQUEST_TIMEOUT
      )
    );

    // Wrap the main logic in timeout
    const result = await Promise.race([executeMainLogic(req), timeoutPromise]);

    return result;
  } catch (error) {
    console.error("❌ Edge function error:", error);

    let errorMessage = "Internal server error";
    let statusCode = 500;

    if (error.message.includes("timeout")) {
      errorMessage = "Request timeout - operation took too long";
      statusCode = 408;
    } else if (error.message.includes("Unauthorized")) {
      errorMessage = "Access denied - insufficient privileges";
      statusCode = 403;
    } else if (error.message.includes("validation")) {
      errorMessage = error.message;
      statusCode = 400;
    } else if (error.message.includes("already exists")) {
      errorMessage = error.message;
      statusCode = 409;
    } else if (error.message.includes("not found")) {
      errorMessage = error.message;
      statusCode = 404;
    }

    return withCors(
      new Response(
        JSON.stringify({
          success: false,
          message: errorMessage,
          error: error.message,
          timestamp: new Date().toISOString(),
        }),
        { status: statusCode, headers: { "Content-Type": "application/json" } }
      )
    );
  }
});

async function executeMainLogic(req: Request) {
  const startTime = Date.now();

  try {
    // Initialize Supabase with service role key to bypass RLS
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

    const { data: userData, error: authError } =
      await userSupabase.auth.getUser();
    if (authError || !userData?.user) {
      console.log("❌ Invalid user token");
      throw new Error("Unauthorized: Invalid authentication");
    }

    const userId = userData.user.id;
    console.log("✅ User authenticated:", userId);

    // Get user's profile to check role using service role
    console.log("👤 Fetching user profile...");
    const { data: userProfile, error: profileError } = await supabase
      .from("profiles")
      .select("id, role, full_name, email, status, organization_id")
      .eq("id", userId)
      .single();

    if (profileError || !userProfile) {
      console.log("❌ Could not fetch user profile:", profileError);
      throw new Error("Unauthorized: User profile not found");
    }

    console.log("👤 User role:", userProfile.role);
    console.log("📊 User status:", userProfile.status);

    // Per RBAC matrix: super_admin (all users), acsl_agent_manager (scoped),
    // partner (own partner agents). All other roles have no User Manager access.
    if (!ALLOWED_CALLER_ROLES.includes(userProfile.role)) {
      console.log("❌ Insufficient permissions");
      throw new Error("Unauthorized: Access denied for this role.");
    }

    // Check if user account is active
    if (userProfile.status !== "active") {
      console.log("❌ Account not active");
      throw new Error("Unauthorized: Your account is not active.");
    }

    const caller = {
      id: userId,
      role: userProfile.role,
      organizationId: userProfile.organization_id || null,
    };

    // Handle the user route with the authenticated caller (row scoping applied per role)
    const result = await handleUserRoute(req, supabase, caller);

    // Prepare response
    const responseTime = Date.now() - startTime;
    const response = {
      success: true,
      ...result,
      timestamp: new Date().toISOString(),
      performance: {
        responseTime: `${responseTime}ms`,
        operation: req.method.toUpperCase(),
      },
    };

    console.log("📋 Response ready:", {
      success: response.success,
      operation: req.method.toUpperCase(),
      responseTime: `${responseTime}ms`,
    });

    return withCors(
      new Response(JSON.stringify(response), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache, no-store, must-revalidate",
          "X-Response-Time": String(responseTime),
        },
      })
    );
  } catch (error) {
    console.error("❌ Execution error:", error);
    throw error;
  }
}
