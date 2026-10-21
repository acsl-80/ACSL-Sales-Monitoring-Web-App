// Returns the END_USER_RECORDS_API_KEY value — restricted to super_admin users.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
    const ANON =
      Deno.env.get("SUPABASE_ANON_KEY") ||
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ||
      "";
    const SERVICE =
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
      Deno.env.get("SERVICE_ROLE_KEY") ||
      "";

    if (!SUPABASE_URL || !ANON || !SERVICE) {
      return json(500, {
        success: false,
        error: "Server not configured (missing Supabase env vars)",
      });
    }

    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader) {
      return json(401, { success: false, error: "Missing Authorization header" });
    }

    const userClient = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return json(401, { success: false, error: "Unauthorized" });
    }

    const admin = createClient(SUPABASE_URL, SERVICE);

    // Prefer has_role RPC (matches rest of app); fall back to profiles.role;
    // final fallback to the well-known super admin email.
    let isSuperAdmin = false;
    try {
      const { data: hasRole } = await admin.rpc("has_role", {
        _user_id: userData.user.id,
        _role: "super_admin",
      });
      if (hasRole === true) isSuperAdmin = true;
    } catch (_) {
      // RPC may not exist — fall through
    }

    if (!isSuperAdmin) {
      const { data: profile } = await admin
        .from("profiles")
        .select("role")
        .eq("id", userData.user.id)
        .maybeSingle();
      if (profile?.role === "super_admin") isSuperAdmin = true;
    }

    if (!isSuperAdmin) {
      return json(403, { success: false, error: "Super admin access required" });
    }

    const key = Deno.env.get("END_USER_RECORDS_API_KEY") || "";
    if (!key) {
      return json(500, {
        success: false,
        error: "END_USER_RECORDS_API_KEY not configured",
      });
    }

    return json(200, { success: true, api_key: key });
  } catch (e) {
    return json(500, {
      success: false,
      error: (e as Error).message || "Internal error",
    });
  }
});
