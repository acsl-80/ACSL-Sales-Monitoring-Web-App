// Read operations for manage-profile edge function
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

/**
 * Get complete user profile with organization details
 * Returns full organization details only if user is admin
 */
export async function getUserProfile(
  supabase: SupabaseClient,
  userId: string,
  userRole: string
): Promise<{
  success: boolean;
  data?: any;
  error?: string;
}> {
  try {
    console.log("📋 Fetching profile for user:", userId);
    console.log("🎭 User role:", userRole);

    // Get user profile
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single();

    if (profileError || !profile) {
      console.error("❌ Profile not found:", profileError);
      return { success: false, error: "Profile not found" };
    }

    console.log("✅ Profile retrieved");

    // Build response
    const response: any = {
      profile: {
        id: profile.id,
        full_name: profile.full_name,
        email: profile.email,
        username: profile.username,
        role: profile.role,
        organization_id: profile.organization_id,
        created_at: profile.created_at,
      },
    };

    // Get organization details if user has an organization
    if (profile.organization_id) {
      console.log("🏢 Fetching organization details...");

      const { data: organization, error: orgError } = await supabase
        .from("organizations")
        .select("*")
        .eq("id", profile.organization_id)
        .single();

      if (orgError) {
        console.warn("⚠️ Could not fetch organization:", orgError);
        response.organization = null;
      } else {
        console.log("✅ Organization retrieved:", organization.partner_name);

        // For admin users, return full organization details
        if (userRole === "admin" || userRole === "super_admin") {
          response.organization = organization;

          // Also get stove IDs for the organization
          const { data: stoveIds, error: stoveError } = await supabase
            .from("stove_ids")
            .select("*")
            .eq("organization_id", profile.organization_id);

          if (!stoveError && stoveIds) {
            response.organization.stove_ids = stoveIds;
            console.log(`✅ Found ${stoveIds.length} stove IDs`);
          }
        } else {
          // For non-admin users, return limited organization info
          response.organization = {
            id: organization.id,
            partner_name: organization.partner_name,
            partner_id: organization.partner_id,
            branch: organization.branch,
          };
          console.log("ℹ️ Returning limited organization details (non-admin)");
        }
      }
    } else {
      console.log("ℹ️ User has no organization");
      response.organization = null;
    }

    // Get credential info (if exists)
    const { data: credential, error: credError } = await supabase
      .from("credentials")
      .select("partner_id, partner_name, role, is_dummy_email")
      .eq("user_id", userId)
      .maybeSingle();

    if (!credError && credential) {
      response.credential_info = credential;
      console.log("✅ Credential info retrieved");
    }

    console.log("🎉 Profile data compiled successfully");

    return {
      success: true,
      data: response,
    };
  } catch (error) {
    console.error("❌ Error fetching profile:", error);
    return { success: false, error: "Failed to fetch profile" };
  }
}
