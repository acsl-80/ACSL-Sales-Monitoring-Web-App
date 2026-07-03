import { createClientComponentClient } from "@/lib/supabaseClient";

interface ProfileData {
  profile: {
    id: string;
    full_name: string;
    email: string;
    username: string;
    role: string;
    organization_id: string | null;
    created_at: string;
  };
  organization: {
    id: string;
    partner_id: string;
    partner_name: string;
    email?: string;
    contact_person?: string;
    contact_phone?: string;
    alternative_phone?: string;
    address?: string;
    state?: string;
    branch?: string;
    created_at?: string;
    stove_ids?: Array<{
      id: string;
      stove_id: string;
      status: string;
      organization_id: string;
    }>;
  } | null;
  credential_info?: {
    partner_id: string;
    partner_name: string;
    role: string;
    is_dummy_email: boolean;
  };
}

interface UpdateProfileParams {
  currentPassword: string;
  newUsername?: string;
  newEmail?: string;
  newPassword?: string;
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

class ManageProfileService {
  private supabase;
  private baseUrl =
    "https://oeiwnpngbnkhcismhpgs.supabase.co/functions/v1/manage-profile";

  constructor() {
    this.supabase = createClientComponentClient();
  }

  /**
   * Get the authorization header with Bearer token
   */
  private async getAuthHeader(): Promise<{ Authorization: string } | null> {
    const {
      data: { session },
    } = await this.supabase.auth.getSession();

    if (!session?.access_token) {
      return null;
    }

    return {
      Authorization: `Bearer ${session.access_token}`,
    };
  }

  /**
   * Get user profile and organization details
   */
  async getProfile(): Promise<ApiResponse<ProfileData>> {
    try {
      const authHeader = await this.getAuthHeader();

      if (!authHeader) {
        return {
          success: false,
          error: "Not authenticated. Please log in again.",
        };
      }

      const response = await fetch(this.baseUrl, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          ...authHeader,
        },
      });

      const result = await response.json();

      if (!response.ok) {
        return {
          success: false,
          error: result.error || "Failed to fetch profile",
        };
      }

      if (result.success && result.data) {
        return {
          success: true,
          data: result.data,
        };
      }

      return {
        success: false,
        error: "Invalid response from server",
      };
    } catch (error) {
      console.error("Error fetching profile:", error);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "An unexpected error occurred",
      };
    }
  }

  /**
   * Update user profile (username, email, and/or password)
   * Provide only the fields you want to update
   */
  async updateProfile(
    params: UpdateProfileParams
  ): Promise<ApiResponse<string[]>> {
    try {
      const authHeader = await this.getAuthHeader();

      if (!authHeader) {
        return {
          success: false,
          error: "Not authenticated. Please log in again.",
        };
      }

      // Build request body
      const body: Record<string, string> = {
        current_password: params.currentPassword,
      };

      if (params.newUsername?.trim()) {
        body.new_username = params.newUsername.trim();
      }
      if (params.newEmail?.trim()) {
        body.new_email = params.newEmail.trim();
      }
      if (params.newPassword?.trim()) {
        body.new_password = params.newPassword.trim();
      }

      // Validate that at least one field is being updated
      if (!body.new_username && !body.new_email && !body.new_password) {
        return {
          success: false,
          error: "Please provide at least one field to update",
        };
      }

      const response = await fetch(`${this.baseUrl}/update`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...authHeader,
        },
        body: JSON.stringify(body),
      });

      const result = await response.json();

      if (!response.ok) {
        return {
          success: false,
          error: result.error || "Failed to update profile",
        };
      }

      if (result.success) {
        return {
          success: true,
          data: result.updated_fields || [],
          message: result.message,
        };
      }

      return {
        success: false,
        error: "Invalid response from server",
      };
    } catch (error) {
      console.error("Error updating profile:", error);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "An unexpected error occurred",
      };
    }
  }
}

const manageProfileService = new ManageProfileService();
export default manageProfileService;
