// Get auth headers using tokenManager
import tokenManager from "../../utils/tokenManager";

async function getAuthHeaders() {
  try {
    const token = await tokenManager.getValidToken();
    if (!token) {
      throw new Error("No authentication token found. Please login again.");
    }
    return {
      Authorization: `Bearer ${token}`,
      // Do NOT set Content-Type here, let browser set it for FormData
    };
  } catch (error) {
    console.error("📄 [CSVImport] Token error:", error);
    throw new Error("Authentication failed. Please login again.");
  }
}

// Import CSV sales data for a specific organization (Supabase Edge Function)
async function importSalesCSV(supabase, organizationId, csvFile) {
  try {
    const headers = await getAuthHeaders();
    const formData = new FormData();
    formData.append("organization_id", organizationId);
    formData.append("file", csvFile);
    const baseUrl = import.meta.env.VITE_SUPABASE_URL;
    const functionUrl = `${baseUrl}/functions/v1/upload-stove-ids-csv`;
    const response = await fetch(functionUrl, {
      method: "POST",
      headers, // Only Authorization, browser sets Content-Type for FormData
      body: formData,
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || "Failed to import CSV data");
    }
    return {
      success: true,
      data: data,
      message: data.message || "CSV import completed successfully",
    };
  } catch (error) {
    throw new Error(error.message || "Failed to import CSV data");
  }
}

// Get import history for admin
async function getImportHistory(supabase, page = 1, limit = 20) {
  try {
    const authToken = await getAuthToken(supabase);
    const response = await fetch(
      `${import.meta.env.VITE_API_URL}/sales/import/history?page=${page}&limit=${limit}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
        },
      }
    );
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || "Failed to fetch import history");
    }
    return {
      success: true,
      data: data.imports || [],
      pagination: data.pagination || {},
    };
  } catch (error) {
    throw new Error(error.message || "Failed to fetch import history");
  }
}

// Get import details by ID
async function getImportDetails(supabase, importId) {
  try {
    const authToken = await getAuthToken(supabase);
    const response = await fetch(
      `${import.meta.env.VITE_API_URL}/sales/import/${importId}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
        },
      }
    );
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || "Failed to fetch import details");
    }
    return {
      success: true,
      data: data,
    };
  } catch (error) {
    throw new Error(error.message || "Failed to fetch import details");
  }
}

// Validate CSV format before import (client-side)
function validateCSVFormat(csvFile) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target.result;
        const lines = text.split("\n").filter((line) => line.trim());
        if (lines.length < 2) {
          return resolve({
            valid: false,
            error:
              "CSV file must contain at least a header row and one data row",
          });
        }
        const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
        const requiredHeaders = [
          "customer_name",
          "phone",
          "serial_number",
          "sales_date",
        ];
        const missingHeaders = requiredHeaders.filter(
          (req) =>
            !headers.some(
              (header) =>
                header.includes(req.replace("_", " ")) || header.includes(req)
            )
        );
        if (missingHeaders.length > 0) {
          return resolve({
            valid: false,
            error: `Missing required columns: ${missingHeaders.join(", ")}`,
            headers: headers,
            required: requiredHeaders,
          });
        }
        // Check data format in first few rows
        const sampleRows = lines.slice(1, Math.min(6, lines.length));
        const issues = [];
        sampleRows.forEach((row, index) => {
          const columns = row.split(",");
          if (columns.length !== headers.length) {
            issues.push(`Row ${index + 2}: Column count mismatch`);
          }
        });
        resolve({
          valid: issues.length === 0,
          error: issues.length > 0 ? issues.join("; ") : null,
          headers: headers,
          rowCount: lines.length - 1,
          preview: sampleRows.slice(0, 3),
        });
      } catch (error) {
        reject({
          valid: false,
          error: "Failed to parse CSV file: " + error.message,
        });
      }
    };
    reader.onerror = () => {
      reject({
        valid: false,
        error: "Failed to read CSV file",
      });
    };
    reader.readAsText(csvFile);
  });
}

// Download CSV template
function downloadCSVTemplate() {
  const headers = [
    "customer_name",
    "phone",
    "serial_number",
    "sales_date",
    "address",
    "city",
    "state",
    "amount",
  ];
  const sampleData = [
    "John Doe,08012345678,SN001,2024-01-15,123 Main St,Lagos,Lagos,15000",
    "Jane Smith,08087654321,SN002,2024-01-16,456 Oak Ave,Abuja,FCT,25000",
  ];
  const csvContent = [headers.join(","), ...sampleData].join("\n");
  const blob = new Blob([csvContent], { type: "text/csv" });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "sales_import_template.csv";
  link.click();
  window.URL.revokeObjectURL(url);
}

const csvImportService = {
  importSalesCSV,
  getImportHistory,
  getImportDetails,
  validateCSVFormat,
  downloadCSVTemplate,
};

export default csvImportService;
