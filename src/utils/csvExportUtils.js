/**
 * CSV Export Utilities
 * Formats sales data for CSV export according to specific requirements
 */

/**
 * Formats sales data into the specified CSV format
 * @param {Array} salesData - Array of SuperAdminSale objects
 * @returns {string} CSV formatted string
 */
export const formatSalesDataToCSV = (salesData) => {
  if (!salesData || !Array.isArray(salesData) || salesData.length === 0) {
    console.warn("CSV Export: No sales data provided or empty array");
    return getCSVHeaders().join(",") + "\n"; // Return headers only if no data
  }

  console.log(`CSV Export: Processing ${salesData.length} sales records`);

  // Log first record structure for debugging
  if (salesData.length > 0) {
    console.log("CSV Export: First record structure:", {
      id: salesData[0].id,
      hasAddresses: !!salesData[0].addresses,
      addressesType: typeof salesData[0].addresses,
      hasOrganizations: !!salesData[0].organizations,
      organizationsType: typeof salesData[0].organizations,
      hasPartnerName: !!salesData[0].partner_name,
      partnerNameType: typeof salesData[0].partner_name,
    });
  }

  const headers = getCSVHeaders();
  const rows = salesData.map((sale, index) => {
    try {
      return formatSaleToCSVRow(sale);
    } catch (error) {
      console.error(`CSV Export: Error formatting row ${index}:`, error, sale);
      // Return empty row with same number of columns to maintain CSV structure
      return new Array(headers.length).fill("").join(",");
    }
  });

  return [headers.join(","), ...rows].join("\n");
};

/**
 * Gets the CSV headers in the specified format
 * @returns {Array} Array of header strings
 */
const getCSVHeaders = () => {
  return [
    "Serial Number",
    "Sales Date",
    "Created",
    "State",
    "District/LGA",
    "Address",
    "Latitude",
    "Longitude",
    "Phone",
    "Contact Person",
    "Other Contact Phone",
    "Sales Partner/Field Assistant",
    "User Name",
    "User Surname",
    "CPA",
    // Additional details
    "Transaction ID",
    "AKA",
    "Retailer/Branch",
    "Pot Quantity",
    "Heat Retention Device (Wonderbox)",
    "Previous Stove Type",
    "Previous Stove Other",
    "Meals Per Day",
    "Cooking Fuel Source",
    "Cooking Location",
    "Payment Type",
    "Payment Status",
  ];
};

/**
 * Formats a single sale object into a CSV row
 * @param {Object} sale - SuperAdminSale object
 * @returns {string} CSV formatted row
 */
