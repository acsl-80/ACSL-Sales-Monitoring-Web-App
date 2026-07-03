// Flexible Login Edge Function
// Supports login with EITHER username OR email + password
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

console.log(
  "🔐 Login with Credentials (Username OR Email) - Edge Function started"
);

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  try {
    const { identifier, password } = await req.json();

    // Validate input
    if (!identifier || !password) {
      return new Response(
        JSON.stringify({
          success: false,
          error:
            "Both identifier (username or email) and password are required",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log(`🔍 Login attempt with identifier: ${identifier}`);

    // Initialize Supabase clients
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // ============================================
    // STEP 1: Determine if identifier is email or username
    // ============================================
    let emailToUse: string;
    let isEmail = identifier.includes("@");

    if (isEmail) {
      // Identifier is already an email
      console.log("📧 Identifier detected as EMAIL");
      emailToUse = identifier.trim().toLowerCase();
    } else {
      // Identifier is a username - lookup email from profiles
      console.log("👤 Identifier detected as USERNAME, looking up email...");

      const { data: profile, error: profileError } = await adminClient
        .from("profiles")
        .select("email, id, full_name, role, organization_id, username")
        .eq("username", identifier.trim().toLowerCase())
        .single();

      if (profileError || !profile) {
        console.error("❌ Username not found:", identifier);
        return new Response(
          JSON.stringify({
            success: false,
            error: "Invalid username or password",
          }),
          {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      emailToUse = profile.email;
      console.log(`✅ Found email for username: ${identifier}`);
    }

    // ============================================
    // STEP 2: Authenticate with Supabase Auth
    // ============================================
    console.log(
      `🔑 Authenticating with email: ${emailToUse.substring(0, 5)}...`
    );

    const { data: authData, error: authError } =
      await supabase.auth.signInWithPassword({
        email: emailToUse,
        password: password,
      });

    if (authError || !authData.user) {
      console.error("❌ Authentication failed:", authError?.message);
      return new Response(
        JSON.stringify({
          success: false,
          error: "Invalid username or password",
        }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log(`✅ Authentication successful for user: ${authData.user.id}`);

    // ============================================
    // STEP 3: Get full user profile
    // ============================================
    const { data: userProfile, error: profileError } = await adminClient
      .from("profiles")
      .select("*")
      .eq("id", authData.user.id)
      .single();

    if (profileError || !userProfile) {
      console.error("❌ Failed to fetch user profile");
      return new Response(
        JSON.stringify({
          success: false,
          error: "Failed to fetch user profile",
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // ============================================
    // STEP 4: Return session with user data
    // ============================================
    console.log(`✅ Login successful for: ${userProfile.full_name}`);

    return new Response(
      JSON.stringify({
        success: true,
        session: authData.session,
        user: {
          id: userProfile.id,
          email: userProfile.username ? undefined : userProfile.email, // Only show email if no username
          username: userProfile.username,
          full_name: userProfile.full_name,
          role: userProfile.role,
          organization_id: userProfile.organization_id,
          has_changed_password: userProfile.has_changed_password,
          display_name: userProfile.username || userProfile.email.split("@")[0], // For UI display
        },
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("❌ Unexpected error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: "An unexpected error occurred",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
