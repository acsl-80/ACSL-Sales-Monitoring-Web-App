// Export utilities module
export function convertToCSV(data) {
  if (!data || data.length === 0) return "";
  const headers = Object.keys(data[0]);
  const csvContent = [
    headers.join(","),
    ...data.map((row)=>headers.map((header)=>{
        const value = row[header];
        if (value === null || value === undefined) return "";
        if (typeof value === "string" && value.includes(",")) {
          return `"${value.replace(/"/g, '""')}"`;
        }
        return String(value);
      }).join(","))
  ].join("\n");
  return csvContent;
}
export function prepareExportData(sales, filters) {
  console.log(`📤 Preparing ${sales.length} records for export`);
  if (filters.exportFields && filters.exportFields.length > 0) {
    console.log(`📤 Export fields requested: ${filters.exportFields.join(", ")}`);
    return sales.map((sale)=>{
      const filtered = {};
      filters.exportFields.forEach((field)=>{
        if (sale[field] !== undefined) {
          filtered[field] = sale[field];
        }
      });
      return filtered;
    });
  }
  console.log("📤 Using all fields for export");
  return sales;
}