const formatSaleToCSVRow = (sale) => {
  // Safe helper to extract string values
  const safeExtract = (value, fallback = "") => {
    if (!value) return fallback;
    if (typeof value === "string") return value;
    if (typeof value === "number") return value.toString();
    if (typeof value === "object") {
      // If it's an array, try the first element
      if (Array.isArray(value)) {
        return safeExtract(value[0], fallback);
      }
      // Try common object properties
      if (value.name) return value.name;
      if (value.full_name) return value.full_name;
      if (value.value) return value.value;
      if (value.toString && typeof value.toString === "function") {
        const stringVal = value.toString();
        if (stringVal !== "[object Object]") return stringVal;
      }
    }
    return fallback;
  };

  // Extract user name parts
  const { firstName, lastName } = extractUserName(
    safeExtract(sale.end_user_name) || safeExtract(sale.contact_person)
  );

  // Handle potential object values in addresses
  const addresses = sale.addresses || sale.address || {};
  const addressLatitude = safeExtract(addresses.latitude);
  const addressLongitude = safeExtract(addresses.longitude);
  const addressState = safeExtract(addresses.state);
  const addressCity = safeExtract(addresses.city);

  const previousStoveLabel = (type, other) => {
    if (!type) return "";
    if (type === "wood_stove") return "Wood Stove (3 stone)";
    if (type === "charcoal") return "Charcoal Stove";
    if (type === "other") return other ? `Other - ${other}` : "Other";
    return type;
  };

  // Format the row data
  const rowData = [
    cleanCSVValue(safeExtract(sale.stove_serial_no)),
    formatDateForCSV(sale.sales_date),
    formatDateTimeForCSV(sale.created_at ? new Date(sale.created_at) : new Date()),
    cleanCSVValue(safeExtract(sale.state_backup) || addressState),
    cleanCSVValue(safeExtract(sale.lga_backup) || addressCity),
    cleanCSVValue(getFullAddress(addresses)),
    cleanCSVValue(addressLatitude),
    cleanCSVValue(addressLongitude),
    cleanCSVValue(formatPhoneNumber(safeExtract(sale.phone) || safeExtract(sale.contact_phone))),
    cleanCSVValue(safeExtract(sale.contact_person) || safeExtract(sale.end_user_name)),
    cleanCSVValue(formatPhoneNumber(safeExtract(sale.other_phone))),
    cleanCSVValue(getSalesPartner(sale)),
    cleanCSVValue(firstName),
    cleanCSVValue(lastName),
    // CPA — not yet defined, placeholder
    "",
    // Additional fields
    cleanCSVValue(safeExtract(sale.transaction_id)),
    cleanCSVValue(safeExtract(sale.aka)),
    cleanCSVValue(safeExtract(sale.retailer_branch)),
    sale.pot_quantity != null ? String(sale.pot_quantity) : "",
    sale.heat_retention_device != null ? (sale.heat_retention_device ? "Yes" : "No") : "",
    cleanCSVValue(previousStoveLabel(sale.previous_stove_type, sale.previous_stove_other)),
    cleanCSVValue(safeExtract(sale.previous_stove_other)),
    cleanCSVValue(safeExtract(sale.meals_per_day)),
    cleanCSVValue(safeExtract(sale.cooking_fuel_source)),
    cleanCSVValue(safeExtract(sale.cooking_location)),
    sale.is_installment ? "Installment" : "Full Payment",
    cleanCSVValue(safeExtract(sale.payment_status)),
  ];

  return rowData.join(",");
};

/**
 * Extracts first and last name from a full name string
 * @param {string} fullName - Full name string
 * @returns {Object} Object with firstName and lastName
 */
const extractUserName = (fullName) => {
  if (!fullName || typeof fullName !== "string") {
    return { firstName: "", lastName: "" };
  }

  const nameParts = fullName
    .trim()
    .split(" ")
    .filter((part) => part.length > 0);

  if (nameParts.length === 0) {
    return { firstName: "", lastName: "" };
  } else if (nameParts.length === 1) {
    return { firstName: nameParts[0], lastName: "" };
  } else {
    return {
      firstName: nameParts[0],
      lastName: nameParts.slice(1).join(" "),
    };
  }
};

/**
 * Gets the full address string, avoiding [Object Object] issues
 * @param {Object} address - Address object
 * @returns {string} Formatted address string
 */
const getFullAddress = (address) => {
  if (!address || typeof address !== "object") {
    return "";
  }

  // Handle the case where address itself might be an array or nested object
  if (Array.isArray(address)) {
    address = address[0] || {};
  }

  // If there's a full_address field, use it
  if (address.full_address && typeof address.full_address === "string") {
    return address.full_address;
  }

  // Otherwise, construct address from parts
  const addressParts = [];

  // Try different possible field names
  const possibleStreetFields = [
    "street",
    "address_line_1",
    "line1",
    "street_address",
  ];
  const possibleCityFields = ["city", "town", "municipality"];
  const possibleStateFields = ["state", "province", "region"];
  const possibleCountryFields = ["country", "nation"];

  // Extract street
  for (const field of possibleStreetFields) {
    if (address[field] && typeof address[field] === "string") {
      addressParts.push(address[field]);
      break;
    }
  }

  // Extract city
  for (const field of possibleCityFields) {
    if (address[field] && typeof address[field] === "string") {
      addressParts.push(address[field]);
      break;
    }
  }

  // Extract state
  for (const field of possibleStateFields) {
    if (address[field] && typeof address[field] === "string") {
      addressParts.push(address[field]);
      break;
    }
  }

  // Extract country
  for (const field of possibleCountryFields) {
    if (address[field] && typeof address[field] === "string") {
      addressParts.push(address[field]);
      break;
    }
  }

  return addressParts.join(", ");
};

