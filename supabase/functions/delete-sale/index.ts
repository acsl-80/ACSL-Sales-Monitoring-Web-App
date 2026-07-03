import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withCors } from "./cors.ts";
import { authenticate } from "./authenticate.ts";
import { deleteSale } from "./deleteOptions.ts";

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return withCors(new Response("ok", { status: 200 }));
  }

  if (req.method !== "DELETE" && req.method !== "POST") {
    return withCors(
      new Response(JSON.stringify({ success: false, message: "Method not allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json" },
      })
    );
  }

  try {
    // Service role client for writes (bypasses RLS)
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const authHeader = req.headers.get("Authorization") || "";

    // Authenticate user
    const { userId, userRole, organizationId } = await authenticate(supabase, authHeader);

    // Get sale ID from URL query param or body
    const url = new URL(req.url);
    let saleId = url.searchParams.get("id");

    if (!saleId) {
      const body = await req.json().catch(() => ({}));
      saleId = body.id || body.saleId;
    }

    if (!saleId) {
      return withCors(
        new Response(JSON.stringify({ success: false, message: "Sale ID is required" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        })
      );
    }

    const result = await deleteSale(supabase, saleId, userRole, organizationId);

    return withCors(
      new Response(JSON.stringify({ success: true, ...result }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
  } catch (error: any) {
    console.error("❌ delete-sale error:", error.message);

    const isUnauthorized = error.message?.includes("Unauthorized");

    return withCors(
      new Response(
        JSON.stringify({ success: false, message: error.message }),
        {
          status: isUnauthorized ? 401 : 400,
          headers: { "Content-Type": "application/json" },
        }
      )
    );
  }
});
