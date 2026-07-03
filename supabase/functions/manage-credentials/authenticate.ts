// Authentication utilities for manage-credentials edge function
import {
  createClient,
  SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2.39.3";

export interface AuthUser {
  id: string;
  email: string;
  role: string;
  full_name?: string;
  organization_id?: string;
}

/**
 * Authenticate request and verify user is Super Admin
 */
export async function authenticateSuperAdmin(req: Request): Promise<{
  success: boolean;
  user?: AuthUser;
  error?: string;
  supabase?: SupabaseClient;
}> {
  try {
    console.log("🔍 Starting authentication process...");

    const authHeader = req.headers.get("Authorization");
    console.log("📋 Authorization header present:", !!authHeader);

    if (!authHeader) {
      console.error("❌ Missing Authorization header");
      return { success: false, error: "Missing Authorization header" };
    }

    console.log(
      "🔑 Authorization header format:",
      authHeader.substring(0, 20) + "..."
    );

    // Extract JWT token from Authorization header
    const token = authHeader.replace("Bearer ", "");
    console.log("🔓 Extracted token length:", token.length);

    // Create Supabase client with user's token
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    console.log("🌐 Supabase URL:", supabaseUrl);
    console.log("🔐 Creating Supabase client with token...");

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: { Authorization: authHeader },
      },
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    console.log("✅ Supabase client created");
    console.log("🔐 Setting session with extracted token...");

    // Set the session with the extracted token
    const { data: sessionData, error: sessionError } =
      await supabase.auth.setSession({
        access_token: token,
        refresh_token: token, // Using same token as we don't have refresh token
      });

    if (sessionError) {
      console.error("❌ Session error:", sessionError.message);
      console.error(
        "❌ Session error details:",
        JSON.stringify(sessionError, null, 2)
      );
      return { success: false, error: "Invalid or expired token" };
    }

    console.log("✅ Session set successfully");
    console.log("👤 Session user:", sessionData.user?.id);

    // Get authenticated user
    console.log("👤 Attempting to get user from token...");
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError) {
      console.error("❌ Auth error:", authError.message);
      console.error(
        "❌ Auth error details:",
        JSON.stringify(authError, null, 2)
      );
      return { success: false, error: "Invalid or expired token" };
    }

    if (!user) {
      console.error("❌ No user found in token");
      return { success: false, error: "Invalid or expired token" };
    }

    console.log("✅ User authenticated:", user.id);
    console.log("📧 User email:", user.email);

    // Get user profile to check role
    console.log("🔍 Fetching user profile from database...");
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();

    if (profileError) {
      console.error("❌ Profile fetch error:", profileError.message);
      console.error(
        "❌ Profile error details:",
        JSON.stringify(profileError, null, 2)
      );
      return { success: false, error: "User profile not found" };
    }

    if (!profile) {
      console.error("❌ No profile found for user:", user.id);
      return { success: false, error: "User profile not found" };
    }

    console.log("✅ Profile found:", profile.id);
    console.log("👤 Profile full name:", profile.full_name);
    console.log("🎭 User role:", profile.role);

    // Verify user is Super Admin
    if (profile.role !== "super_admin") {
      console.error("❌ Access denied - User role is:", profile.role);
      console.error("❌ Required role: super_admin");
      return {
        success: false,
        error: "Access denied. Only Super Admin can access this resource.",
      };
    }

    console.log("✅ Super Admin verified successfully!");
    console.log("✅ Granting access to:", user.email);

    return {
      success: true,
      user: {
        id: user.id,
        email: user.email!,
        role: profile.role,
        full_name: profile.full_name,
        organization_id: profile.organization_id,
      },
      supabase,
    };
  } catch (error) {
    console.error("❌ Unexpected authentication error:", error);
    console.error("❌ Error stack:", error.stack);
    return { success: false, error: "Authentication failed" };
  }
}

/**
 * Verify Super Admin's password before allowing critical operations
 */
export async function verifySuperAdminPassword(
  supabase: SupabaseClient,
  email: string,
  password: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Attempt to sign in with provided credentials
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email,
      password: password,
    });

    if (error) {
      return { success: false, error: "Invalid password" };
    }

    if (!data.user) {
      return { success: false, error: "Password verification failed" };
    }

    return { success: true };
  } catch (error) {
    console.error("Password verification error:", error);
    return { success: false, error: "Password verification failed" };
  }
}
