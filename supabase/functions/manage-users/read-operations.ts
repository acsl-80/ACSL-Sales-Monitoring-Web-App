// Read operations for users

import {
  applyScopeToListQuery,
  userInScope,
  CallerContext,
  CallerScope,
} from "./scope.ts";

export async function getUsers(
  supabase: any,
  searchParams: URLSearchParams,
  caller: CallerContext,
  scope: CallerScope
) {
  console.log("📋 Fetching users list...");

  try {
    // Parse pagination parameters
    const page = parseInt(searchParams.get("page") || "1");
    const limit = Math.min(parseInt(searchParams.get("limit") || "25"), 100);
    const offset = (page - 1) * limit;

    // Parse search and filter parameters
    const search = searchParams.get("search") || "";
    const role = searchParams.get("role") || "";
    const status = searchParams.get("status") || "";
    const sortBy = searchParams.get("sortBy") || "created_at";
    const sortOrder = searchParams.get("sortOrder") || "desc";

    console.log("📊 Query parameters:", {
      page,
      limit,
      search,
      role,
      status,
      sortBy,
      sortOrder,
    });

    // Build base query. Partner organization profiles are managed in Partner
    // views, not User Management, so keep partner/admin rows out here.
    let query = supabase
      .from("profiles")
      .select("id, full_name, email, phone, role, status, created_at, last_login, organization_id, manager_id", {
        count: "exact",
      });

    const ALL_ROLES = [
      "super_admin",
      "acsl_agent_manager",
      "acsl_agent",
      "partner_agent",
      "agent",
      "super_admin_agent",
    ];
    if (role && ALL_ROLES.includes(role)) {
      query = query.eq("role", role);
      console.log("🔍 Showing users with role:", role);
    } else {
      query = query.in("role", ALL_ROLES);
      console.log("🔍 Showing all manageable users");
    }

    query = query.not("role", "eq", "partner").not("role", "eq", "admin");

    // Row-level scope: managers see their ACSL agents + assigned partners' users;
    // partners see only their own organization's agents. Same shape, different filter.
    query = applyScopeToListQuery(query, scope, caller.id);

    // Apply status filter
    if (status && ["active", "disabled"].includes(status)) {
      query = query.eq("status", status);
      console.log("🔍 Status filter applied:", status);
    }

    // Apply search filter
    if (search.trim()) {
      query = query.or(`full_name.ilike.%${search}%,email.ilike.%${search}%`);
      console.log("🔍 Search filter applied:", search);
    }

    // Apply sorting
    const ascending = sortOrder.toLowerCase() === "asc";
    query = query.order(sortBy, { ascending });

    // Apply pagination
    query = query.range(offset, offset + limit - 1);

    // Execute query
    const { data: users, error: usersError, count } = await query;

    if (usersError) {
      console.error("❌ Error fetching users:", usersError);
      throw new Error(`Database error: ${usersError.message}`);
    }

    // Batch-fetch organizations for partner_agent/agent rows
    const orgIds = Array.from(
      new Set(
        (users || [])
          .filter((u: any) =>
            ["partner_agent", "agent"].includes(u.role) && u.organization_id
          )
          .map((u: any) => u.organization_id)
      )
    );
    let orgMap = new Map<string, any>();
    if (orgIds.length > 0) {
      const { data: orgs } = await supabase
        .from("organizations")
        .select("id, partner_name, state, branch")
        .in("id", orgIds);
      (orgs || []).forEach((o: any) => orgMap.set(o.id, o));
    }

    // Batch-fetch supervisor names for ACSL agent rows, so the frontend never
    // has to infer supervisors from other rows in the (possibly scoped) list.
    const managerIds = Array.from(
      new Set((users || []).map((u: any) => u.manager_id).filter(Boolean))
    );
    const managerMap = new Map<string, string>();
    if (managerIds.length > 0) {
      const { data: managers } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", managerIds);
      (managers || []).forEach((m: any) => managerMap.set(m.id, m.full_name));
    }

    // Fetch assigned_organizations_count + assigned_states_count for each SAA user
    const usersWithCounts = await Promise.all(
      (users || []).map(async (u: any) => {
        const user = {
          ...u,
          manager_name: u.manager_id ? managerMap.get(u.manager_id) ?? null : null,
        };
        if (user.role === "acsl_agent" || user.role === "super_admin_agent") {
          const [{ count: orgCount }, { count: stateCount }] = await Promise.all([
            supabase
              .from("acsl_agent_organizations")
              .select("*", { count: "exact", head: true })
              .eq("agent_id", user.id),
            supabase
              .from("acsl_agent_states")
              .select("*", { count: "exact", head: true })
              .eq("agent_id", user.id),
          ]);
          return {
            ...user,
            assigned_organizations_count: orgCount || 0,
            assigned_states_count: stateCount || 0,
          };
        }
        if (["partner_agent", "agent"].includes(user.role)) {
          const org = user.organization_id ? orgMap.get(user.organization_id) : null;
          return {
            ...user,
            organization: org || null,
            assigned_organizations_count: org ? 1 : 0,
            assigned_states_count: org && org.state ? 1 : 0,
          };
        }
        return { ...user, assigned_organizations_count: 0, assigned_states_count: 0 };
      })
    );

    // Calculate pagination metadata
    const totalPages = Math.ceil((count || 0) / limit);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;

    console.log(`✅ Found ${users?.length || 0} users (${count} total)`);

    return {
      message: `Found ${count || 0} users`,
      data: usersWithCounts,
      pagination: {
        currentPage: page,
        totalPages,
        totalItems: count || 0,
        itemsPerPage: limit,
        hasNextPage,
        hasPrevPage,
      },
      filters: {
        search,
        role,
        status,
        sortBy,
        sortOrder,
      },
    };
  } catch (error) {
    console.error("❌ Error in getUsers:", error);
    throw error;
  }
}

export async function getUser(
  supabase: any,
  userId: string,
  caller: CallerContext,
  scope: CallerScope
) {
  console.log("🔍 Fetching single user:", userId);

  try {
    // Query for single user by ID (any role)
    const { data: user, error: userError } = await supabase
      .from("profiles")
      .select("id, full_name, email, phone, role, status, created_at, last_login, organization_id, manager_id")
      .eq("id", userId)
      .single();

    if (userError) {
      if (userError.code === "PGRST116") {
        throw new Error("User not found");
      }
      console.error("❌ Error fetching user:", userError);
      throw new Error(`Database error: ${userError.message}`);
    }

    if (!userInScope(scope, user, caller.id)) {
      throw new Error("User not found");
    }

    console.log("✅ User found:", user.id);

    return {
      message: "User retrieved successfully",
      data: user,
    };
  } catch (error) {
    console.error("❌ Error in getUser:", error);
    throw error;
  }
}
