import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withCors } from "./cors.ts";
import { authenticate } from "./authenticate.ts";
import { approveSale } from "./writeOptions.ts";

serve(async (req) => {
  console.log("🚀 Approve Sale API started");
  console.log("📥 Request:", req.method, req.url);

  if (req.method === "OPTIONS") {
    return withCors(new Response("ok", { status: 200 }));
  }

  try {
    const REQUEST_TIMEOUT = 30000;
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Request timeout")), REQUEST_TIMEOUT)
    );

    const result = await Promise.race([executeMainLogic(req), timeoutPromise]);
    return result;
  } catch (error) {
    console.error("❌ Approve sale error:", error);

    let statusCode = 500;
    let errorMessage = "Internal server error";

    if (error.message?.includes("Unauthorized")) {
      statusCode = 403;
      errorMessage = error.message;
    } else if (error.message?.includes("not found")) {
      statusCode = 404;
      errorMessage = error.message;
    } else if (error.message?.includes("already approved")) {
      statusCode = 409;
      errorMessage = error.message;
    } else if (error.message?.includes("timeout")) {
      statusCode = 408;
      errorMessage = "Request timeout";
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

  if (req.method !== "PATCH") {
    throw new Error("Method not allowed. Use PATCH /approve-sale/{saleId}");
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  const authHeader = req.headers.get("Authorization") ?? "";
  const { userId, userRole } = await authenticate(supabase, authHeader);

  // Extract saleId from URL path
  const url = new URL(req.url);
  const pathParts = url.pathname.split("/").filter(Boolean);
  const fnIndex = pathParts.findIndex((p) => p === "approve-sale");
  const saleId = fnIndex >= 0 ? pathParts[fnIndex + 1] : null;

  if (!saleId) {
    throw new Error("Sale ID is required. Use PATCH /approve-sale/{saleId}");
  }

  const result = await approveSale(supabase, saleId, userId, userRole);
  const responseTime = Date.now() - startTime;

  return withCors(
    new Response(
      JSON.stringify({
        success: true,
        ...result,
        timestamp: new Date().toISOString(),
        performance: { responseTime: `${responseTime}ms` },
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache, no-store, must-revalidate",
        },
      }
    )
  );
}
