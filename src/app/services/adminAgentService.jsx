// Admin Agent Management Service
import { createClientComponentClient } from "@/lib/supabaseClient";
import tokenManager from "../../utils/tokenManager";
import { supabaseFunctionsUrl } from "@/lib/supabaseConfig";

const API_FUNCTIONS_URL = supabaseFunctionsUrl;

class AdminAgentService {
  constructor() {
    this.supabase = createClientComponentClient();
  }

  // Get token using tokenManager
  async getToken() {
    try {
      return await tokenManager.getValidToken();
    } catch (error) {
      console.error("👥 [AdminAgent] Token error:", error);
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

  // Get all sales agents for the admin's organization with pagination and filters
  async getSalesAgents(options = {}) {
    try {
      const {
        page = 1,
        limit = 10,
        search = "",
        sortBy = "created_at",
        sortOrder = "desc",
        organization_id = "",
      } = options;

      // Build query parameters
      const queryParams = new URLSearchParams({
        page: page.toString(),
        limit: limit.toString(),
        sortBy,
        sortOrder,
      });

      if (search) {
        queryParams.append("search", search);
      }

      if (organization_id) {
        queryParams.append("organization_id", organization_id);
      }

      const response = await fetch(
        `${API_FUNCTIONS_URL}/manage-agents?${queryParams}`,
        {
          method: "GET",
          headers: await this.getHeaders(),
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.message || `HTTP ${response.status}: ${response.statusText}`
        );
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.message || "Failed to fetch sales agents");
      }

      return {
        success: true,
        data: result.data,
        pagination: result.pagination,
        filters: result.filters,
      };
    } catch (error) {
      console.error("Error fetching sales agents:", error);
      return {
        success: false,
        error: error.message,
        data: [],
        pagination: null,
        filters: null,
      };
    }
  }

  // Get a single agent by ID
  async getAgent(agentId) {
    try {
      const response = await fetch(
        `${API_FUNCTIONS_URL}/manage-agents/${agentId}`,
        {
          method: "GET",
          headers: await this.getHeaders(),
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.message || `HTTP ${response.status}: ${response.statusText}`
        );
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.message || "Failed to fetch agent");
      }

      return {
        success: true,
        data: result.data,
      };
    } catch (error) {
      console.error("Error fetching agent:", error);
      return {
        success: false,
        error: error.message,
        data: null,
      };
    }
  }

  // Create a new sales agent
  async createAgent(name, email, password, phone = null) {
    try {
      const payload = {
        full_name: name.trim(),
        email: email.trim().toLowerCase(),
        password: password,
      };

      if (phone) {
        payload.phone = phone.trim();
      }

      const response = await fetch(`${API_FUNCTIONS_URL}/manage-agents`, {
        method: "POST",
        headers: await this.getHeaders(),
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));

        // If the error response has a structured format with specific error details
        if (errorData.error && errorData.error !== errorData.message) {
          throw new Error(errorData.error);
        } else if (errorData.message) {
          throw new Error(errorData.message);
        } else {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
      }

      const result = await response.json();

      if (!result.success) {
        // Combine message and error for clearer feedback
        let errorMessage = result.message || "Failed to create sales agent";
        if (result.error && result.error !== result.message) {
          errorMessage = result.error;
        }
        throw new Error(errorMessage);
      }

      return {
        success: true,
        data: result.data,
      };
    } catch (error) {
      console.error("Error creating sales agent:", error);
      return {
        success: false,
        error: error.message,
        data: null,
      };
    }
  }

