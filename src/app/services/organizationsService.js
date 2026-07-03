// Service for fetching organizations data from Supabase
import { createClientComponentClient } from "@/lib/supabaseClient";

class OrganizationsService {
  constructor() {
    this.supabase = createClientComponentClient();
  }

  // Fetch all organizations
  async getAllOrganizations() {
    try {
      const { data, error } = await this.supabase
        .from("organizations")
        .select(
          "id, partner_id, partner_name, branch, state, contact_person, contact_phone, alternative_phone, email, address, created_at, updated_at"
        )
        .order("partner_name", { ascending: true });

      if (error) {
        return {
          success: false,
          error: `Failed to fetch organizations: ${error.message}`,
          data: [],
        };
      }

      // Normalize the data to ensure we have a consistent name field
      const normalizedData = (data || []).map((org) => ({
        ...org,
        displayName:
          org.partner_name && org.partner_name.trim()
            ? org.partner_name
            : `Organization ${org.id}`,
      }));

      return {
        success: true,
        data: normalizedData,
        count: normalizedData.length,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        data: [],
      };
    }
  }

  // Fetch active organizations only (if you add a status field later)
  async getActiveOrganizations() {
    try {
      // Since there's no status field, just return all organizations
      // You can modify this later if you add a status field to your table
      return await this.getAllOrganizations();
    } catch (error) {
      return {
        success: false,
        error: error.message,
        data: [],
      };
    }
  }

  // Get organization by ID
  async getOrganizationById(id) {
    try {
      const { data, error } = await this.supabase
        .from("organizations")
        .select(
          "id, partner_id, partner_name, branch, state, contact_person, contact_phone, alternative_phone, email, address, created_at, updated_at"
        )
        .eq("id", id)
        .single();

      if (error) {
        return {
          success: false,
          error: `Failed to fetch organization: ${error.message}`,
          data: null,
        };
      }

      return {
        success: true,
        data: {
          ...data,
          displayName:
            data.partner_name && data.partner_name.trim()
              ? data.partner_name
              : `Organization ${data.id}`,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        data: null,
      };
    }
  }

  // Search organizations by name
  async searchOrganizations(searchTerm) {
    try {
      const { data, error } = await this.supabase
        .from("organizations")
        .select(
          "id, partner_id, partner_name, branch, state, contact_person, contact_phone, alternative_phone, email, address, created_at, updated_at"
        )
        .ilike("partner_name", `%${searchTerm}%`)
        .order("partner_name", { ascending: true });

      if (error) {
        return {
          success: false,
          error: `Failed to search organizations: ${error.message}`,
          data: [],
        };
      }

      // Normalize the data
      const normalizedData = (data || []).map((org) => ({
        ...org,
        displayName:
          org.partner_name && org.partner_name.trim()
            ? org.partner_name
            : `Organization ${org.id}`,
      }));

      return {
        success: true,
        data: normalizedData,
        count: normalizedData.length,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        data: [],
      };
    }
  }
}

// Create and export a singleton instance
const organizationsService = new OrganizationsService();

export default organizationsService;
