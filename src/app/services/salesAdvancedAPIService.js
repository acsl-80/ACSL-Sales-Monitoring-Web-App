// API configuration and service for advanced sales data
import { createClientComponentClient } from "@/lib/supabaseClient";
import { safeFetchManager } from "../../utils/safeFetch";
import { formatSalesDataToCSV, downloadCSV } from "../../utils/csvExportUtils";
import { supabaseUrl } from "@/lib/supabaseConfig";

const API_BASE_URL = supabaseUrl;
const API_FUNCTIONS_URL = `${API_BASE_URL}/functions/v1`;

class SalesAdvancedService {
  constructor() {
    this.baseURL = `${API_FUNCTIONS_URL}/get-sales-advanced`;
    this.supabase = createClientComponentClient();
  }

  // Get token from Supabase session
  async getToken() {
    try {
      const {
        data: { session },
      } = await this.supabase.auth.getSession();
      return session?.access_token || null;
    } catch {
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

  // Main method to fetch sales data with filters
  async getSalesData(
    filters = {},
    method = "POST",
    componentName = "SalesService"
  ) {
    try {
      let url = this.baseURL;
      let options = {
        method,
        headers: {
          "Content-Type": "application/json",
        },
      };

      if (method === "GET") {
        // For GET requests, append filters as query parameters
        const queryParams = new window.URLSearchParams();
        Object.entries(filters).forEach(([key, value]) => {
          if (value !== null && value !== undefined && value !== "") {
            if (Array.isArray(value)) {
              value.forEach((item) => queryParams.append(`${key}[]`, item));
            } else {
              queryParams.append(key, value.toString());
            }
          }
        });

        if (queryParams.toString()) {
          url += `?${queryParams.toString()}`;
        }
      } else {
        // For POST requests, send filters in body
        options.body = JSON.stringify(filters);
      }

      console.log(`🔍 [SalesService] Making request:`, {
        method,
        url,
        filters,
      });

      // Use safe fetch manager
      const response = await safeFetchManager.safeFetch(url, options, {
        componentName,
        timeout: 45000, // 45 second timeout for sales data
        retryCount: 1, // Only retry once for sales data
      });

      console.log(`🔍 [SalesService] Response received:`, {
        success: response?.success,
        dataLength: response?.data?.length || 0,
      });

      return response;
    } catch (error) {
      console.error(`🔍 [SalesService] Request failed:`, error.message);
      throw new Error(`Failed to fetch sales data: ${error.message}`);
    }
  }

  // Simplified method for basic queries
  async getBasicSalesData(
    page = 1,
    limit = 100,
    sortBy = "created_at",
    sortOrder = "desc"
  ) {
    return this.getSalesData({
      page,
      limit,
      sortBy,
      sortOrder,
      includeAddress: true,
      includeCreator: true,
      includeImages: true,
    });
  }

  // Method for date-based queries
  async getSalesDataByDateRange(dateFrom, dateTo, additionalFilters = {}) {
    return this.getSalesData({
      dateFrom,
      dateTo,
      sortBy: "sales_date",
      sortOrder: "desc",
      includeAddress: true,
      includeCreator: true,
      ...additionalFilters,
    });
  }

  // Method for location-based queries
  async getSalesDataByLocation(
    states = [],
    cities = [],
    lgas = [],
    additionalFilters = {}
  ) {
    return this.getSalesData({
      ...(states.length && { states }),
      ...(cities.length && { cities }),
      ...(lgas.length && { lgas }),
      includeAddress: true,
      sortBy: "created_at",
      sortOrder: "desc",
      ...additionalFilters,
    });
  }

  // Method for amount-based queries
  async getSalesDataByAmount(amountMin, amountMax, additionalFilters = {}) {
    return this.getSalesData({
      amountMin,
      amountMax,
      sortBy: "amount",
      sortOrder: "desc",
      ...additionalFilters,
    });
  }

  // Method for search queries
  async searchSalesData(searchTerm, searchFields = [], additionalFilters = {}) {
    return this.getSalesData({
      search: searchTerm,
      ...(searchFields.length && { searchFields }),
      includeAddress: true,
      includeCreator: true,
      sortBy: "created_at",
      sortOrder: "desc",
      ...additionalFilters,
    });
  }

  // Method for exporting data
  async exportSalesData(filters = {}, format = "csv", exportFields = []) {
    const exportFilters = {
      ...filters,
      export: format,
      ...(exportFields.length && { exportFields }),
    };

    return this.getSalesData(exportFilters);
  }

  // Method to get quick stats
  async getSalesStats(filters = {}) {
    // This would typically be a separate endpoint, but we can calculate from the main data
    const data = await this.getSalesData({
      ...filters,
      limit: 1000, // Get enough data for stats calculation
      includeAddress: true,
    });

    if (data.success && data.data) {
      return this.calculateStats(data.data);
    }

    return {
      totalSales: 0,
      totalAmount: 0,
      totalCustomers: 0,
      avgSaleAmount: 0,
      topStates: [],
      topProducts: [],
    };
  }

  // Helper method to calculate statistics
  calculateStats(salesData) {
    const stats = {
      totalSales: salesData.length,
      totalAmount: salesData.reduce((sum, sale) => sum + (sale.amount || 0), 0),
      totalCustomers: new Set(salesData.map((sale) => sale.contact_person))
        .size,
      avgSaleAmount: 0,
      topStates: [],
      topProducts: [],
    };

    stats.avgSaleAmount =
      stats.totalSales > 0 ? stats.totalAmount / stats.totalSales : 0;

    // Calculate top states
    const stateGroups = salesData.reduce((acc, sale) => {
      const state = sale.state_backup || "Unknown";
      if (!acc[state]) {
        acc[state] = { name: state, count: 0, amount: 0 };
      }
      acc[state].count++;
      acc[state].amount += sale.amount || 0;
      return acc;
    }, {});

    stats.topStates = Object.values(stateGroups)
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);

    // Calculate top products (by stove serial number pattern)
    const productGroups = salesData.reduce((acc, sale) => {
      const product = sale.stove_serial_no?.substring(0, 3) || "Unknown";
      if (!acc[product]) {
        acc[product] = { name: product, count: 0, amount: 0 };
      }
      acc[product].count++;
      acc[product].amount += sale.amount || 0;
      return acc;
    }, {});

    stats.topProducts = Object.values(productGroups)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return stats;
  }

  // Method to download exported file
  downloadFile(content, filename, contentType = "text/csv") {
    if (typeof window === "undefined") return;

    const blob =
      content instanceof window.Blob
        ? content
        : new window.Blob([content], { type: contentType });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  }

  // Method to handle CSV export download with custom formatting
  async exportAndDownloadCSV(filters = {}, filename = null) {
    try {
      // Get the sales data instead of requesting CSV from backend
      const response = await this.getSalesData({
        ...filters,
        // Remove pagination for export to get all matching data
        limit: 10000, // Large limit to get all data
        page: 1,
      });

      if (!response.success || !response.data) {
        throw new Error(
          response.message || "Failed to fetch sales data for export"
        );
      }

      // Use our custom CSV formatter
      const csvContent = formatSalesDataToCSV(response.data);
      const downloadFilename =
        filename ||
        `sales-export-${new Date().toISOString().split("T")[0]}.csv`;

      downloadCSV(csvContent, downloadFilename);
      return true;
    } catch (error) {
      console.error("CSV export error:", error);
      throw new Error(`CSV export failed: ${error.message}`);
    }
  }

  // Method to handle Excel export download
  async exportAndDownloadExcel(filters = {}, filename = null) {
    // For now, fallback to CSV export since we're focusing on CSV format
    // You can implement Excel export later if needed
    return this.exportAndDownloadCSV(
      filters,
      filename?.replace(".xlsx", ".csv")
    );
  }
}

// Create and export a singleton instance
const salesAdvancedService = new SalesAdvancedService();

export default salesAdvancedService;
