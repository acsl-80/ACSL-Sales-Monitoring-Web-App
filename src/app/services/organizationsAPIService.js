
import { createClientComponentClient } from "@/lib/supabaseClient";
import { safeFetchManager } from "../../utils/safeFetch";
import { supabaseUrl } from "@/lib/supabaseConfig";

class OrganizationsAPIService {
  constructor() {
    this.supabase = createClientComponentClient();
    this.baseUrl = supabaseUrl;
    this.functionName = "manage-organizations";
  }

  // Get auth headers
  async getAuthHeaders() {
    const {
      data: { session },
    } = await this.supabase.auth.getSession();

    if (!session?.access_token) {
      throw new Error("No authentication token found. Please login again.");
    }

    return {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    };
  }

  // Build URL with query parameters
  buildUrl(params = {}) {
    const baseUrl = `${this.baseUrl}/functions/v1/${this.functionName}`;
    const queryString = new window.URLSearchParams();

    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        queryString.append(key, value.toString());
      }
    });

    return queryString.toString()
      ? `${baseUrl}?${queryString.toString()}`
      : baseUrl;
  }

  // Get all organizations with pagination and filters
  async getAllOrganizations(
    params = {},
    componentName = "OrganizationsService"
  ) {
    try {
      const url = this.buildUrl(params);

      console.log(`🔍 [OrgsService] Making request:`, { url, params });

      // Use safe fetch manager
      const response = await safeFetchManager.safeFetch(
        url,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
        },
        {
          componentName,
          timeout: 30000,
          retryCount: 1,
        }
      );

      console.log(`🔍 [OrgsService] Response received:`, {
        success: response?.success || true,
        dataLength: response?.data?.length || 0,
      });

      return {
        success: true,
        data: response.data || [],
        pagination: response.pagination || {
          limit: params.limit || 50,
          offset: params.offset || 0,
          total: 0,
          totalPages: 0,
        },
        message: response.message || "Organizations retrieved successfully",
      };
    } catch (error) {
      console.error(`🔍 [OrgsService] Request failed:`, error.message);

      // Error handled by UI with toast
      return {
        success: false,
        error: error.message,
        data: [],
        pagination: { limit: 50, offset: 0, total: 0, totalPages: 0 },
      };
    }
  }

  // Get single organization by ID
  async getOrganization(id) {
    try {
      const headers = await this.getAuthHeaders();
      const url = `${this.baseUrl}/functions/v1/${this.functionName}/${id}`;

      const response = await fetch(url, {
        method: "GET",
        headers,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.message || `HTTP ${response.status}: ${response.statusText}`
        );
      }

      return {
        success: true,
        data: data.data,
        message: data.message || "Organization retrieved successfully",
      };
    } catch (error) {
      // Error handled by UI with toast
      return {
        success: false,
        error: error.message,
        data: null,
      };
    }
  }

  // Create new organization
  async createOrganization(organizationData) {
    try {
      const headers = await this.getAuthHeaders();
      const url = `${this.baseUrl}/functions/v1/${this.functionName}`;

      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(organizationData),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.message || `HTTP ${response.status}: ${response.statusText}`
        );
      }

      return {
        success: true,
        data: data.data,
        message: data.message || "Organization created successfully",
      };
    } catch (error) {
      // Error handled by UI with toast
      return {
        success: false,
        error: error.message,
        data: null,
      };
    }
  }

  // Update organization
  async updateOrganization(id, organizationData) {
    try {
      const headers = await this.getAuthHeaders();
      const url = `${this.baseUrl}/functions/v1/${this.functionName}/${id}`;

      const response = await fetch(url, {
        method: "PUT",
        headers,
        body: JSON.stringify(organizationData),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.message || `HTTP ${response.status}: ${response.statusText}`
        );
      }

      return {
        success: true,
        data: data.data,
        message: data.message || "Organization updated successfully",
      };
    } catch (error) {
      // Error handled by UI with toast
      return {
        success: false,
        error: error.message,
        data: null,
      };
    }
  }

  // Delete organization
  async deleteOrganization(id) {
    try {
      const headers = await this.getAuthHeaders();
      const url = `${this.baseUrl}/functions/v1/${this.functionName}/${id}`;

      const response = await fetch(url, {
        method: "DELETE",
        headers,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.message || `HTTP ${response.status}: ${response.statusText}`
        );
      }

      return {
        success: true,
        data: data.data,
        message: data.message || "Organization deleted successfully",
        warnings: data.warnings || [],
      };
    } catch (error) {
      // Error handled by UI with toast
      return {
        success: false,
        error: error.message,
        data: null,
      };
    }
  }

  // Export organizations data
  async exportOrganizations(params = {}, format = "csv") {
    try {
      const headers = await this.getAuthHeaders();
      const url = this.buildUrl({ ...params, export: format });

      const response = await fetch(url, {
        method: "GET",
        headers,
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(
          data.message || `HTTP ${response.status}: ${response.statusText}`
        );
      }

      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = `organizations-export-${
        new Date().toISOString().split("T")[0]
      }.${format}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(downloadUrl);

      return {
        success: true,
        message: `Organizations exported as ${format.toUpperCase()} successfully`,
      };
    } catch (error) {
      // Error handled by UI with toast
      return {
        success: false,
        error: error.message,
      };
    }
  }

  // Download file utility
  downloadFile(content, filename, contentType) {
    const blob = new window.Blob([content], { type: contentType });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  }
}

// Create and export a singleton instance
const organizationsAPIService = new OrganizationsAPIService();
export default organizationsAPIService;
