// Admin Sales Service for sales management operations
import { createClientComponentClient } from "@/lib/supabaseClient";
import tokenManager from "../../utils/tokenManager";
import { supabaseUrl, supabaseFunctionsUrl } from "@/lib/supabaseConfig";

// Use the central config helper — it resolves VITE_/NEXT_PUBLIC_/REACT_APP_ env
// prefixes and falls back safely, so the base URL is never `undefined`.
const API_BASE_URL = supabaseUrl;
const API_FUNCTIONS_URL = supabaseFunctionsUrl;

class AdminSalesService {
  constructor() {
    this.supabase = createClientComponentClient();
    this.createSaleURL = `${API_BASE_URL}/functions/v1/create-sale`;
    this.uploadImageURL = `${API_BASE_URL}/functions/v1/upload-image`;
    this.getStovesURL = `${API_BASE_URL}/functions/v1/get-stove-ids`; // Updated to match Flutter
  }

  // Get token using tokenManager
  async getToken() {
    try {
      return await tokenManager.getValidToken();
    } catch (error) {
      console.error("💼 [AdminSales] Token error:", error);
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

  // Get available stove IDs for creating new sales - queries Supabase directly
  async getAvailableStoveIds(organizationId = null, status = "available") {
    try {
      let query = this.supabase
        .from("stove_ids")
        .select("id, stove_id, status, organization_id, created_at")
        .eq("is_archived", false)
        .order("stove_id", { ascending: true })
        .limit(2000);

      if (organizationId) {
        query = query.eq("organization_id", organizationId);
      }
      if (status) {
        // "available" = anything not sold
        if (status === "available") {
          query = query.neq("status", "sold");
        } else {
          query = query.eq("status", status);
        }
      }

      const { data, error } = await query;
      if (error) throw error;

      return {
        success: true,
        data: data || [],
        error: null,
      };
    } catch (error) {
      console.error("Error fetching available stoves:", error);
      return {
        success: false,
        data: [],
        error: error.message || "Failed to fetch available stoves",
      };
    }
  }

  // Search stove IDs for a partner (AJAX). Returns up to `limit` matches.
  async searchStoveIds(organizationId, term = "", limit = 20) {
    try {
      if (!organizationId) {
        return { success: true, data: [], error: null };
      }
      let query = this.supabase
        .from("stove_ids")
        .select("id, stove_id, status, organization_id")
        .eq("organization_id", organizationId)
        .eq("is_archived", false)
        .neq("status", "sold")
        .order("stove_id", { ascending: true })
        .limit(limit);
      const t = (term || "").trim();
      if (t) query = query.ilike("stove_id", `%${t}%`);
      const { data, error } = await query;
      if (error) throw error;
      return { success: true, data: data || [], error: null };
    } catch (error) {
      console.error("Error searching stove IDs:", error);
      return { success: false, data: [], error: error.message || "Failed to search stove IDs" };
    }
  }

  // Validate that a given stove_id exists, is available, and belongs to the partner org.
  async validateStoveId(organizationId, stoveId) {
    try {
      if (!organizationId || !stoveId) {
        return { success: true, valid: false, data: null, error: null };
      }
      const { data, error } = await this.supabase
        .from("stove_ids")
        .select("id, stove_id, status, organization_id, is_archived")
        .eq("organization_id", organizationId)
        .eq("stove_id", stoveId.trim())
        .maybeSingle();
      if (error) throw error;
      const valid = !!data && data.is_archived === false && data.status !== "sold";
      return { success: true, valid, data: data || null, error: null };
    } catch (error) {
      console.error("Error validating stove ID:", error);
      return { success: false, valid: false, data: null, error: error.message || "Failed to validate stove ID" };
    }
  }




  // Upload image for sales (stove images, agreement documents) - Updated to match Flutter
  async uploadImage(file, type) {
    try {
      if (!file) throw new Error("No file provided");

      // Try the edge function first (legacy path). If it isn't deployed or
      // fails for any reason, fall back to a direct Supabase Storage upload
      // so the form keeps working without infrastructure dependencies.
      const token = await this.getToken();
      try {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("type", type);
        const headers = {};
        if (token) headers.Authorization = `Bearer ${token}`;

        const response = await fetch(`${API_FUNCTIONS_URL}/upload-image`, {
          method: "POST",
          headers,
          body: formData,
        });

        if (response.ok) {
          const data = await response.json();
          return { success: true, data, error: null };
        }
        // fallthrough to direct upload on any non-OK response
        console.warn(
          `[uploadImage] edge function returned ${response.status}; falling back to direct storage upload`
        );
      } catch (edgeErr) {
        console.warn(
          "[uploadImage] edge function unavailable; falling back to direct storage upload",
          edgeErr?.message || edgeErr
        );
      }

      // ── Direct upload to Supabase Storage ───────────────────────────────
      const {
        data: { user },
        error: userError,
      } = await this.supabase.auth.getUser();
      if (userError || !user) throw new Error("Not authenticated");

      const safeName = (file.name || "upload")
        .replace(/[^a-zA-Z0-9._-]/g, "_")
        .slice(-80);
      const ext = safeName.includes(".") ? safeName.split(".").pop() : "bin";
      const folder = type === "agreementImage"
        ? "agreements"
        : type === "paymentProof"
        ? "payment-proofs"
        : "stove-images";
      const path = `${folder}/${user.id}/${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}.${ext}`;

      const { error: uploadError } = await this.supabase.storage
        .from("images")
        .upload(path, file, {
          cacheControl: "3600",
          upsert: false,
          contentType: file.type || undefined,
        });
      if (uploadError) throw new Error(uploadError.message);

      const { data: pub } = this.supabase.storage
        .from("images")
        .getPublicUrl(path);
      const publicUrl = pub?.publicUrl || path;

      const { data: uploadRow, error: insertError } = await this.supabase
        .from("uploads")
        .insert({
          public_id: path,
          url: publicUrl,
          type,
          created_by: user.id,
        })
        .select("id, public_id, url, type")
        .single();
      if (insertError) throw new Error(insertError.message);

      return {
        success: true,
        data: { upload: uploadRow, ...uploadRow },
        error: null,
      };
    } catch (error) {
      console.error("Error uploading image:", error);
      return {
        success: false,
        data: null,
        error: error.message || "Failed to upload image",
      };
    }
  }

  // Create a new sale
  async createSale(saleData) {
    try {
      const response = await fetch(`${API_FUNCTIONS_URL}/create-sale`, {
        method: "POST",
        headers: await this.getHeaders(),
        body: JSON.stringify(saleData),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.message || `HTTP ${response.status}: ${response.statusText}`
        );
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.message || "Failed to create sale");
      }

      return {
        success: true,
        data: result.data,
      };
    } catch (error) {
      console.error("Error creating sale:", error);
      return {
        success: false,
        error: error.message,
        data: null,
      };
    }
  }

  // Update an existing sale
  async updateSale(saleId, updateData) {
    try {
      const payload = {
        ...updateData,
      };

      const response = await fetch(
        `${API_FUNCTIONS_URL}/update-sale?id=${saleId}`,
        {
          method: "POST",
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
        throw new Error(result.message || "Failed to update sale");
      }

      return {
        success: true,
        data: result.data,
      };
    } catch (error) {
      console.error("Error updating sale:", error);
      return {
        success: false,
        error: error.message,
        data: null,
      };
    }
  }

  // Get individual sale details
  async getSale(saleId) {
    try {
      const response = await fetch(
        `${API_FUNCTIONS_URL}/get-sale?id=${saleId}`,
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
        throw new Error(result.message || "Failed to fetch sale details");
      }

      return {
        success: true,
        data: result.data,
      };
    } catch (error) {
      console.error("Error fetching sale:", error);
      return {
        success: false,
        error: error.message,
        data: null,
      };
    }
  }

  async exportSales(filters = {}, format = "csv") {
    try {
      const exportFilters = { ...filters, export: format };
      const headers = await this.getHeaders();
      const response = await fetch(this.getSalesAdvancedURL, {
        method: "POST",
        headers,
        body: JSON.stringify(exportFilters),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      // For CSV/XLSX, return blob for download
      if (format === "csv" || format === "xlsx") {
        const blob = await response.blob();
        return {
          success: true,
          data: blob,
          error: null,
        };
      }

      // For JSON, return parsed data
      const data = await response.json();
      return {
        success: true,
        data: data,
        error: null,
      };
    } catch (error) {
      console.error("Error exporting sales data:", error);
      return {
        success: false,
        data: null,
        error: error.message || "Failed to export sales data",
      };
    }
  }

  // Get sales (simple, direct call to edge function)
  async getSalesAdvanced({
    page = 1,
    limit = 50,
    query,
    from,
    to,
    state,
    lga,
  } = {}) {
    try {
      const queryParams = {
        page: page.toString(),
        limit: limit.toString(),
        ...(query ? { query } : {}),
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
        ...(state ? { state } : {}),
        ...(lga ? { lga } : {}),
      };

      const url = new URL(`${API_FUNCTIONS_URL}/get-sales`);
      Object.entries(queryParams).forEach(([key, value]) =>
        url.searchParams.append(key, value)
      );

      const response = await fetch(url.toString(), {
        method: "POST",
        headers: await this.getHeaders(),
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.message || `HTTP ${response.status}: ${response.statusText}`
        );
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.message || "Failed to fetch sales");
      }

      return {
        success: true,
        data: result.sales,
        pagination: result.pagination,
      };
    } catch (error) {
      console.error("Error fetching sales:", error);
      return {
        success: false,
        error: error.message,
        data: [],
        pagination: null,
      };
    }
  }

  // Get sales for financial reports (uses get-sales-advanced with POST body)
  /**
   * @param {{ page?: number; limit?: number; search?: string; paymentStatus?: string; dateFrom?: string; dateTo?: string; createdBy?: string; paymentModelId?: string }} [params]
   */
  async getFinancialReportSales({
    page = 1,
    limit = 500,
    search,
    paymentStatus,
    dateFrom,
    dateTo,
    createdBy,
    paymentModelId,
  } = {}) {
    try {
      const body = {
        page,
        limit,
        responseFormat: "format2",
        includeCreator: true,
        ...(search ? { search } : {}),
        ...(paymentStatus ? { paymentStatus } : {}),
        ...(dateFrom ? { dateFrom } : {}),
        ...(dateTo ? { dateTo } : {}),
        ...(createdBy ? { createdBy } : {}),
        ...(paymentModelId ? { paymentModelId } : {}),
      };

      const response = await fetch(
        `${API_FUNCTIONS_URL}/get-sales-advanced`,
        {
          method: "POST",
          headers: await this.getHeaders(),
          body: JSON.stringify(body),
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
        throw new Error(result.message || "Failed to fetch financial data");
      }

      return {
        success: true,
        data: result.data,
        pagination: result.pagination,
      };
    } catch (error) {
      console.error("Error fetching financial report sales:", error);
      return {
        success: false,
        error: error.message,
        data: [],
        pagination: null,
      };
    }
  }

  // Get full sales data for CSV export (includes address + cooking fields)
  async getSalesForExport({
    search,
    paymentStatus,
    dateFrom,
    dateTo,
    state,
    lga,
    organizationId,
    createdBy,
  } = {}) {
    try {
      const body = {
        page: 1,
        limit: 2000,
        responseFormat: "format2",
        includeAddress: true,
        includeCreator: true,
        ...(search ? { search } : {}),
        ...(paymentStatus && paymentStatus !== "all" ? { paymentStatus } : {}),
        ...(dateFrom ? { dateFrom } : {}),
        ...(dateTo ? { dateTo } : {}),
        ...(state && state !== "all" ? { state } : {}),
        ...(lga && lga !== "all" ? { lga } : {}),
        ...(organizationId && organizationId !== "all" ? { organizationId } : {}),
        ...(createdBy ? { createdBy } : {}),
      };

      const response = await fetch(
        `${API_FUNCTIONS_URL}/get-sales-advanced`,
        {
          method: "POST",
          headers: await this.getHeaders(),
          body: JSON.stringify(body),
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      if (!result.success) throw new Error(result.message || "Failed to fetch export data");

      return { success: true, data: result.data || [] };
    } catch (error) {
      console.error("Error fetching sales for export:", error);
      return { success: false, data: [], error: error.message };
    }
  }

  // Log sales activity
  async logSalesActivity(saleId, activityType, description, metadata = null) {
    try {
      const payload = {
        saleId,
        activityType,
        description,
        metadata,
      };

      const response = await fetch(`${API_FUNCTIONS_URL}/log-sales-activity`, {
        method: "POST",
        headers: await this.getHeaders(),
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.message || `HTTP ${response.status}: ${response.statusText}`
        );
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.message || "Failed to log activity");
      }

      return {
        success: true,
        data: result.data,
      };
    } catch (error) {
      console.error("Error logging sales activity:", error);
      return {
        success: false,
        error: error.message,
        data: null,
      };
    }
  }

  // Get sales activities for a sale
  async getSalesActivities(saleId = null, userId = null, page = 1, limit = 50) {
    try {
      const payload = {
        ...(saleId && { saleId }),
        ...(userId && { userId }),
        page,
        limit,
      };

      const response = await fetch(
        `${API_FUNCTIONS_URL}/get-sales-activities`,
        {
          method: "POST",
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
        throw new Error(result.message || "Failed to fetch activities");
      }

      return {
        success: true,
        data: result.data,
        pagination: result.pagination,
      };
    } catch (error) {
      console.error("Error fetching sales activities:", error);
      return {
        success: false,
        error: error.message,
        data: [],
        pagination: null,
      };
    }
  }

  // Delete a sale via edge function
  async deleteSale(saleId) {
    try {
      const response = await fetch(
        `${API_FUNCTIONS_URL}/delete-sale?id=${saleId}`,
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
        throw new Error(result.message || "Failed to delete sale");
      }

      return { success: true, data: result.data };
    } catch (error) {
      console.error("Error deleting sale:", error);
      return { success: false, error: error.message };
    }
  }

  // Cancel a sale: mark it archived + cancelled, and release the stove ID.
  // Uses direct Supabase writes so it works for any authenticated user
  // allowed by RLS on the sales / stove_ids tables.
  async cancelSale(saleId, reason = "") {
    try {
      if (!saleId) throw new Error("Sale ID is required");

      const { data: sale, error: fetchError } = await this.supabase
        .from("sales")
        .select("id, stove_serial_no, transaction_id")
        .eq("id", saleId)
        .single();

      if (fetchError || !sale) {
        throw new Error(fetchError?.message || "Sale not found");
      }

      // Release the stove back to available first, so a downstream failure
      // doesn't leave it stuck as sold.
      if (sale.stove_serial_no) {
        const { error: stoveResetError } = await this.supabase
          .from("stove_ids")
          .update({ sale_id: null, status: "available" })
          .eq("stove_id", sale.stove_serial_no);
        if (stoveResetError) {
          console.warn("⚠️ Could not reset stove status:", stoveResetError.message);
        }
      }

      const { data: userData } = await this.supabase.auth.getUser();
      const cancelledBy = userData?.user?.id ?? null;

      const primaryUpdate = {
        is_archived: true,
        cancelled_at: new Date().toISOString(),
        cancelled_by: cancelledBy,
        cancel_reason: reason || null,
      };

      let { error: updateError } = await this.supabase
        .from("sales")
        .update(primaryUpdate)
        .eq("id", saleId);

      if (updateError) {
        // Fallback if the extra cancellation columns don't exist yet.
        const { error: fallbackError } = await this.supabase
          .from("sales")
          .update({ is_archived: true })
          .eq("id", saleId);
        if (fallbackError) {
          throw new Error(fallbackError.message || updateError.message);
        }
        console.warn(
          "⚠️ Cancellation metadata columns missing; sale archived without reason.",
          updateError.message
        );
      }

      return {
        success: true,
        data: { id: saleId, transaction_id: sale.transaction_id },
      };
    } catch (error) {
      console.error("Error cancelling sale:", error);
      return { success: false, error: error.message };
    }
  }



  // Validate sale data before submission
  validateSaleData(saleData) {
    const errors = [];

    // Required fields validation
    if (!saleData.endUserName?.trim()) {
      errors.push("End user name is required");
    }
    if (!saleData.phone?.trim()) {
      errors.push("Phone number is required");
    }
    if (!saleData.partnerName?.trim()) {
      errors.push("Partner name is required");
    }
    if (!saleData.amount || saleData.amount <= 0) {
      errors.push("Valid sale amount is required");
    }
    if (!saleData.stoveSerialNo?.trim()) {
      errors.push("Stove serial number is required");
    }
    if (!saleData.stateBackup?.trim()) {
      errors.push("State is required");
    }
    if (!saleData.lgaBackup?.trim()) {
      errors.push("LGA is required");
    }

    // Address data validation
    if (!saleData.addressData) {
      errors.push("Address information is required");
    } else {
      if (!saleData.addressData.street?.trim()) {
        errors.push("Street address is required");
      }
      if (!saleData.addressData.city?.trim()) {
        errors.push("City is required");
      }
      if (typeof saleData.addressData.latitude !== "number") {
        errors.push("Valid latitude coordinate is required");
      }
      if (typeof saleData.addressData.longitude !== "number") {
        errors.push("Valid longitude coordinate is required");
      }
    }

    // Signature validation
    if (!saleData.signature?.trim()) {
      errors.push("Digital signature is required");
    }

    // Image validation
    if (!saleData.stoveImageId?.trim()) {
      errors.push("Stove image is required");
    }
    if (!saleData.agreementImageId?.trim()) {
      errors.push("Agreement document image is required");
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }
}

// Create and export a singleton instance
const adminSalesService = new AdminSalesService();
export default adminSalesService;
