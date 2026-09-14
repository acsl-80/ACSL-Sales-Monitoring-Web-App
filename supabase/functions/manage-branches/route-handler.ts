// Route handler for branch operations

import { getBranch, getBranches, getBranchesByOrganization } from "./read-operations.ts";
import { createBranch, updateBranch } from "./write-operations.ts";
import { deleteBranch } from "./delete-operations.ts";

export async function handleBranchRoute(
  req: Request,
  supabase: any,
  userId: string,
  userRole: string
) {
  // Parse URL to get path parameters
  const url = new URL(req.url);
  const pathParts = url.pathname.split("/").filter(Boolean);
  
  // Find the manage-branches index and get parts after it
  const manageBranchesIndex = pathParts.findIndex(part => part === "manage-branches");
  const relevantParts = pathParts.slice(manageBranchesIndex + 1);
  
  // Check if this is an organization-specific route
  // Expected patterns:
  // /functions/v1/manage-branches (list all branches)
  // /functions/v1/manage-branches/organization/{org_id} (list branches for org)
  // /functions/v1/manage-branches/{branch_id} (single branch operations)
  
  const method = req.method.toUpperCase();
  console.log(`🛣️ Branch route: ${method} ${url.pathname}`);
  console.log(`📍 Full path parts: ${pathParts.join("/")}`);
  console.log(`📍 Relevant parts after manage-branches: ${relevantParts.join("/")}`);

  // Route based on URL pattern
  if (relevantParts.length === 0) {
    // /manage-branches - list all branches (super admin only)
    return await handleAllBranches(method, req, supabase, userId, userRole, url.searchParams);
  } else if (relevantParts.length === 2 && relevantParts[0] === "organization") {
    // /manage-branches/organization/{org_id} - organization-specific operations
    const organizationId = relevantParts[1];
    return await handleOrganizationBranches(method, req, supabase, userId, userRole, organizationId, url.searchParams);
  } else if (relevantParts.length === 1) {
    // Check if this is a UUID (branch_id) or something else
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (uuidRegex.test(relevantParts[0])) {
      // /manage-branches/{branch_id} - single branch operations
      const branchId = relevantParts[0];
      return await handleSingleBranch(method, req, supabase, userId, userRole, branchId);
    } else {
      throw new Error(`Invalid route: ${relevantParts[0]} is not a valid branch ID`);
    }
  } else {
    throw new Error(`Invalid route pattern: ${relevantParts.join("/")}`);
  }
}

async function handleAllBranches(
  method: string,
  req: Request,
  supabase: any,
  userId: string,
  userRole: string,
  searchParams: URLSearchParams
) {
  switch (method) {
    case "GET":
      // Only super admin can view all branches across organizations
      if (userRole !== "super_admin") {
        throw new Error("Unauthorized: Super admin privileges required");
      }
      return await getBranches(supabase, searchParams);
    
    default:
      throw new Error(`Method ${method} not allowed for this endpoint`);
  }
}

async function handleOrganizationBranches(
  method: string,
  req: Request,
  supabase: any,
  userId: string,
  userRole: string,
  organizationId: string,
  searchParams: URLSearchParams
) {
  switch (method) {
    case "GET":
      // Get branches for specific organization
      return await getBranchesByOrganization(supabase, organizationId, userId, userRole, searchParams);
    
    case "POST":
      // Create new branch for organization
      const createData = await req.json();
      return await createBranch(supabase, { ...createData, organization_id: organizationId }, userId, userRole);
    
    default:
      throw new Error(`Method ${method} not allowed for this endpoint`);
  }
}

async function handleSingleBranch(
  method: string,
  req: Request,
  supabase: any,
  userId: string,
  userRole: string,
  branchId: string
) {
  switch (method) {
    case "GET":
      // Get single branch
      return await getBranch(supabase, branchId, userId, userRole);

    case "PUT":
    case "PATCH":
      // Update branch
      const updateData = await req.json();
      return await updateBranch(supabase, branchId, updateData, userId, userRole);

    case "DELETE":
      // Delete branch
      return await deleteBranch(supabase, branchId, userId, userRole);

    default:
      throw new Error(`Method ${method} not allowed`);
  }
}
