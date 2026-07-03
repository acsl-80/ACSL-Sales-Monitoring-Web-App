
import { createClientComponentClient } from "@/lib/supabaseClient";
import { supabaseUrl as SUPABASE_URL } from "@/lib/supabaseConfig";
import tokenManager from "@/utils/tokenManager";


interface Credential {
  partner_id: string;
  partner_name: string;
  email?: string;
  password: string;
  is_dummy_email: boolean;
  username: string;
  created_at: string;
  updated_at?: string;
  organizations?: {
    partner_name: string;
    contact_person?: string;
    state?: string;
    branch?: string;
    email?: string;
  };
}

interface ServiceResponse<T> {
  success: boolean;
  data: T | null;
  error: string | null;
  count?: number;
}

class AdminCredentialsService {
  private supabase;

  constructor() {
    this.supabase = createClientComponentClient();
  }

  /**
   * Get JWT token using tokenManager (with automatic refresh)
   */
  private async getToken(): Promise<string | null> {
    try {
      return await tokenManager.getValidToken();
    } catch (error) {
      console.error("🔑 [AdminCredentials] Token error:", error);
      return null;
    }
  }

  /**
   * Get authorization headers with JWT token
   */
  private async getHeaders(): Promise<HeadersInit> {
    const token = await this.getToken();
    const headers: HeadersInit = {
      "Content-Type": "application/json",
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    return headers;
  }

  /**
   * Get base API URL
   */
  private getApiUrl(): string {
    return `${SUPABASE_URL}/functions/v1/manage-credentials`;
  }



  /**
   * Fetch all credentials
   */
  async getAllCredentials(): Promise<ServiceResponse<Credential[]>> {
    try {
      const headers = await this.getHeaders();
      const response = await fetch(this.getApiUrl(), {
        method: "GET",
        headers,
      });

      if (!response.ok) {
        const errorData = await response.json();
        return {
          success: false,
          data: null,
          error: errorData.error || "Failed to fetch credentials",
        };
      }

      const result = await response.json();
      return {
        success: true,
        data: result.data || [],
        error: null,
        count: result.count || 0,
      };
    } catch (error) {
      console.error("Error fetching credentials:", error);
      return {
        success: false,
        data: null,
        error:
          error instanceof Error
            ? error.message
            : "An unexpected error occurred",
      };
    }
  }

  /**
   * Get credential by partner ID
   */
  async getCredentialByPartnerId(
    partnerId: string
  ): Promise<ServiceResponse<Credential>> {
    try {
      const headers = await this.getHeaders();
      const response = await fetch(
        `${this.getApiUrl()}?partner_id=${encodeURIComponent(partnerId)}`,
        {
          method: "GET",
          headers,
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        return {
          success: false,
          data: null,
          error: errorData.error || "Failed to fetch credential",
        };
      }

      const result = await response.json();
      return {
        success: true,
        data: result.data || null,
        error: null,
      };
    } catch (error) {
      console.error("Error fetching credential:", error);
      return {
        success: false,
        data: null,
        error:
          error instanceof Error
            ? error.message
            : "An unexpected error occurred",
      };
    }
  }

  /**
   * Reset password for an organization
   * Supports two modes:
   * 1. Auto-generate: API generates a secure password (customPassword not provided)
   * 2. Custom: Super Admin provides a custom password (customPassword provided)
   * Requires Super Admin password verification
   */
  async resetPassword(
    partnerId: string,
    superAdminPassword: string,
    customPassword?: string
  ): Promise<ServiceResponse<{ message: string; newPassword: string; passwordMode?: string }>> {
    try {
      const headers = await this.getHeaders();

      const body: any = {
        partner_id: partnerId,
        super_admin_password: superAdminPassword,
      };

      if (customPassword) {
        body.new_password = customPassword;
      }

      const response = await fetch(`${this.getApiUrl()}/update-password`, {
        method: "PUT",
        headers,
        body: JSON.stringify(body),
      });

      const result = await response.json();

      if (!response.ok) {
        return {
          success: false,
          data: null,
          error: result.error || "Failed to reset password",
        };
      }

      return {
        success: true,
        data: {
          message: result.message || "Password reset successfully",
          newPassword: result.newPassword || "",
          passwordMode: result.passwordMode,
        },
        error: null,
      };
    } catch (error) {
      console.error("Error resetting password:", error);
      return {
        success: false,
        data: null,
        error:
          error instanceof Error
            ? error.message
            : "An unexpected error occurred",
      };
    }
  }

  /**
   * Generate a secure random password
   */
  async generatePassword(length: number = 16): Promise<ServiceResponse<string>> {
    try {
      const headers = await this.getHeaders();
      const response = await fetch(`${this.getApiUrl()}/generate-password`, {
        method: "POST",
        headers,
        body: JSON.stringify({ length }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        return {
          success: false,
          data: null,
          error: errorData.error || "Failed to generate password",
        };
      }

      const result = await response.json();
      return {
        success: true,
        data: result.password || null,
        error: null,
      };
    } catch (error) {
      console.error("Error generating password:", error);
      return {
        success: false,
        data: null,
        error:
          error instanceof Error
            ? error.message
            : "An unexpected error occurred",
      };
    }
  }

  /**
   * Get current user's email from session
   */
  async getCurrentUserEmail(): Promise<string | null> {
    try {
      const {
        data: { session },
      } = await this.supabase.auth.getSession();
      return session?.user?.email || null;
    } catch (error) {
      console.error("Error getting current user email:", error);
      return null;
    }
  }
}

// Export singleton instance
const adminCredentialsService = new AdminCredentialsService();
export default adminCredentialsService;
export type { Credential, ServiceResponse };
