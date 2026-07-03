// Custom hook for admin sales functionality
import { useState, useEffect } from "react";
import adminSalesService from "../services/adminSalesService";

export const useAdminSales = () => {
  const [loading, setLoading] = useState(true);
  const [tableLoading, setTableLoading] = useState(false);
  const [salesData, setSalesData] = useState([]);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 25,
    total: 0,
    totalPages: 0,
  });
  const [error, setError] = useState(null);

  const fetchSales = async (filters = {}) => {
    try {
      setTableLoading(true);
      setError(null);

      const finalFilters = {
        page: pagination.page,
        limit: pagination.limit,
        ...filters,
        includeAddress: true,
        includeImages: true,
        includeCreator: true,
        includeOrganization: true,
        sortBy: "created_at",
        sortOrder: "desc",
        responseFormat: "format2",
      };

      const response = await adminSalesService.getSalesAdvanced(finalFilters);

      if (response.success) {
        setSalesData(response.data || []);
        if (response.pagination) {
          setPagination(response.pagination);
        }
      } else {
        setError(response.error || "Failed to fetch sales data");
      }
    } catch (err) {
      console.error("Error fetching sales:", err);
      setError("An unexpected error occurred while fetching sales data");
    } finally {
      setLoading(false);
      setTableLoading(false);
    }
  };

  const applyFilters = (filters) => {
    setPagination((prev) => ({ ...prev, page: 1 }));
    fetchSales(filters);
  };

  const exportSales = async (filters = {}, format = "csv") => {
    try {
      setTableLoading(true);

      const exportFilters = {
        ...filters,
        export: format,
        limit: 10000, // Export more records
      };

      const response = await adminSalesService.getSalesAdvanced(exportFilters);

      if (response.success) {
        // Handle the exported data
        const filename = `admin-sales-export-${
          new Date().toISOString().split("T")[0]
        }.${format}`;
        const blob = new window.Blob([response.data], {
          type: format === "csv" ? "text/csv" : "application/json",
        });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
      } else {
        setError("Failed to export sales data");
      }
    } catch (err) {
      console.error("Export error:", err);
      setError("An error occurred while exporting data");
    } finally {
      setTableLoading(false);
    }
  };

  useEffect(() => {
    fetchSales();
  }, []);

  return {
    loading,
    tableLoading,
    salesData,
    pagination,
    error,
    fetchSales,
    applyFilters,
    exportSales,
    setPagination,
  };
};

export default useAdminSales;
