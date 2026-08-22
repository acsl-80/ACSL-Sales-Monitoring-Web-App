// Filter parsing module
export async function parseFilters(req) {
  console.log("📋 Parsing request filters...");
  const filters = req.method === "POST" ? await req.json() : Object.fromEntries(new URL(req.url).searchParams.entries());
  console.log("✅ Raw filters parsed:", Object.keys(filters).length, "keys");
  console.log("📊 Filter summary:", {
    includes: [
      filters.includeOrganization && "org",
      filters.includeAddress && "addr",
      filters.includeCreator && "creator",
      filters.includeImages && "images"
    ].filter(Boolean).join(", ") || "none",
    limit: filters.limit || "default",
    search: filters.search ? "yes" : "no",
    export: filters.export || "no"
  });
  return filters;
}