  // Update an existing agent
  async updateAgent(agentId, updates) {
    try {
      const payload = {};

      // Only include fields that are being updated
      if (updates.full_name !== undefined) {
        payload.full_name = updates.full_name.trim();
      }
      if (updates.email !== undefined) {
        payload.email = updates.email.trim().toLowerCase();
      }
      if (updates.phone !== undefined) {
        payload.phone = updates.phone ? updates.phone.trim() : null;
      }

      // Ensure at least one field is being updated
      if (Object.keys(payload).length === 0) {
        throw new Error("At least one field must be provided for update");
      }

      const response = await fetch(
        `${API_FUNCTIONS_URL}/manage-agents/${agentId}`,
        {
          method: "PUT",
          headers: await this.getHeaders(),
          body: JSON.stringify(payload),
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.message || `HTTP ${response.status}: ${response.statusText}`
        );
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.message || "Failed to update agent");
      }

      return {
        success: true,
        data: result.data,
      };
    } catch (error) {
      console.error("Error updating agent:", error);
      return {
        success: false,
        error: error.message,
        data: null,
      };
    }
  }

  // Delete an agent
  async deleteAgent(agentId) {
    try {
      const response = await fetch(
        `${API_FUNCTIONS_URL}/manage-agents/${agentId}`,
        {
          method: "DELETE",
          headers: await this.getHeaders(),
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.message || `HTTP ${response.status}: ${response.statusText}`
        );
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.message || "Failed to delete agent");
      }

      return {
        success: true,
        data: result.data,
      };
    } catch (error) {
      console.error("Error deleting agent:", error);
      return {
        success: false,
        error: error.message,
        data: null,
      };
    }
  }

  // Validate agent creation data
  validateAgentData(name, email, password) {
    const errors = [];

    // Name validation
    if (!name?.trim()) {
      errors.push("Agent name is required");
    } else if (name.trim().length < 2) {
      errors.push("Agent name must be at least 2 characters long");
    } else if (name.trim().length > 100) {
      errors.push("Agent name must be less than 100 characters");
    }

    // Email validation
    if (!email?.trim()) {
      errors.push("Email address is required");
    } else {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email.trim())) {
        errors.push("Please enter a valid email address");
      }
    }

    // Password validation (per API docs: minimum 6 characters)
    if (password !== undefined) {
      if (!password) {
        errors.push("Password is required");
      } else if (password.length < 6) {
        errors.push("Password must be at least 6 characters long");
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  // Validate agent update data
  validateAgentUpdateData(updates) {
    const errors = [];

    // Name validation (if provided)
    if (updates.full_name !== undefined) {
      if (!updates.full_name?.trim()) {
        errors.push("Agent name cannot be empty");
      } else if (updates.full_name.trim().length < 2) {
        errors.push("Agent name must be at least 2 characters long");
      } else if (updates.full_name.trim().length > 100) {
        errors.push("Agent name must be less than 100 characters");
      }
    }

    // Email validation (if provided)
    if (updates.email !== undefined) {
      if (!updates.email?.trim()) {
        errors.push("Email address cannot be empty");
      } else {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(updates.email.trim())) {
          errors.push("Please enter a valid email address");
        }
      }
    }

    // Ensure at least one field is being updated
    const hasUpdates = Object.keys(updates).some(
      (key) => updates[key] !== undefined
    );
    if (!hasUpdates) {
      errors.push("At least one field must be provided for update");
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  // Generate a secure random password
  generateRandomPassword(length = 12) {
    const charset =
      "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*";
    let password = "";

    // Ensure at least one character from each category
    const lowercase = "abcdefghijklmnopqrstuvwxyz";
    const uppercase = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const numbers = "0123456789";
    const symbols = "!@#$%^&*";

    password += lowercase[Math.floor(Math.random() * lowercase.length)];
    password += uppercase[Math.floor(Math.random() * uppercase.length)];
    password += numbers[Math.floor(Math.random() * numbers.length)];
    password += symbols[Math.floor(Math.random() * symbols.length)];

    // Fill the rest randomly
    for (let i = password.length; i < length; i++) {
      password += charset[Math.floor(Math.random() * charset.length)];
    }

    // Shuffle the password
    return password
      .split("")
      .sort(() => Math.random() - 0.5)
      .join("");
  }

  // Get agent statistics
  async getAgentStats(agentId = null) {
    try {
      // This would call an endpoint to get agent-specific statistics
      // For now, we'll return a placeholder structure
      const payload = agentId ? { agentId } : {};

      // In a real implementation, this would be a separate endpoint
      // For now, we'll use the sales data to calculate basic stats
      const { default: adminSalesService } = await import(
        "./adminSalesService"
      );
      const salesResponse = await adminSalesService.getSalesAdvanced({
        ...(agentId && { createdBy: agentId }),
        limit: 1000, // Get enough data for stats
      });

      if (!salesResponse.success) {
        throw new Error("Failed to fetch sales data for statistics");
      }

      const sales = salesResponse.data || [];
      const totalSales = sales.length;
      const totalAmount = sales.reduce(
        (sum, sale) => sum + (sale.amount || 0),
        0
      );
      const avgSaleAmount = totalSales > 0 ? totalAmount / totalSales : 0;

      // Group by status
      const statusGroups = sales.reduce((acc, sale) => {
        const status = sale.status || "unknown";
        if (!acc[status]) acc[status] = 0;
        acc[status]++;
        return acc;
      }, {});

      return {
        success: true,
        data: {
          totalSales,
          totalAmount,
          avgSaleAmount,
          statusBreakdown: statusGroups,
          recentSales: sales.slice(0, 5), // Last 5 sales
        },
      };
    } catch (error) {
      console.error("Error fetching agent stats:", error);
      return {
        success: false,
        error: error.message,
        data: null,
      };
    }
  }
}

// Create and export a singleton instance
const adminAgentService = new AdminAgentService();
export default adminAgentService;
