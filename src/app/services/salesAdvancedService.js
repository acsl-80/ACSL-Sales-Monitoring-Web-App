// Service for Advanced Sales API
// 
// IMPORTANT: This service ALWAYS uses Format 2 (Database Format) regardless of user role.
// - Format 1 is only shown in Super Admin documentation for external integration reference
// - Format 2 is used by all internal applications (Admin, Super Admin, Mobile)
// - The service automatically adds responseFormat: "format2" to all requests

import { supabaseUrl } from "@/lib/supabaseConfig";

const API_BASE_URL = supabaseUrl;
const API_FUNCTION_URL = `${API_BASE_URL}/functions/v1/get-sales-advanced`;

class SalesAdvancedService {
  constructor() {
    this.token = null;
  }

  setToken(token) {
    this.token = token;
  }

  getHeaders() {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.token}`,
    };
  }

  async fetchSales(filters = {}, method = "POST") {
    try {
      // Always use Format 2 for service requests
      const filtersWithFormat = {
        ...filters,
        responseFormat: "format2"
      };

      const options = {
        method: method,
        headers: this.getHeaders(),
      };

      if (method === "POST") {
        options.body = JSON.stringify(filtersWithFormat);
      } else {
        // For GET requests, convert filters to URL parameters
        const params = new window.URLSearchParams();
        Object.entries(filtersWithFormat).forEach(([key, value]) => {
          if (value !== null && value !== undefined && value !== "") {
            if (Array.isArray(value)) {
              value.forEach((v) => params.append(key, v));
            } else {
              params.append(key, value);
            }
          }
        });
        const url = `${API_FUNCTION_URL}?${params.toString()}`;
        options.url = url;
      }

      const response = await fetch(
        method === "POST" ? API_FUNCTION_URL : options.url,
        options
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error("Error fetching sales data:", error);
      throw error;
    }
  }

  async exportSales(filters = {}, format = "csv") {
    try {
      const exportFilters = { 
        ...filters, 
        export: format,
        responseFormat: "format2" // Always use Format 2 for exports
      };
      const response = await fetch(API_FUNCTION_URL, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify(exportFilters),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      // For CSV/XLSX, return blob for download
      if (format === "csv" || format === "xlsx") {
        const blob = await response.blob();
        return blob;
      }

      // For JSON, return parsed data
      const data = await response.json();
      return data;
    } catch (error) {
      console.error("Error exporting sales data:", error);
      throw error;
    }
  }

  downloadFile(blob, filename) {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.style.display = "none";
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  }

  // Helper methods for date filtering
  getDateRange(type) {
    const now = new Date();
    const ranges = {
      thisWeek: {
        start: new Date(now.setDate(now.getDate() - now.getDay())),
        end: new Date(now.setDate(now.getDate() - now.getDay() + 6)),
      },
      thisMonth: {
        start: new Date(now.getFullYear(), now.getMonth(), 1),
        end: new Date(now.getFullYear(), now.getMonth() + 1, 0),
      },
      thisYear: {
        start: new Date(now.getFullYear(), 0, 1),
        end: new Date(now.getFullYear(), 11, 31),
      },
      lastWeek: {
        start: new Date(now.setDate(now.getDate() - now.getDay() - 7)),
        end: new Date(now.setDate(now.getDate() - now.getDay() - 1)),
      },
      lastMonth: {
        start: new Date(now.getFullYear(), now.getMonth() - 1, 1),
        end: new Date(now.getFullYear(), now.getMonth(), 0),
      },
      lastYear: {
        start: new Date(now.getFullYear() - 1, 0, 1),
        end: new Date(now.getFullYear() - 1, 11, 31),
      },
    };

    return ranges[type];
  }

  // Convert quick date filters to actual date ranges
  processQuickDateFilters(filters) {
    const processed = { ...filters };

    Object.keys(filters).forEach((key) => {
      if (
        filters[key] === true &&
        [
          "thisWeek",
          "thisMonth",
          "thisYear",
          "lastWeek",
          "lastMonth",
          "lastYear",
        ].includes(key)
      ) {
        const range = this.getDateRange(key);
        if (range) {
          processed.dateFrom = range.start.toISOString();
          processed.dateTo = range.end.toISOString();
        }
        delete processed[key]; // Remove the boolean filter
      }
    });

    return processed;
  }

  // Validate filters before sending
  validateFilters(filters) {
    const validated = { ...filters };

    // Remove empty arrays
    Object.keys(validated).forEach((key) => {
      if (Array.isArray(validated[key]) && validated[key].length === 0) {
        delete validated[key];
      }
    });

    // Validate date formats
    const dateFields = [
      "dateFrom",
      "dateTo",
      "createdFrom",
      "createdTo",
      "salesDateFrom",
      "salesDateTo",
    ];
    dateFields.forEach((field) => {
      if (validated[field] && !(validated[field] instanceof Date)) {
        try {
          validated[field] = new Date(validated[field]).toISOString();
        } catch {
          console.warn(`Invalid date format for ${field}:`, validated[field]);
          delete validated[field];
        }
      }
    });

    return validated;
  }
}

// Export singleton instance
const salesService = new SalesAdvancedService();
export default salesService;
