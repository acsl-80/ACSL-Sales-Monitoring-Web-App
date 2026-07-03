
// Profile Service for fetching and managing user profile data
import { createClientComponentClient } from "@/lib/supabaseClient";

class ProfileService {
  constructor() {
    this.supabase = createClientComponentClient();
    this.STORAGE_KEY = "user_profile";
  }

  // Fetch user profile with organization data (similar to Flutter code)
  async fetchUserProfileWithOrganization(userId) {
    try {
      if (typeof window !== "undefined") {
        window.console.log("Fetching profile for user:", userId);
      }

      // Query profiles table with organization join using Supabase client
      const { data: response, error } = await this.supabase
        .from("profiles")
        .select(
          `
          id,
          email,
          full_name,
          phone,
          role,
          has_changed_password,
          created_at,
          organization_id,
          organizations(
            id,
            partner_name,
            branch,
            state,
            contact_person,
            contact_phone,
            alternative_phone,
            email,
            address,
            created_at,
            updated_at
          )
        `
        )
        .eq("id", userId)
        .maybeSingle();

      if (error) {
        throw error;
      }

      if (response) {
        // If the join didn't work but we have an organization_id, fetch it separately
        if (!response.organizations && response.organization_id) {
          const { data: orgResponse, error: orgError } = await this.supabase
            .from("organizations")
            .select(
              "id, partner_name, branch, state, contact_person, contact_phone, alternative_phone, email, address, created_at, updated_at"
            )
            .eq("id", response.organization_id)
            .maybeSingle();

          if (!orgError && orgResponse) {
            response.organization = orgResponse;
          }
        }

        return {
          success: true,
          data: response,
          error: null,
        };
      } else {
        if (typeof window !== "undefined") {
          window.console.warn("No profile found for user:", userId);
        }
        return {
          success: false,
          data: null,
          error: "Profile not found",
        };
      }
    } catch (error) {
      if (typeof window !== "undefined") {
        window.console.error("Error fetching profile:", error);
      }
      return {
        success: false,
        data: null,
        error: `Failed to fetch profile: ${error.message}`,
      };
    }
  }

  // Store profile data in localStorage
  storeProfileData(profileData) {
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(profileData));
        return true;
      } catch (error) {
        window.console.error("Error storing profile data:", error);
        return false;
      }
    }
    return false;
  }

  // Get profile data from localStorage
  getStoredProfileData() {
    if (typeof window !== "undefined") {
      try {
        const stored = localStorage.getItem(this.STORAGE_KEY);
        return stored ? JSON.parse(stored) : null;
      } catch (error) {
        window.console.error("Error getting stored profile data:", error);
        return null;
      }
    }
    return null;
  }

  // Get organization ID from stored profile
  getOrganizationId() {
    const profile = this.getStoredProfileData();
    return profile?.organization_id || null;
  }

  // Get user details from stored profile
  getUserDetails() {
    const profile = this.getStoredProfileData();
    if (!profile) return null;

    return {
      id: profile.id,
      email: profile.email,
      full_name: profile.full_name,
      phone: profile.phone,
      role: profile.role,
      organization_id: profile.organization_id,
      organization: profile.organization || profile.organizations,
    };
  }

  // Clear stored profile data (for logout)
  clearStoredProfileData() {
    if (typeof window !== "undefined") {
      try {
        localStorage.removeItem(this.STORAGE_KEY);
        return true;
      } catch (error) {
        window.console.error("Error clearing profile data:", error);
        return false;
      }
    }
    return false;
  }

  // Fetch and store profile data (to be called after login)
  async fetchAndStoreProfile() {
    try {
      const {
        data: { session },
      } = await this.supabase.auth.getSession();

      if (!session?.user?.id) {
        return {
          success: false,
          error: "No active session found",
        };
      }

      const profileResponse = await this.fetchUserProfileWithOrganization(
        session.user.id
      );

      if (profileResponse.success) {
        this.storeProfileData(profileResponse.data);
        return {
          success: true,
          data: profileResponse.data,
        };
      }

      return profileResponse;
    } catch (error) {
      if (typeof window !== "undefined") {
        window.console.error("Error in fetchAndStoreProfile:", error);
      }
      return {
        success: false,
        error: error.message,
      };
    }
  }
}

// Export singleton instance
const profileService = new ProfileService();
export default profileService;
