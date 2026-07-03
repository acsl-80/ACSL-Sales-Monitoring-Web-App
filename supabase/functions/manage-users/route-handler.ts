// Route handler for user operations

import { getUser, getUsers } from "./read-operations.ts";
import { createUser, updateUser } from "./write-operations.ts";
import { deleteUser } from "./delete-operations.ts";
import { CallerContext, resolveCallerScope } from "./scope.ts";

export async function handleUserRoute(
  req: Request,
  supabase: any,
  caller: CallerContext
) {
  // Parse URL to get user ID if present
  const url = new URL(req.url);
  const pathParts = url.pathname.split("/").filter(Boolean);
  const userId = pathParts[pathParts.length - 1];

  // Resolve the caller's row-level scope once; every operation enforces it.
  const scope = await resolveCallerScope(supabase, caller);

  // Route to appropriate CRUD operation
  const method = req.method.toUpperCase();

  // ACSL agents are read-only callers (Agent Management → Partner Agents list).
  if (scope.type === "acsl_agent" && method !== "GET") {
    throw new Error("Unauthorized: Access denied for this role.");
  }

  switch (method) {
    case "GET":
      if (userId && userId !== "manage-users") {
        // Get single user
        return await getUser(supabase, userId, caller, scope);
      } else {
        // Get all users with pagination
        return await getUsers(supabase, url.searchParams, caller, scope);
      }

    case "POST":
      // Create new user
      const createData = await req.json();
      return await createUser(supabase, createData, caller, scope);

    case "PUT":
    case "PATCH":
      // Update user
      if (!userId || userId === "manage-users") {
        throw new Error("User ID is required for update operations");
      }
      const updateData = await req.json();
      return await updateUser(supabase, userId, updateData, caller, scope);

    case "DELETE":
      // Delete user
      if (!userId || userId === "manage-users") {
        throw new Error("User ID is required for delete operation");
      }
      return await deleteUser(supabase, userId, caller, scope);

    default:
      throw new Error(`Method ${method} not allowed`);
  }
}
