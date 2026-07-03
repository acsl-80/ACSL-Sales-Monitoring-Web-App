import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function generateToken(length = 32): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  for (const b of bytes) result += chars[b % chars.length];
  return result;
}

async function getSuperAdminProfile(supabase: any, authHeader: string) {
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: userData, error: authError } = await userClient.auth.getUser();
  if (authError || !userData?.user) {
    throw new Error("Unauthorized: Invalid or missing authentication token");
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, role, email")
    .eq("id", userData.user.id)
    .single();

  if (error || !profile || profile.role !== "super_admin") {
    throw new Error("Unauthorized: Super admin privileges required");
  }

  return profile;
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

    const authHeader = req.headers.get("Authorization") ?? "";
    await getSuperAdminProfile(supabase, authHeader);

    const url = new URL(req.url);
    const tokenId = url.searchParams.get("id");

    // GET — list all tokens
    if (req.method === "GET") {
      const { data, error } = await supabase
        .from("external_app_tokens")
        .select("id, application_name, application_description, token, allowed_urls, is_active, usage_count, last_used_at, created_at")
        .order("created_at", { ascending: false });

      if (error) throw new Error(`Failed to fetch tokens: ${error.message}`);
      return json({ success: true, data });
    }

    // POST — create new token
    if (req.method === "POST") {
      const body = await req.json();
      const { application_name, application_description, allowed_urls } = body;

      if (!application_name) {
        return json({ success: false, error: "application_name is required" }, 400);
      }

      const token = generateToken(40);
      const secret_key = generateToken(32);

      const { data, error } = await supabase
        .from("external_app_tokens")
        .insert({
          application_name,
          application_description: application_description || null,
          allowed_urls: allowed_urls || [],
          token,
          secret_key,
          is_active: true,
          usage_count: 0,
        })
        .select("id, application_name, application_description, token, secret_key, allowed_urls, is_active, created_at")
        .single();

      if (error) throw new Error(`Failed to create token: ${error.message}`);
      return json({ success: true, data, message: "Token created. Save the secret_key — it will not be shown again." });
    }

    // PATCH — update token (allowed_urls, is_active, application_description)
    if (req.method === "PATCH") {
      if (!tokenId) return json({ success: false, error: "id param required" }, 400);

      const body = await req.json();
      const allowed: Record<string, unknown> = {};
      if (body.allowed_urls !== undefined) allowed.allowed_urls = body.allowed_urls;
      if (body.is_active !== undefined) allowed.is_active = body.is_active;
      if (body.application_description !== undefined) allowed.application_description = body.application_description;
      if (body.application_name !== undefined) allowed.application_name = body.application_name;

      const { data, error } = await supabase
        .from("external_app_tokens")
        .update(allowed)
        .eq("id", tokenId)
        .select("id, application_name, application_description, token, allowed_urls, is_active")
        .single();

      if (error) throw new Error(`Failed to update token: ${error.message}`);
      return json({ success: true, data });
    }

    // DELETE — remove token
    if (req.method === "DELETE") {
      if (!tokenId) return json({ success: false, error: "id param required" }, 400);

      const { error } = await supabase
        .from("external_app_tokens")
        .delete()
        .eq("id", tokenId);

      if (error) throw new Error(`Failed to delete token: ${error.message}`);
      return json({ success: true, message: "Token deleted" });
    }

    return json({ success: false, error: "Method not allowed" }, 405);
  } catch (error) {
    console.error("❌ manage-app-tokens error:", error);
    const status = error.message.includes("Unauthorized") ? 403 : 500;
    return json({ success: false, error: error.message }, status);
  }
});
