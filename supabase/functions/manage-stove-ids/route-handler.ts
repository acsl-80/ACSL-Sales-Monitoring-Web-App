import { getStoveIds, getStoveIdById, getGroupedBySalesReference } from "./read-operations.ts";
import { archiveStoveId } from "./write-operations.ts";

export async function handleStoveIdRoute(
  req: Request,
  supabase: any,
  userId: string,
  userRole: string,
  organizationId: string | null,
  allowedOrgIds: string[] | null = null
) {
  const url = new URL(req.url);
  const method = req.method.toUpperCase();

  switch (method) {
    case "GET": {
      // Check if requesting a single stove ID by ID
      const stoveIdParam = url.searchParams.get("id");
      const grouped = url.searchParams.get("grouped") === "true";

      if (stoveIdParam) {
        // Get single stove ID by ID
        return await getStoveIdById(
          supabase,
          userRole,
          organizationId,
          stoveIdParam,
          allowedOrgIds
        );
      }

      if (grouped) {
        // Get stove IDs grouped by sales_reference
        return await getGroupedBySalesReference(
          supabase,
          userRole,
          organizationId,
          url.searchParams,
          allowedOrgIds
        );
      }

      // Get stove IDs with pagination and filters
      return await getStoveIds(
        supabase,
        userRole,
        organizationId,
        url.searchParams,
        allowedOrgIds
      );
    }

    case "POST": {
      const body = await req.json();
      const { action } = body;

      if (action === "archive") {
        return await archiveStoveId(
          supabase,
          userRole,
          organizationId,
          body
        );
      }

      throw new Error(`Action ${action} not supported`);
    }

    default:
      throw new Error(`Method ${method} not allowed`);
  }
}
