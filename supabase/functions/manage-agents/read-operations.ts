// Read operations for agents

export async function getAgents(
  supabase: any,
  searchParams: URLSearchParams,
  userRole: string,
  organizationId: string | null
) {
  console.log("📋 Fetching agents list...");

  try {
    // Parse pagination parameters
    const page = parseInt(searchParams.get("page") || "1");
    const limit = Math.min(parseInt(searchParams.get("limit") || "10"), 100);
    const offset = (page - 1) * limit;

    // Parse search parameters
    const search = searchParams.get("search") || "";
    const sortBy = searchParams.get("sortBy") || "created_at";
    const sortOrder = searchParams.get("sortOrder") || "desc";
    const filterOrgId = searchParams.get("organization_id") || "";

    console.log("📊 Query parameters:", {
      page,
      limit,
      search,
      sortBy,
      sortOrder,
    });

    // Build base query — join org name for super_admin cross-org view
    const selectFields =
      userRole === "super_admin"
        ? "id, full_name, email, phone, role, organization_id, created_at, organizations(partner_name)"
        : "id, full_name, email, phone, role, organization_id, created_at";

    let query = supabase
      .from("profiles")
      .select(selectFields, { count: "exact" })
      .in("role", ["partner_agent", "agent"]);

    const isPartnerRole = ["partner", "admin", "partner_agent", "agent"].includes(userRole);

    // Apply organization filter based on user role
    if (isPartnerRole && organizationId) {
      // Partner/Admin and Agent can only see agents from their organization
      query = query.eq("organization_id", organizationId);
      console.log(
        "🔍 Admin/Agent access: filtering by organization",
        organizationId
      );
    } else if (userRole === "super_admin") {
      // Super admin can see all agents; optionally filter to a specific org
      if (filterOrgId) {
        query = query.eq("organization_id", filterOrgId);
        console.log("🔍 Super admin: filtering by organization", filterOrgId);
      } else {
        console.log("🔍 Super admin access: showing all agents");
      }
    } else if (isPartnerRole && !organizationId) {
      // Admin or Agent has no organization assigned
      console.log("❌ User has no organization assigned");
      throw new Error("User has no organization assigned");
    } else {
      throw new Error("Insufficient permissions to view agents");
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
    const { data: agents, error: agentsError, count } = await query;

    if (agentsError) {
      console.error("❌ Error fetching agents:", agentsError);
      throw new Error(`Database error: ${agentsError.message}`);
    }

    // Fetch total_sold counts for all agents in one query
    let salesCountMap: Record<string, number> = {};
    if (agents && agents.length > 0) {
      const agentIds = agents.map((a: any) => a.id);
      const { data: salesData, error: salesError } = await supabase
        .from("sales")
        .select("created_by")
        .in("created_by", agentIds);

      if (!salesError && salesData) {
        salesCountMap = salesData.reduce((acc: Record<string, number>, sale: any) => {
          acc[sale.created_by] = (acc[sale.created_by] || 0) + 1;
          return acc;
        }, {});
      }
    }

    // Fetch last_login for all agents via auth admin
    let lastLoginMap: Record<string, string | null> = {};
    try {
      const { data: authUsers, error: authError } = await supabase.auth.admin.listUsers({
        perPage: 1000,
      });
      if (!authError && authUsers?.users) {
        authUsers.users.forEach((u: any) => {
          lastLoginMap[u.id] = u.last_sign_in_at || null;
        });
      }
    } catch (authErr) {
      console.warn("⚠️ Could not fetch last login data:", authErr);
    }

    // Merge total_sold, last_login, and org name into agent records
    const enrichedAgents = (agents || []).map((agent: any) => ({
      ...agent,
      organization_name: agent.organizations?.partner_name ?? null,
      organizations: undefined,
      total_sold: salesCountMap[agent.id] || 0,
      last_login: lastLoginMap[agent.id] || null,
    }));

    // Calculate pagination metadata
    const totalPages = Math.ceil((count || 0) / limit);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;

    console.log(`✅ Found ${agents?.length || 0} agents (${count} total)`);

    return {
      message: `Found ${count || 0} agents`,
      data: enrichedAgents,
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
        sortBy,
        sortOrder,
      },
    };
  } catch (error) {
    console.error("❌ Error in getAgents:", error);
    throw error;
  }
}

export async function getAgent(
  supabase: any,
  agentId: string,
  userRole: string,
  organizationId: string | null
) {
  console.log("🔍 Fetching single agent:", agentId);

  try {
    // Build query for single agent
    let query = supabase
      .from("profiles")
      .select("id, full_name, email, phone, role, organization_id, created_at")
      .eq("id", agentId)
      .in("role", ["partner_agent", "agent"]);

    const isPartnerRole = ["partner", "admin", "partner_agent", "agent"].includes(userRole);

    // Apply organization filter based on user role
    if (isPartnerRole && organizationId) {
      // Partner/Admin and Agent can only see agents from their organization
      query = query.eq("organization_id", organizationId);
      console.log(
        "🔍 Admin/Agent access: filtering by organization",
        organizationId
      );
    } else if (userRole === "super_admin") {
      // Super admin can see any agent
      console.log("🔍 Super admin access: no organization filter");
    } else if (isPartnerRole && !organizationId) {
      // Admin or Agent has no organization assigned
      console.log("❌ User has no organization assigned");
      throw new Error("User has no organization assigned");
    } else {
      throw new Error("Insufficient permissions to view agent");
    }

    const { data: agent, error: agentError } = await query.single();

    if (agentError) {
      if (agentError.code === "PGRST116") {
        throw new Error("Agent not found or access denied");
      }
      console.error("❌ Error fetching agent:", agentError);
      throw new Error(`Database error: ${agentError.message}`);
    }

    // Fetch total_sold for this agent
    let total_sold = 0;
    const { data: salesData } = await supabase
      .from("sales")
      .select("id", { count: "exact" })
      .eq("created_by", agentId);
    if (salesData) total_sold = salesData.length;

    // Fetch last_login from auth
    let last_login: string | null = null;
    try {
      const { data: authUser } = await supabase.auth.admin.getUserById(agentId);
      last_login = authUser?.user?.last_sign_in_at || null;
    } catch (_) {}

    console.log("✅ Agent found:", agent.id);

    return {
      message: "Agent retrieved successfully",
      data: { ...agent, total_sold, last_login },
    };
  } catch (error) {
    console.error("❌ Error in getAgent:", error);
    throw error;
  }
}
