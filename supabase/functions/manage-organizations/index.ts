import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withCors } from "./cors.ts";
import { authenticateOrganizationAccess } from "./authenticate.ts";
import { handleOrganizationRoute } from "./route-handler.ts";
import { resolveAssignedOrgIds } from "../_shared/resolveAssignedOrgIds.ts";

serve(async (req) => {
  console.log("🚀 Organizations Management API started");
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
    // Initialize Supabase client with service role for admin operations
    console.log("🔧 Initializing Supabase with service role...");
    const authHeader = req.headers.get("Authorization");
    console.log("🔑 Auth header present:", !!authHeader);

    // Create service role client for admin operations (user creation, etc.)
    const serviceSupabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Create user client for authentication verification
    const userSupabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      {
        global: {
          headers: {
            Authorization: authHeader ?? "",
          },
        },
      }
    );

    // Authenticate caller using user client
    console.log("🔐 Authenticating caller...");
    const { userId, userRole, isSuperAdmin, isOwnOrgReader, organizationId } =
      await authenticateOrganizationAccess(userSupabase);
    console.log(`✅ Authenticated ${userRole}: ${userId}`);

    // Non-super-admin roles are read-only. ACSL agents/managers are scoped to
    // their assigned organizations; partners to their own organization.
    // Writes remain super-admin only.
    let allowedOrgIds: string[] | null = null;
    if (!isSuperAdmin) {
      if (req.method.toUpperCase() !== "GET") {
        throw new Error("Unauthorized: Super admin privileges required");
      }
      if (isOwnOrgReader) {
        allowedOrgIds = organizationId ? [organizationId] : [];
      } else {
        const resolved = await resolveAssignedOrgIds(serviceSupabase, userId);
        allowedOrgIds = resolved.assignedOrgIds;
      }
      console.log(`🔒 Scoped read access: ${allowedOrgIds.length} allowed orgs`);
    }

    // Handle the organization route - pass both clients
    const result = await handleOrganizationRoute(
      req,
      serviceSupabase,
      userId,
      userRole,
      allowedOrgIds
    );

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
