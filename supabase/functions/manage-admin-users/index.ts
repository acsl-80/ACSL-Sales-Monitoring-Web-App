import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withCors } from "./cors.ts";
import { authenticateSuperAdmin } from "./authenticate.ts";
import { handleAdminUserRoute } from "./route-handler.ts";

serve(async (req) => {
  console.log("🚀 Admin Users Management API started");
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
      errorMessage = "Access denied - Super admin privileges required";
      statusCode = 403;
    } else if (error.message.includes("validation")) {
      errorMessage = error.message;
      statusCode = 400;
    }

    return withCors(
      new Response(
        JSON.stringify({
          success: false,
          message: errorMessage,
          error: error.message,
          timestamp: new Date().toISOString(),
        }),
        { status: statusCode }
      )
    );
  }
});

async function executeMainLogic(req: Request) {
  const startTime = Date.now();

  try {
    // Initialize Supabase client
    console.log("🔧 Initializing Supabase...");
    const authHeader = req.headers.get("Authorization");
    console.log("🔑 Auth header present:", !!authHeader);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      {
        global: {
          headers: {
            Authorization: authHeader ?? "",
          },
        },
      }
    );

    // Authenticate super admin
    console.log("🔐 Authenticating super admin...");
    const { userId, userRole } = await authenticateSuperAdmin(supabase);
    console.log(`✅ Authenticated super admin: ${userId}`);

    // Handle the admin user route
    const result = await handleAdminUserRoute(req, supabase, userId, userRole);

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
