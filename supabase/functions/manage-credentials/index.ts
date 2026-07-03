// Main entry point for manage-credentials edge function
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders, withCors } from "./cors.ts";
import { authenticateSuperAdmin } from "./authenticate.ts";
import { handleRequest } from "./route-handler.ts";

console.log("🔐 Manage Credentials Edge Function started");

serve(async (req) => {
  console.log("=".repeat(80));
  console.log("🔐 Manage Credentials Request Received");
  console.log("📅 Timestamp:", new Date().toISOString());
  console.log("🌐 Method:", req.method);
  console.log("🔗 URL:", req.url);
  console.log(
    "📋 Headers:",
    JSON.stringify(Object.fromEntries(req.headers.entries()), null, 2)
  );
  console.log("=".repeat(80));

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    console.log("✅ Handling CORS preflight request");
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  try {
    console.log("🔍 Starting authentication...");

    // Authenticate and verify Super Admin
    const authResult = await authenticateSuperAdmin(req);

    if (!authResult.success || !authResult.user || !authResult.supabase) {
      console.error("❌ Authentication failed!");
      console.error("❌ Error:", authResult.error);
      console.error("❌ User present:", !!authResult.user);
      console.error("❌ Supabase client present:", !!authResult.supabase);

      return withCors(
        new Response(
          JSON.stringify({
            success: false,
            error: authResult.error || "Authentication failed",
          }),
          { status: 401, headers: { "Content-Type": "application/json" } }
        )
      );
    }

    console.log("✅ Authentication successful!");
    console.log(`✅ Super Admin authenticated: ${authResult.user.email}`);
    console.log(`✅ User ID: ${authResult.user.id}`);
    console.log(`✅ Role: ${authResult.user.role}`);

    // Handle the request
    console.log("📨 Processing request...");
    const response = await handleRequest(
      req,
      authResult.supabase,
      authResult.user
    );
    console.log("✅ Request processed successfully");
    console.log("=".repeat(80));

    return response;
  } catch (error) {
    console.error("=".repeat(80));
    console.error("❌ Unexpected error in main handler!");
    console.error("❌ Error:", error);
    console.error("❌ Error message:", error.message);
    console.error("❌ Error stack:", error.stack);
    console.error("=".repeat(80));

    return withCors(
      new Response(
        JSON.stringify({
          success: false,
          error: "Internal server error",
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      )
    );
  }
});