/**
 * Gets the sales partner name
 * @param {Object} sale - Sale object
 * @returns {string} Sales partner name
 */
const getSalesPartner = (sale) => {
  // Handle cases where these fields might be objects or arrays
  const extractName = (value) => {
    if (!value) return "";
    if (typeof value === "string") return value;
    if (typeof value === "object") {
      if (Array.isArray(value)) {
        value = value[0] || {};
      }
      // Try different name fields
      if (value.name) return value.name;
      if (value.full_name) return value.full_name;
      if (value.display_name) return value.display_name;
      if (value.title) return value.title;
      if (value.label) return value.label;
    }
    return "";
  };

  // Try different possible fields for sales partner
  if (sale.partner_name) {
    const name = extractName(sale.partner_name);
    if (name) return name;
  }

  if (sale.organizations) {
    const name = extractName(sale.organizations);
    if (name) return name;
  }

  if (sale.organization) {
    const name = extractName(sale.organization);
    if (name) return name;
  }

  if (sale.organization_name) {
    const name = extractName(sale.organization_name);
    if (name) return name;
  }

  if (sale.creator) {
    const name = extractName(sale.creator);
    if (name) return name;
  }

  if (sale.profiles) {
    const name = extractName(sale.profiles);
    if (name) return name;
  }

  return "";
};

/**
 * Formats phone number to ensure it's a proper string
 * @param {any} phone - Phone number (could be string, number, or scientific notation)
 * @returns {string} Properly formatted phone number string
 */
const formatPhoneNumber = (phone) => {
  if (!phone) return "";

  // Convert to string first
  let phoneStr = String(phone);

  // Handle scientific notation (e.g., "2.34908+12", "2.34908e+12", or direct scientific notation)
  // Check for patterns that indicate scientific notation
  const isScientificNotation =
    phoneStr.includes("e") ||
    phoneStr.includes("E") ||
    /^\d+\.\d+\+\d+$/.test(phoneStr) || // Pattern like "2.34908+12"
    /^\d+\.\d+-\d+$/.test(phoneStr); // Pattern like "2.34908-12"

  if (isScientificNotation) {
    try {
      // Try to parse as scientific notation
      let phoneNumber;

      // Handle the "2.34908+12" format (missing 'e')
      if (/^\d+\.\d+[+-]\d+$/.test(phoneStr)) {
        phoneStr = phoneStr.replace("+", "e+").replace(/-(\d+)$/, "e-$1");
      }

      phoneNumber = parseFloat(phoneStr);
      if (!isNaN(phoneNumber) && phoneNumber > 0) {
        // Convert to fixed decimal notation (no scientific notation)
        phoneStr = phoneNumber.toFixed(0);
      }
    } catch (error) {
      console.warn("Error parsing phone number:", phone, error);
      // Fallback: just remove non-phone characters
      phoneStr = String(phone).replace(/[^0-9+\-() ]/g, "");
    }
  }

  // Clean up the string - keep only valid phone characters
  // Allow digits, plus sign, hyphens, parentheses, and spaces
  phoneStr = phoneStr.replace(/[^0-9+\-() ]/g, "");

  return phoneStr.trim();
};

/**
 * Formats a date for CSV output (LocalDate format)
 * @param {string|Date} dateString - Date to format
 * @returns {string} Formatted date string (YYYY-MM-DD)
 */
const formatDateForCSV = (dateString) => {
  if (!dateString) return "";

  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return "";

    return date.toISOString().split("T")[0]; // Returns YYYY-MM-DD format
  } catch (error) {
    console.warn("Error formatting date:", dateString, error);
    return "";
  }
};

/**
 * Formats a datetime for CSV output (LocalDateTime format)
 * @param {string|Date} dateTime - DateTime to format
 * @returns {string} Formatted datetime string (YYYY-MM-DD HH:mm:ss)
 */
