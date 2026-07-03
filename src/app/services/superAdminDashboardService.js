// Super Admin Dashboard Service for fetching super admin dashboard statistics
import { supabaseUrl } from "@/lib/supabaseConfig";
import { createClientComponentClient } from "@/lib/supabaseClient";
import tokenManager from "../../utils/tokenManager";

const API_BASE_URL = supabaseUrl;
const API_FUNCTIONS_URL = `${API_BASE_URL}/functions/v1`;

class SuperAdminDashboardService {
  constructor() {
    this.supabase = createClientComponentClient();
  }

  // Get token using tokenManager
  async getToken() {
    try {
      return await tokenManager.getValidToken();
    } catch (error) {
      console.error("🏢 [SuperAdminDashboard] Token error:", error);
      return null;
    }
  }

  // Helper method to build headers
  async getHeaders() {
    const token = await this.getToken();
    const headers = {
      "Content-Type": "application/json",
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    return headers;
  }

  // Get dashboard statistics for super admin
  async getDashboardStats(filters = {}) {
    try {
      const response = await fetch(
        `${API_FUNCTIONS_URL}/get-super-admin-dashboard`,
        {
          method: "POST",
          headers: await this.getHeaders(),
          body: JSON.stringify(filters),
        },
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.message ||
            `HTTP ${response.status}: ${response.statusText}`,
        );
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(
          result.message || "Failed to fetch dashboard statistics",
        );
      }

      return {
        success: true,
        data: result.data,
      };
    } catch (error) {
      console.error("Error fetching dashboard stats:", error);
      return {
        success: false,
        error: error.message,
        data: null,
      };
    }
  }
}

// Create and export a singleton instance
const superAdminDashboardService = new SuperAdminDashboardService();
export default superAdminDashboardService;
