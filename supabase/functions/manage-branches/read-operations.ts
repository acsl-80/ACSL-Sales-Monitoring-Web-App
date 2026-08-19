// Read operations for branch management

import { validateUUID } from "./validate.ts";

export async function getBranches(supabase: any, searchParams: URLSearchParams) {
  console.log("📖 Getting all branches");

  try {
    const page = parseInt(searchParams.get("page") || "1");
    const limit = Math.min(parseInt(searchParams.get("limit") || "10"), 100);
    const search = searchParams.get("search")?.trim();
    const country = searchParams.get("country")?.trim();
    const state = searchParams.get("state")?.trim();
    const organizationId = searchParams.get("organization_id")?.trim();

    console.log("📊 Query parameters:", { page, limit, search, country, state, organizationId });

    // Build query
    let query = supabase
      .from("organization_branches")
      .select(`
        id,
        organization_id,
        name,
        country,
        state,
        lga,
        created_at,
        updated_at,
        created_by
      `);

    // Apply filters
    if (search) {
      query = query.or(`name.ilike.%${search}%,state.ilike.%${search}%,lga.ilike.%${search}%`);
    }

    if (country) {
      query = query.eq("country", country);
    }

    if (state) {
      query = query.eq("state", state);
    }

    if (organizationId) {
      validateUUID(organizationId, "organization_id");
      query = query.eq("organization_id", organizationId);
    }

    // Get total count for pagination
    const { count } = await query.select("*", { count: "exact", head: true });

    // Apply pagination and ordering
    const from = (page - 1) * limit;
    query = query
      .order("created_at", { ascending: false })
      .range(from, from + limit - 1);

    const { data: branches, error } = await query;

    if (error) {
      console.error("❌ Error fetching branches:", error);
      throw new Error(`Failed to fetch branches: ${error.message}`);
    }

    // Fetch related data for each branch
    const branchesWithDetails = await Promise.all(
      (branches || []).map(async (branch) => {
        // Get organization details
        const { data: organization } = await supabase
          .from("organizations")
          .select("id, name, partner_email")
          .eq("id", branch.organization_id)
          .single();

        // Get creator profile
        const { data: profile } = await supabase
          .from("profiles")
          .select("id, full_name, email")
          .eq("id", branch.created_by)
          .single();

        return {
          ...branch,
          organizations: organization,
          profiles: profile,
        };
      })
    );

    const totalPages = Math.ceil((count || 0) / limit);

    console.log(`✅ Successfully fetched ${branches?.length || 0} branches`);

    return {
      message: "Branches fetched successfully",
      data: {
        branches: branchesWithDetails,
        pagination: {
          page,
          limit,
          total: count || 0,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1,
        },
      },
    };
  } catch (error) {
    console.error("❌ Error in getBranches:", error);
    throw error;
  }
}

export async function getBranchesByOrganization(
  supabase: any,
  organizationId: string,
  userId: string,
  userRole: string,
  searchParams: URLSearchParams
) {
  console.log(`📖 Getting branches for organization: ${organizationId}`);

  try {
    validateUUID(organizationId, "organization_id");

    // Check authorization
    if (userRole === "admin") {
      // Organization admin can only view their own organization's branches
      const { data: userProfile } = await supabase
        .from("profiles")
        .select("organization_id")
        .eq("id", userId)
        .single();

      if (!userProfile || userProfile.organization_id !== organizationId) {
        throw new Error("Unauthorized: You can only access branches from your organization");
      }
    }

    const page = parseInt(searchParams.get("page") || "1");
    const limit = Math.min(parseInt(searchParams.get("limit") || "10"), 100);
    const search = searchParams.get("search")?.trim();
    const country = searchParams.get("country")?.trim();
    const state = searchParams.get("state")?.trim();

    console.log("📊 Query parameters:", { page, limit, search, country, state });

    // Build query
    let query = supabase
      .from("organization_branches")
      .select(`
        id,
        organization_id,
        name,
        country,
        state,
        lga,
        created_at,
        updated_at,
        created_by
      `)
      .eq("organization_id", organizationId);

    // Apply filters
    if (search) {
      query = query.or(`name.ilike.%${search}%,state.ilike.%${search}%,lga.ilike.%${search}%`);
    }

    if (country) {
      query = query.eq("country", country);
    }

    if (state) {
      query = query.eq("state", state);
    }

    // Get total count for pagination
    const { count } = await query.select("*", { count: "exact", head: true });

    // Apply pagination and ordering
    const from = (page - 1) * limit;
    query = query
      .order("created_at", { ascending: false })
      .range(from, from + limit - 1);

    const { data: branches, error } = await query;

    if (error) {
      console.error("❌ Error fetching organization branches:", error);
      throw new Error(`Failed to fetch organization branches: ${error.message}`);
    }

    // Get organization details
    const { data: organization } = await supabase
      .from("organizations")
      .select("id, name, partner_email")
      .eq("id", organizationId)
      .single();

    // Fetch related data for each branch
    const branchesWithDetails = await Promise.all(
      (branches || []).map(async (branch) => {
        // Get creator profile
        const { data: profile } = await supabase
          .from("profiles")
          .select("id, full_name, email")
          .eq("id", branch.created_by)
          .single();

        return {
          ...branch,
          profiles: profile,
        };
      })
    );

    const totalPages = Math.ceil((count || 0) / limit);

    console.log(`✅ Successfully fetched ${branches?.length || 0} branches for organization`);

    return {
      message: "Organization branches fetched successfully",
      data: {
        organization,
        branches: branchesWithDetails,
        pagination: {
          page,
          limit,
          total: count || 0,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1,
        },
      },
    };
  } catch (error) {
    console.error("❌ Error in getBranchesByOrganization:", error);
    throw error;
  }
}

export async function getBranch(
  supabase: any,
  branchId: string,
  userId: string,
  userRole: string
) {
  console.log(`📖 Getting branch: ${branchId}`);

  try {
    validateUUID(branchId, "branch_id");

    const { data: branch, error } = await supabase
      .from("organization_branches")
      .select(`
        id,
        organization_id,
        name,
        country,
        state,
        lga,
        created_at,
        updated_at,
        created_by
      `)
      .eq("id", branchId)
      .single();

    if (error) {
      console.error("❌ Error fetching branch:", error);
      if (error.code === "PGRST116") {
        throw new Error("Branch not found");
      }
      throw new Error(`Failed to fetch branch: ${error.message}`);
    }

    // Check authorization for organization admin
    if (userRole === "admin") {
      const { data: userProfile } = await supabase
        .from("profiles")
        .select("organization_id")
        .eq("id", userId)
        .single();

      if (!userProfile || userProfile.organization_id !== branch.organization_id) {
        throw new Error("Unauthorized: You can only access branches from your organization");
      }
    }

    // Get organization details
    const { data: organization } = await supabase
      .from("organizations")
      .select("id, name, partner_email")
      .eq("id", branch.organization_id)
      .single();

    // Get creator profile
    const { data: profile } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .eq("id", branch.created_by)
      .single();

    // Combine the results
    const branchWithDetails = {
      ...branch,
      organizations: organization,
      profiles: profile,
    };

    console.log("✅ Successfully fetched branch");

    return {
      message: "Branch fetched successfully",
      data: { branch: branchWithDetails },
    };
  } catch (error) {
    console.error("❌ Error in getBranch:", error);
    throw error;
  }
}
