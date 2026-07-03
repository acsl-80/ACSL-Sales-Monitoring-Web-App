import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, PATCH, OPTIONS",
};

const ROW_ID = "00000000-0000-0000-0000-000000000002";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function verifySuperAdmin(supabase: ReturnType<typeof createClient>, authHeader: string) {
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } } }
  );
  const { data: userData, error } = await userClient.auth.getUser();
  if (error || !userData?.user) throw new Error("Unauthorized");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userData.user.id)
    .single();

  if (profile?.role !== "super_admin") throw new Error("Super admin required");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // ── GET — public, no auth required (mobile app + web page use this) ──
    if (req.method === "GET") {
      const { data, error } = await supabase
        .from("app_releases")
        .select("*")
        .eq("id", ROW_ID)
        .single();

      if (error) throw new Error(error.message);
      return json(data);
    }

    // ── PATCH — super admin only ──
    if (req.method === "PATCH") {
      const authHeader = req.headers.get("Authorization") ?? "";
      await verifySuperAdmin(supabase, authHeader);

      const body = await req.json();

      // Whitelist updatable fields
      const allowed = [
        "version",
        "release_notes",
        "base_url",
        "apk_path",
        "is_force_update",
        "size",
        "requires",
        "features",
        "requirements",
      ];
      const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
      for (const key of allowed) {
        if (key in body) update[key] = body[key];
      }

      const { data, error } = await supabase
        .from("app_releases")
        .update(update)
        .eq("id", ROW_ID)
        .select()
        .single();

      if (error) throw new Error(error.message);
      return json({ success: true, data });
    }

    return json({ error: "Method not allowed" }, 405);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal server error";
    const status = msg.includes("Unauthorized") || msg.includes("super admin")
      ? 403
      : 500;
    return json({ error: msg }, status);
  }
});
