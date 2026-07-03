import { safeFetchManager } from "../../utils/safeFetch";

class OrganizationCSVImportService {
  constructor() {
    this.baseUrl = import.meta.env.VITE_SUPABASE_URL;
    this.apiPath = "/functions/v1/manage-organizations";
  }

  /**
   * Parse CSV text content to JSON array
   * @param {string} csvText - Raw CSV text content
   * @returns {Array} Array of objects representing CSV rows
   */
  parseCSVToJSON(csvText) {
    const lines = csvText.trim().split("\n");
    if (lines.length < 2) {
      throw new Error(
        "CSV file must contain at least a header row and one data row"
      );
    }

    // Get headers from first line
    const headers = this.parseCSVLine(lines[0]);

    // Validate required headers
    const requiredHeaders = [
      "Sales Reference",
      "Sales Date",
      "Customer",
      "State",
      "Branch",
      "Quantity",
      "Downloaded by",
      "Stove IDs",
      "Sales Factory",
      "Sales Rep",
      "Partner ID",
      "Partner Address",
      "Partner Contact Person",
      "Partner Contact Phone",
      "Partner Alternative Phone",
      "Partner Email",
    ];

    const missingHeaders = requiredHeaders.filter(
      (header) => !headers.includes(header)
    );
    if (missingHeaders.length > 0) {
      throw new Error(`Missing required headers: ${missingHeaders.join(", ")}`);
    }

    // Parse data rows
    const data = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line) {
        // Skip empty lines
        const values = this.parseCSVLine(line);
        const row = {};

        headers.forEach((header, index) => {
          row[header] = values[index] || "";
        });

        // Check if this is essentially an empty row (all fields empty or just commas)
        const hasContent = Object.values(row).some(
          (value) => value && value.trim() !== ""
        );
        if (!hasContent) {
          console.log(`Skipping empty row ${i + 1}`);
          continue; // Skip rows with no actual content
        }

        // Validate that Partner ID is present (required for sync)
        if (!row["Partner ID"] || row["Partner ID"].trim() === "") {
          throw new Error(
            `Row ${i + 1}: Partner ID is required for synchronization`
          );
        }

        data.push(row);
      }
    }

    if (data.length === 0) {
      throw new Error("CSV file contains no valid data rows");
    }

    return data;
  }

  /**
   * Parse a single CSV line handling quoted values and commas
   * @param {string} line - CSV line to parse
   * @returns {Array} Array of field values
   */
  parseCSVLine(line) {
    const result = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          // Handle escaped quotes
          current += '"';
          i++; // Skip next quote
        } else {
          // Toggle quote state
          inQuotes = !inQuotes;
        }
      } else if (char === "," && !inQuotes) {
        // Field separator found outside quotes
        result.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }

    // Add the last field
    result.push(current.trim());

    return result;
  }

  /**
   * Validate CSV data before sending to API
   * @param {Array} csvData - Parsed CSV data array
   * @returns {Object} Validation result with isValid boolean and errors array
   */
  validateCSVData(csvData) {
    const errors = [];

    if (!Array.isArray(csvData) || csvData.length === 0) {
      errors.push("CSV data is empty or invalid");
      return { isValid: false, errors };
    }

    // Check for duplicate Partner IDs in the CSV
    const partnerIds = csvData.map((row) => row["Partner ID"]).filter(Boolean);
    const duplicateIds = partnerIds.filter(
      (id, index) => partnerIds.indexOf(id) !== index
    );
    if (duplicateIds.length > 0) {
      errors.push(
        `Duplicate Partner IDs found in CSV: ${[...new Set(duplicateIds)].join(
          ", "
        )}`
      );
    }

    // Validate required fields for organization creation
    csvData.forEach((row, index) => {
      const rowNumber = index + 1;

      // Partner ID is required
      if (!row["Partner ID"] || row["Partner ID"].trim() === "") {
        errors.push(`Row ${rowNumber}: Partner ID is required`);
      }

      // Customer name is required (becomes partner_name)
      if (!row["Customer"] || row["Customer"].trim() === "") {
        errors.push(`Row ${rowNumber}: Customer name is required`);
      }

      // State is required
      if (!row["State"] || row["State"].trim() === "") {
        errors.push(`Row ${rowNumber}: State is required`);
      }

      // Branch is required
      if (!row["Branch"] || row["Branch"].trim() === "") {
        errors.push(`Row ${rowNumber}: Branch is required`);
      }
    });

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Import organizations from CSV data
   * @param {SupabaseClient} supabase - Supabase client instance
   * @param {Array} csvData - Parsed and validated CSV data
   * @returns {Promise} API response with import results
   */
  async importOrganizationsFromCSV(supabase, csvData) {
    try {
      // Get current session token
      const session = await supabase.auth.getSession();
      if (!session?.data?.session?.access_token) {
        throw new Error("Authentication required. Please log in again.");
      }

      const token = session.data.session.access_token;

      // Validate CSV data
      const validation = this.validateCSVData(csvData);
      if (!validation.isValid) {
        throw new Error(
          `CSV validation failed:\n${validation.errors.join("\n")}`
        );
      }

      // Prepare the API request
      const url = `${this.baseUrl}${this.apiPath}?import_csv=true`;

      const result = await safeFetchManager.safeFetch(
        url,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(csvData),
        },
        {
          componentName: "OrganizationCSVImport",
          timeout: 30000,
        }
      );

      // Debug logging to help troubleshoot response structure
      console.log("Raw API Response:", result);

      // Validate and normalize the response structure to ensure consistency
      const normalizedData = {
        summary: result.data?.summary ||
          result.summary || {
            total_rows: csvData.length,
            organizations_created: 0,
            organizations_updated: 0,
            errors_count: 0,
          },
        created: result.data?.created || result.created || [],
        updated: result.data?.updated || result.updated || [],
        errors: result.data?.errors || result.errors || [],
      };

      // If no summary but we have results, try to calculate from the data
      if (!result.data?.summary && !result.summary) {
        normalizedData.summary = {
          total_rows: csvData.length,
          organizations_created: normalizedData.created.length,
          organizations_updated: normalizedData.updated.length,
          errors_count: normalizedData.errors.length,
        };
      }

      // Additional safety check: ensure summary has all required fields
      normalizedData.summary = {
        total_rows: normalizedData.summary.total_rows || 0,
        organizations_created:
          normalizedData.summary.organizations_created || 0,
        organizations_updated:
          normalizedData.summary.organizations_updated || 0,
        errors_count: normalizedData.summary.errors_count || 0,
      };

      return {
        success: true,
        data: normalizedData,
        message:
          result.message ||
          result.data?.message ||
          "Import completed successfully",
      };
    } catch (error) {
      console.error("CSV import error:", error);
      console.error("Error details:", {
        message: error.message,
        stack: error.stack,
        type: typeof error,
      });
      throw new Error(error.message || "Failed to import CSV data");
    }
  }

  /**
   * Read and process CSV file
   * @param {File} file - CSV file object
   * @returns {Promise<Array>} Parsed CSV data
   */
  async processCSVFile(file) {
    return new Promise((resolve, reject) => {
      if (!file) {
        reject(new Error("No file provided"));
        return;
      }

      if (!file.name.toLowerCase().endsWith(".csv")) {
        reject(new Error("Please select a valid CSV file"));
        return;
      }

      // Check file size (5MB limit)
      const maxSize = 5 * 1024 * 1024; // 5MB
      if (file.size > maxSize) {
        reject(
          new Error(
            "File size exceeds 5MB limit. Please split large imports into smaller batches."
          )
        );
        return;
      }

      const reader = new FileReader();

      reader.onload = (e) => {
        try {
          const csvText = e.target.result;
          const csvData = this.parseCSVToJSON(csvText);

          // Recommend splitting large datasets
          if (csvData.length > 1000) {
            console.warn(
              `Large dataset detected (${csvData.length} rows). Consider splitting into smaller batches for better performance.`
            );
          }

          resolve(csvData);
        } catch (error) {
          reject(error);
        }
      };

      reader.onerror = () => {
        reject(new Error("Failed to read CSV file"));
      };

      reader.readAsText(file);
    });
  }

  /**
   * Generate CSV template for download
   * @returns {Blob} CSV template file blob
   */
  generateCSVTemplate() {
    const headers = [
      "Sales Reference",
      "Sales Date",
      "Customer",
      "State",
      "Branch",
      "Quantity",
      "Downloaded by",
      "Stove IDs",
      "Sales Factory",
      "Sales Rep",
      "Partner ID",
      "Partner Address",
      "Partner Contact Person",
      "Partner Contact Phone",
      "Partner Alternative Phone",
      "Partner Email",
    ];

    const sampleData = [
      "TR-4591A1",
      "9/18/2025",
      "LAPO MFB",
      "Cross River",
      "OBUBRA",
      "40",
      "ACSL Admin",
      '"101034734, 101034900"',
      "Asaba",
      "Ejiro Emeotu",
      "9CF111",
      "Mile 1 park by former first bank obubra",
      "ANIEFIOK UDO",
      "7046023589",
      "N/A",
      "N/A",
    ];

    const csvContent = [headers.join(","), sampleData.join(",")].join("\n");

    return new window.Blob([csvContent], { type: "text/csv" });
  }

  /**
   * Download CSV template
   */
  downloadTemplate() {
    const blob = this.generateCSVTemplate();
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "organization_import_template.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  }
}

// Export singleton instance
const organizationCSVImportService = new OrganizationCSVImportService();
export default organizationCSVImportService;