const formatDateTimeForCSV = (dateTime) => {
  if (!dateTime) return "";

  try {
    const date = new Date(dateTime);
    if (isNaN(date.getTime())) return "";

    // Format as YYYY-MM-DD HH:mm:ss
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const seconds = String(date.getSeconds()).padStart(2, "0");

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  } catch (error) {
    console.warn("Error formatting datetime:", dateTime, error);
    return "";
  }
};

/**
 * Cleans a value for CSV output, handling quotes and commas
 * @param {any} value - Value to clean
 * @returns {string} Cleaned value safe for CSV
 */
const cleanCSVValue = (value) => {
  if (value === null || value === undefined) {
    return "";
  }

  // Handle objects and arrays properly
  if (typeof value === "object") {
    if (Array.isArray(value)) {
      // For arrays, join with semicolon or return empty if no valid string items
      const stringItems = value
        .map((item) => {
          if (typeof item === "string") return item;
          if (typeof item === "number") return item.toString();
          if (typeof item === "object" && item !== null) {
            // Try to extract meaningful string from object
            if (item.name) return item.name;
            if (item.title) return item.title;
            if (item.value) return item.value;
            if (item.label) return item.label;
            return "";
          }
          return String(item);
        })
        .filter((item) => item.length > 0);

      return stringItems.join("; ");
    } else {
      // For objects, try to extract meaningful string value
      if (value.name) return cleanCSVValue(value.name);
      if (value.title) return cleanCSVValue(value.title);
      if (value.full_name) return cleanCSVValue(value.full_name);
      if (value.email) return cleanCSVValue(value.email);
      if (value.phone) return cleanCSVValue(value.phone);
      if (value.value) return cleanCSVValue(value.value);
      if (value.label) return cleanCSVValue(value.label);
      if (value.full_address) return cleanCSVValue(value.full_address);

      // If no meaningful field found, return empty string instead of [object Object]
      return "";
    }
  }

  // Convert to string
  let stringValue = String(value);

  // Handle potential [Object Object] issues (fallback)
  if (stringValue === "[object Object]") {
    return "";
  }

  // Escape quotes and wrap in quotes if contains comma, quote, or newline
  if (
    stringValue.includes(",") ||
    stringValue.includes('"') ||
    stringValue.includes("\n") ||
    stringValue.includes("\r")
  ) {
    stringValue = stringValue.replace(/"/g, '""'); // Escape quotes
    return `"${stringValue}"`; // Wrap in quotes
  }

  return stringValue;
};

/**
 * Downloads CSV content as a file
 * @param {string} csvContent - CSV content to download
 * @param {string} filename - Filename for the download
 */
export const downloadCSV = (csvContent, filename = null) => {
  if (typeof window === "undefined") return;

  const blob = new window.Blob([csvContent], {
    type: "text/csv;charset=utf-8;",
  });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");

  const downloadFilename =
    filename || `sales-export-${new Date().toISOString().split("T")[0]}.csv`;

  link.href = url;
  link.download = downloadFilename;
  link.style.visibility = "hidden";

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  window.URL.revokeObjectURL(url);
};

/**
 * Exports sales data to CSV with the specified format
 * @param {Array} salesData - Array of SuperAdminSale objects
 * @param {string} filename - Optional filename
 */
export const exportSalesDataToCSV = (salesData, filename = null) => {
  const csvContent = formatSalesDataToCSV(salesData);
  downloadCSV(csvContent, filename);
};

/**
 * Generic table export — converts headers + rows to CSV and triggers download.
 * @param {string[]} headers - Column header labels
 * @param {(string|number|null|undefined)[][]} rows - 2D array of row values
 * @param {string} filename - Download filename (should end with .csv)
 */
export const downloadTableAsCSV = (headers, rows, filename) => {
  const headerRow = headers.map(cleanCSVValue).join(",");
  const dataRows = rows.map((row) => row.map(cleanCSVValue).join(","));
  const csvContent = [headerRow, ...dataRows].join("\n");
  downloadCSV(csvContent, filename);
};
