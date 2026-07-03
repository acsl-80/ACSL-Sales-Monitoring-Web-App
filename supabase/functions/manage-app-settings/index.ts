import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const SETTINGS_ROW_ID = "00000000-0000-0000-0000-000000000001";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, role, full_name, email")
    .eq("id", userData.user.id)
    .single();

  if (profileError || !profile) {
    throw new Error("Unauthorized: User profile not found");
  }

  if (profile.role !== "super_admin") {
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

    // GET — fetch current settings (keys masked)
    if (req.method === "GET") {
      await getSuperAdminProfile(supabase, authHeader);

      const { data, error } = await supabase
        .from("app_settings")
        .select("google_places_api_key, google_maps_api_key, brevo_api_key, updated_at, updated_by")
        .eq("id", SETTINGS_ROW_ID)
        .single();

      if (error) throw new Error(`Failed to fetch settings: ${error.message}`);

      // Mask keys — return length and last 4 chars so admin can tell if set
      const masked = (key: string | null) => {
        if (!key) return null;
        return key.length > 4
          ? "*".repeat(key.length - 4) + key.slice(-4)
          : "****";
      };

      return json({
        success: true,
        data: {
          google_places_api_key: masked(data?.google_places_api_key),
          google_maps_api_key: masked(data?.google_maps_api_key),
          brevo_api_key: masked(data?.brevo_api_key),
          google_places_api_key_set: !!data?.google_places_api_key,
          google_maps_api_key_set: !!data?.google_maps_api_key,
          brevo_api_key_set: !!data?.brevo_api_key,
          updated_at: data?.updated_at,
          updated_by: data?.updated_by,
        },
      });
    }

    // POST — update settings (requires password verification via Supabase re-auth)
    if (req.method === "POST") {
      const profile = await getSuperAdminProfile(supabase, authHeader);
      const body = await req.json();

      const { google_places_api_key, google_maps_api_key, brevo_api_key, password } = body;

      // Verify password by attempting sign-in with the admin's email
      if (!password) {
        return json({ success: false, error: "Password confirmation required" }, 400);
      }

      const authClient = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_ANON_KEY") ?? ""
      );

      const { error: signInError } = await authClient.auth.signInWithPassword({
        email: profile.email,
        password,
      });

      if (signInError) {
        return json({ success: false, error: "Incorrect password" }, 401);
      }

      // Build update payload — only update fields that were provided
      const updatePayload: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
        updated_by: profile.id,
      };

      if (google_places_api_key !== undefined) {
        updatePayload.google_places_api_key = google_places_api_key || null;
      }
      if (google_maps_api_key !== undefined) {
        updatePayload.google_maps_api_key = google_maps_api_key || null;
      }
      if (brevo_api_key !== undefined) {
        updatePayload.brevo_api_key = brevo_api_key || null;
      }

      const { error: updateError } = await supabase
        .from("app_settings")
        .update(updatePayload)
        .eq("id", SETTINGS_ROW_ID);

      if (updateError) {
        throw new Error(`Failed to update settings: ${updateError.message}`);
      }

      return json({ success: true, message: "Settings updated successfully" });
    }

    return json({ success: false, error: "Method not allowed" }, 405);
  } catch (error) {
    console.error("❌ manage-app-settings error:", error);
    const status = error.message.includes("Unauthorized") ? 403 : 500;
    return json({ success: false, error: error.message }, status);
  }
});
