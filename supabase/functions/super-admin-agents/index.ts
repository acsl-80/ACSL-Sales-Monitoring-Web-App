import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withCors } from "./cors.ts";
import { handleRoute } from "./routeHandlers.ts";

serve(async (req) => {
  console.log("🚀 Super Admin Agents API started");
  console.log("📥 Request:", req.method, req.url);

  // Handle CORS preflight
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
    console.error("❌ Edge function error:", error);

    let statusCode = 500;
    let errorMessage = "Internal server error";

    if (error.message?.includes("Unauthorized")) {
      statusCode = 403;
      errorMessage = error.message;
    } else if (error.message?.includes("not found")) {
      statusCode = 404;
      errorMessage = error.message;
    } else if (error.message?.includes("validation:")) {
      statusCode = 400;
      errorMessage = error.message.replace("validation: ", "");
    } else if (error.message?.includes("already exists")) {
      statusCode = 409;
      errorMessage = error.message;
    } else if (error.message?.includes("timeout")) {
      statusCode = 408;
      errorMessage = "Request timeout";
    } else if (error.message?.includes("Route not found")) {
      statusCode = 404;
      errorMessage = error.message;
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

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  const result = await handleRoute(req, supabase);

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
          "X-Response-Time": String(responseTime),
        },
      }
    )
  );
}
