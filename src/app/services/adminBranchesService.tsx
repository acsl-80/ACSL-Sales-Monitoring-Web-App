// Admin Branches Service for branch management operations
import { createClientComponentClient } from "@/lib/supabaseClient";
import tokenManager from "@/utils/tokenManager";
import type {
  Branch,
  BranchFilters,
  CreateBranchData,
  UpdateBranchData,
  BranchResponse,
  BranchesResponse,
} from "@/types/branches";

const API_BASE_URL = import.meta.env.VITE_SUPABASE_URL;
const API_FUNCTIONS_URL = `${API_BASE_URL}/functions/v1`;

class AdminBranchesService {
  private branchesURL: string;
  private supabase: any;

  constructor() {
    this.supabase = createClientComponentClient();
    this.branchesURL = `${API_FUNCTIONS_URL}/manage-branches`;
  }

  // Get token using tokenManager (with automatic refresh)
  async getToken() {
    try {
      return await tokenManager.getValidToken();
    } catch (error) {
      console.error("🏢 [AdminBranches] Token error:", error);
      return null;
    }
  }

  // Helper method to build headers
  async getHeaders() {
    const token = await this.getToken();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    return headers;
  }

  // Get branches by organization
  async getBranchesByOrganization(
    organizationId: string,
    filters: BranchFilters = {}
  ): Promise<{
    success: boolean;
    data: Branch[] | null;
    organization: any;
    pagination: any;
    error: string | null;
  }> {
    try {
      const queryParams = new URLSearchParams();

      if (filters.page) queryParams.append("page", filters.page.toString());
      if (filters.limit) queryParams.append("limit", filters.limit.toString());
      if (filters.search) queryParams.append("search", filters.search);
      if (filters.country) queryParams.append("country", filters.country);
      if (filters.state) queryParams.append("state", filters.state);

      const url = `${
        this.branchesURL
      }/organization/${organizationId}?${queryParams.toString()}`;

      const response = await fetch(url, {
        method: "GET",
        headers: await this.getHeaders(),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.message || `HTTP ${response.status}: ${response.statusText}`
        );
      }

      const result: BranchesResponse = await response.json();

      if (!result.success) {
        throw new Error(
          result.message || "Failed to fetch organization branches"
        );
      }

      return {
        success: true,
        data: result.data.branches,
        organization: result.data.organization,
        pagination: result.data.pagination,
        error: null,
      };
    } catch (error) {
      console.error("Error fetching organization branches:", error);
      return {
        success: false,
        data: null,
        organization: null,
        pagination: null,
        error:
          (error as Error).message || "Failed to fetch organization branches",
      };
    }
  }

  // Create a new branch
  async createBranch(
    organizationId: string,
    branchData: CreateBranchData
  ): Promise<{
    success: boolean;
    data: Branch | null;
    error: string | null;
  }> {
    try {
      const response = await fetch(
        `${this.branchesURL}/organization/${organizationId}`,
        {
          method: "POST",
          headers: await this.getHeaders(),
          body: JSON.stringify(branchData),
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.message || `HTTP ${response.status}: ${response.statusText}`
        );
      }

      const result: BranchResponse = await response.json();

      if (!result.success) {
        throw new Error(result.message || "Failed to create branch");
      }

      return {
        success: true,
        data: result.data.branch,
        error: null,
      };
    } catch (error) {
      console.error("Error creating branch:", error);
      return {
        success: false,
        data: null,
        error: (error as Error).message || "Failed to create branch",
      };
    }
  }

  // Get single branch
  async getBranch(branchId: string): Promise<{
    success: boolean;
    data: Branch | null;
    error: string | null;
  }> {
    try {
      const response = await fetch(`${this.branchesURL}/${branchId}`, {
        method: "GET",
        headers: await this.getHeaders(),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.message || `HTTP ${response.status}: ${response.statusText}`
        );
      }

      const result: BranchResponse = await response.json();

      if (!result.success) {
        throw new Error(result.message || "Failed to fetch branch");
      }

      return {
        success: true,
        data: result.data.branch,
        error: null,
      };
    } catch (error) {
      console.error("Error fetching branch:", error);
      return {
        success: false,
        data: null,
        error: (error as Error).message || "Failed to fetch branch",
      };
    }
  }

  // Update branch
  async updateBranch(
    branchId: string,
    updateData: UpdateBranchData
  ): Promise<{
    success: boolean;
    data: Branch | null;
    error: string | null;
  }> {
    try {
      const response = await fetch(`${this.branchesURL}/${branchId}`, {
        method: "PATCH",
        headers: await this.getHeaders(),
        body: JSON.stringify(updateData),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.message || `HTTP ${response.status}: ${response.statusText}`
        );
      }

      const result: BranchResponse = await response.json();

      if (!result.success) {
        throw new Error(result.message || "Failed to update branch");
      }

      return {
        success: true,
        data: result.data.branch,
        error: null,
      };
    } catch (error) {
      console.error("Error updating branch:", error);
      return {
        success: false,
        data: null,
        error: (error as Error).message || "Failed to update branch",
      };
    }
  }

  // Delete branch
  async deleteBranch(branchId: string): Promise<{
    success: boolean;
    data: any;
    error: string | null;
  }> {
    try {
      const response = await fetch(`${this.branchesURL}/${branchId}`, {
        method: "DELETE",
        headers: await this.getHeaders(),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.message || `HTTP ${response.status}: ${response.statusText}`
        );
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.message || "Failed to delete branch");
      }

      return {
        success: true,
        data: result.data,
        error: null,
      };
    } catch (error) {
      console.error("Error deleting branch:", error);
      return {
        success: false,
        data: null,
        error: (error as Error).message || "Failed to delete branch",
      };
    }
  }

  // Validate branch data before submission
  validateBranchData(branchData: CreateBranchData | UpdateBranchData): {
    isValid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    // Required fields validation
    if ("name" in branchData && !branchData.name?.trim()) {
      errors.push("Branch name is required");
    }

    // Length validation
    if (
      "name" in branchData &&
      branchData.name &&
      branchData.name.length > 100
    ) {
      errors.push("Branch name must be 100 characters or less");
    }

    if (branchData.country && branchData.country.length > 50) {
      errors.push("Country must be 50 characters or less");
    }

    if (branchData.state && branchData.state.length > 50) {
      errors.push("State must be 50 characters or less");
    }

    if (branchData.lga && branchData.lga.length > 50) {
      errors.push("LGA must be 50 characters or less");
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  // Get branch statistics (for stats cards)
  getBranchStats(branches: Branch[]) {
    const stats = {
      total: branches.length,
      byCountry: {} as Record<string, number>,
      byState: {} as Record<string, number>,
      recentlyCreated: 0,
    };

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    branches.forEach((branch) => {
      // Count by country
      const country = branch.country || "Unknown";
      stats.byCountry[country] = (stats.byCountry[country] || 0) + 1;

      // Count by state
      if (branch.state) {
        const state = branch.state;
        stats.byState[state] = (stats.byState[state] || 0) + 1;
      }

      // Count recently created
      const createdAt = new Date(branch.created_at);
      if (createdAt > sevenDaysAgo) {
        stats.recentlyCreated++;
      }
    });

    return stats;
  }
}

// Create and export a singleton instance
const adminBranchesService = new AdminBranchesService();
export default adminBranchesService;
