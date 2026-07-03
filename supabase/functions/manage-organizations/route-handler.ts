// Route handler for organization operations

import { getOrganization, getOrganizations } from "./read-operations.ts";
import { createOrganization, updateOrganization, updatePartnerDetails } from "./write-operations.ts";
import {
  deleteOrganization,
  hardDeleteOrganization,
} from "./delete-operations.ts";
import { createOrganizationSimple } from "./test-operations.ts";
import { importCSVData, validateCSVData } from "./csv-import-operations.ts";

export async function handleOrganizationRoute(
  req: Request,
  supabase: any,
  userId: string,
  userRole: string,
  allowedOrgIds: string[] | null = null
) {
  // Parse URL to get organization ID if present
  const url = new URL(req.url);
  const pathParts = url.pathname.split("/").filter(Boolean);
  const organizationId = pathParts[pathParts.length - 1];

  // Check for hard delete query parameter
  const isHardDelete = url.searchParams.get("hard_delete") === "true";

  // Route to appropriate CRUD operation
  const method = req.method.toUpperCase();

  switch (method) {
    case "GET":
      if (organizationId && organizationId !== "manage-organizations") {
        // Get single organization (must be within the caller's scope)
        if (allowedOrgIds && !allowedOrgIds.includes(organizationId)) {
          throw new Error("Unauthorized: Organization not in your assigned scope");
        }
        return await getOrganization(supabase, organizationId);
      } else {
        // Get all organizations with pagination
        return await getOrganizations(supabase, url.searchParams, allowedOrgIds);
      }

    case "POST":
      // Check if this is a CSV import request
      if (url.searchParams.get("import_csv") === "true") {
        console.log("📊 Processing CSV import request");
        const csvData = await req.json();

        // Validate CSV data structure
        const validation = validateCSVData(csvData);
        if (!validation.isValid) {
          throw new Error(
            `CSV Validation failed: ${validation.errors.join(", ")}`
          );
        }

        // Process the CSV import
        return await importCSVData(supabase, csvData, userId);
      }

      // Check if this is a test request
      const createData = await req.json();
      if (url.searchParams.get("test") === "true") {
        // Use simple organization creation without user management
        console.log("🧪 Using test mode - simple organization creation");
        return await createOrganizationSimple(supabase, createData, userId);
      } else {
        // Create new organization with admin user
        return await createOrganization(supabase, createData, userId);
      }

    case "PUT":
    case "PATCH":
      // Update organization and/or admin user
      if (!organizationId || organizationId === "manage-organizations") {
        throw new Error("Organization ID is required for update operations");
      }
      const updateData = await req.json();

      // Restricted partner detail update (phone, email, username only)
      if (url.searchParams.get("action") === "update-details") {
        return await updatePartnerDetails(supabase, organizationId, updateData, userId);
      }

      return await updateOrganization(
        supabase,
        organizationId,
        updateData,
        userId
      );

    case "DELETE":
      // Delete organization (soft delete by default, hard delete with query param)
      if (!organizationId || organizationId === "manage-organizations") {
        throw new Error("Organization ID is required for delete operation");
      }

      if (isHardDelete) {
        console.warn("⚠️ Hard delete requested - this is irreversible!");
        return await hardDeleteOrganization(supabase, organizationId);
      } else {
        return await deleteOrganization(supabase, organizationId);
      }

    default:
      throw new Error(`Method ${method} not allowed`);
  }
}
