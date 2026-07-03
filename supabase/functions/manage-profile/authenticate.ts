// Authentication utilities for manage-profile edge function
import {
  createClient,
  SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2.39.3";

export interface AuthUser {
  id: string;
  email: string;
  role: string;
  full_name?: string;
  username?: string;
  organization_id?: string;
}

/**
 * Authenticate request and get user profile
 * Any authenticated user can access this endpoint
 */
export async function authenticateUser(req: Request): Promise<{
  success: boolean;
  user?: AuthUser;
  error?: string;
  supabase?: SupabaseClient;
}> {
  try {
    console.log("🔍 Starting authentication process...");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      console.error("❌ Missing Authorization header");
      return { success: false, error: "Missing Authorization header" };
    }

    // Extract JWT token
    const token = authHeader.replace("Bearer ", "");
    console.log("🔓 Extracted token length:", token.length);

    // Create Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: { Authorization: authHeader },
      },
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Get authenticated user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user) {
      console.error("❌ Invalid or expired token");
      return { success: false, error: "Invalid or expired token" };
    }

    console.log("✅ User authenticated:", user.id);

    // Get user profile
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      console.error("❌ Profile not found");
      return { success: false, error: "User profile not found" };
    }

    console.log("✅ Profile found:", profile.id);
    console.log("👤 User role:", profile.role);

    return {
      success: true,
      user: {
        id: user.id,
        email: user.email!,
        role: profile.role,
        full_name: profile.full_name,
        username: profile.username,
        organization_id: profile.organization_id,
      },
      supabase,
    };
  } catch (error) {
    console.error("❌ Authentication error:", error);
    return { success: false, error: "Authentication failed" };
  }
}
