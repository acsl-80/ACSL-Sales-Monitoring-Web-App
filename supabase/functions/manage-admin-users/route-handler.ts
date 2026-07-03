// Route handler for admin user operations

import { getAdminUser, getAdminUsers } from "./read-operations.ts";
import { createAdminUser, updateAdminUser } from "./write-operations.ts";
import { deleteAdminUser } from "./delete-operations.ts";

export async function handleAdminUserRoute(
  req: Request,
  supabase: any,
  userId: string,
  userRole: string
) {
  // Parse URL to get admin user ID if present
  const url = new URL(req.url);
  const pathParts = url.pathname.split("/").filter(Boolean);
  const adminUserId = pathParts[pathParts.length - 1];

  // Route to appropriate CRUD operation
  const method = req.method.toUpperCase();

  switch (method) {
    case "GET":
      if (adminUserId && adminUserId !== "manage-admin-users") {
        // Get single admin user
        return await getAdminUser(supabase, adminUserId);
      } else {
        // Get all admin users with pagination and filters
        return await getAdminUsers(supabase, url.searchParams);
      }

    case "POST":
      // Create new admin user
      const createData = await req.json();
      return await createAdminUser(supabase, createData, userId);

    case "PUT":
    case "PATCH":
      // Update admin user
      if (!adminUserId || adminUserId === "manage-admin-users") {
        throw new Error("Admin User ID is required for update operations");
      }
      const updateData = await req.json();
      return await updateAdminUser(supabase, adminUserId, updateData, userId);

    case "DELETE":
      // Delete admin user
      if (!adminUserId || adminUserId === "manage-admin-users") {
        throw new Error("Admin User ID is required for delete operation");
      }
      return await deleteAdminUser(supabase, adminUserId);

    default:
      throw new Error(`Method ${method} not allowed`);
  }
}
