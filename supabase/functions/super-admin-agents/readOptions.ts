// Read operations for super-admin-agents (ACSL Agent management)

export async function listAgents(supabase: any, searchParams: URLSearchParams, managerFilter: string | null = null) {
  console.log("📋 Fetching ACSL agents list...");

  const page = parseInt(searchParams.get("page") || "1");
  const limit = Math.min(parseInt(searchParams.get("limit") || "25"), 100);
  const offset = (page - 1) * limit;
  const search = searchParams.get("search") || "";
  const status = searchParams.get("status") || "";
  const sortBy = searchParams.get("sortBy") || "created_at";
  const sortOrder = searchParams.get("sortOrder") || "desc";
  const organizationId = searchParams.get("organization_id") || "";

  const roleParam = searchParams.get("role") || "";
  const VALID_ROLES = ["acsl_agent", "acsl_agent_manager", "super_admin_agent", "super_admin"];
  const requestedRoles = roleParam
    ? roleParam.split(",").map(r => r.trim()).filter(r => VALID_ROLES.includes(r))
        .map(r => r === "super_admin_agent" ? "acsl_agent" : r)
    : [];

  // When filtering by organization_id, resolve which agent IDs are assigned to that org
  // (either directly via acsl_agent_organizations, or via state assignment)
  let filteredAgentIds: string[] | null = null;
  if (organizationId) {
    // 1. Direct assignments
    const { data: directRows } = await supabase
      .from("acsl_agent_organizations")
      .select("agent_id")
      .eq("organization_id", organizationId);
    const directIds = new Set((directRows || []).map((r: any) => r.agent_id as string));

    // 2. State-based: get the org's state, then find agents assigned to that state
    const { data: orgRow } = await supabase
      .from("organizations")
      .select("state")
      .eq("id", organizationId)
      .single();
    if (orgRow?.state) {
      const { data: stateRows } = await supabase
        .from("acsl_agent_states")
        .select("agent_id")
        .eq("state", orgRow.state);
      const stateAgentIds = (stateRows || []).map((r: any) => r.agent_id as string);
      if (stateAgentIds.length > 0) {
        // A state assignment only grants the whole state when the agent has no
        // specific partner assignments — those take precedence.
        const { data: withDirectRows } = await supabase
          .from("acsl_agent_organizations")
          .select("agent_id")
          .in("agent_id", stateAgentIds);
        const hasDirect = new Set<string>((withDirectRows || []).map((r: any) => r.agent_id as string));
        stateAgentIds.forEach((id: string) => { if (!hasDirect.has(id)) directIds.add(id); });
      }
    }

    filteredAgentIds = [...directIds];
    // If no agents are assigned, return empty immediately
    if (filteredAgentIds.length === 0) {
      return {
        message: "No ACSL agents assigned to this organization",
        data: [],
        pagination: { currentPage: 1, totalPages: 0, totalItems: 0, itemsPerPage: limit, hasNextPage: false, hasPrevPage: false },
      };
    }
  }

  let query = supabase
    .from("profiles")
    .select("id, full_name, email, phone, role, status, created_at, last_login, updated_at, updated_by", { count: "exact" });

  if (filteredAgentIds !== null) {
    query = query.in("id", filteredAgentIds);
  } else if (requestedRoles.length === 1) {
    query = query.eq("role", requestedRoles[0]);
  } else if (requestedRoles.length > 1) {
    query = query.in("role", requestedRoles);
  } else {
    query = query.in("role", ["acsl_agent", "acsl_agent_manager", "super_admin"]);
  }

  // acsl_agent_manager only sees agents they personally created
  if (managerFilter) {
    query = query.eq("manager_id", managerFilter);
  }

  if (status && ["active", "disabled"].includes(status)) {
    query = query.eq("status", status);
  }

  if (search.trim()) {
    query = query.or(`full_name.ilike.%${search}%,email.ilike.%${search}%`);
  }

  const ascending = sortOrder.toLowerCase() === "asc";
  query = query.order(sortBy, { ascending }).range(offset, offset + limit - 1);

  const { data: agents, error, count } = await query;
  if (error) throw new Error(`Database error: ${error.message}`);

  // ── Batch compute partner counts + stove stats for the whole page ──────────
  const agentIdList = (agents || []).map((a: any) => a.id as string);
  const dateFrom = searchParams.get("date_from") ?? null;
  const dateTo   = searchParams.get("date_to")   ?? null;

  // 1 & 2: direct org assignments + state assignments — 2 queries for the full page
  const [{ data: allDirectOrgRows }, { data: allStateRows }] = await Promise.all([
    supabase.from("acsl_agent_organizations").select("agent_id, organization_id").in("agent_id", agentIdList),
    supabase.from("acsl_agent_states").select("agent_id, state").in("agent_id", agentIdList),
  ]);

  // 3: resolve all unique states → org IDs in one query
  const allStates = [...new Set((allStateRows || []).map((r: any) => r.state as string))];
  const stateToOrgIds: Record<string, string[]> = {};
  if (allStates.length > 0) {
    const { data: stateOrgRows } = await supabase
      .from("organizations").select("id, state").in("state", allStates);
    (stateOrgRows || []).forEach((o: any) => {
      if (!stateToOrgIds[o.state]) stateToOrgIds[o.state] = [];
      stateToOrgIds[o.state].push(o.id);
    });
  }

  // Build per-agent maps
  const agentDirectIds: Record<string, Set<string>> = {};
  const agentAllOrgIds: Record<string, Set<string>> = {};
  const agentStates:    Record<string, string[]>     = {};

  (allDirectOrgRows || []).forEach((r: any) => {
    if (!agentDirectIds[r.agent_id])  agentDirectIds[r.agent_id]  = new Set();
    if (!agentAllOrgIds[r.agent_id])  agentAllOrgIds[r.agent_id]  = new Set();
    agentDirectIds[r.agent_id].add(r.organization_id);
    agentAllOrgIds[r.agent_id].add(r.organization_id);
  });
  (allStateRows || []).forEach((r: any) => {
    if (!agentStates[r.agent_id])    agentStates[r.agent_id]    = [];
    if (!agentAllOrgIds[r.agent_id]) agentAllOrgIds[r.agent_id] = new Set();
    agentStates[r.agent_id].push(r.state);
    // Direct partner assignments take precedence: a state only expands to all
    // of its orgs when the agent has no specific partners assigned.
    if (!agentDirectIds[r.agent_id]?.size) {
      (stateToOrgIds[r.state] || []).forEach((oid) => agentAllOrgIds[r.agent_id].add(oid));
    }
  });

  // 4: stove counts for all orgs across the page — 1 RPC call
  const allOrgIdsList = [...new Set(Object.values(agentAllOrgIds).flatMap((s) => [...s]))];
  const orgStoveStats: Record<string, { total: number; available: number }> = {};
  if (allOrgIdsList.length > 0) {
    const { data: stoveCounts } = await supabase.rpc("get_organization_stove_counts", { org_ids: allOrgIdsList });
    (stoveCounts || []).forEach((r: any) => {
      orgStoveStats[r.organization_id] = { total: r.total_count ?? 0, available: r.available_count ?? 0 };
    });
  }

  // 5: all sales by these agents in the date range — 1 query
  let agentSalesQ = supabase.from("sales").select("id, created_by").in("created_by", agentIdList);
  if (dateFrom) agentSalesQ = agentSalesQ.gte("sales_date", dateFrom);
  if (dateTo)   agentSalesQ = agentSalesQ.lte("sales_date", dateTo);
  const { data: agentSalesRows } = await agentSalesQ;

  const agentSaleIdMap: Record<string, string[]> = {};
  (agentSalesRows || []).forEach((s: any) => {
    if (!agentSaleIdMap[s.created_by]) agentSaleIdMap[s.created_by] = [];
    agentSaleIdMap[s.created_by].push(s.id);
  });

  // 6: count stove_ids sold per sale in batches — scales with sales volume, not page size
  const allSaleIds = Object.values(agentSaleIdMap).flat();
  const soldBySaleId: Record<string, number> = {};
  const BATCH = 200;
  for (let i = 0; i < allSaleIds.length; i += BATCH) {
    const { data: soldRows } = await supabase
      .from("stove_ids").select("sale_id").in("sale_id", allSaleIds.slice(i, i + BATCH));
    (soldRows || []).forEach((r: any) => {
      soldBySaleId[r.sale_id] = (soldBySaleId[r.sale_id] || 0) + 1;
    });
  }
  const agentSoldCount: Record<string, number> = {};
  Object.entries(agentSaleIdMap).forEach(([aid, sids]) => {
    agentSoldCount[aid] = sids.reduce((sum, sid) => sum + (soldBySaleId[sid] || 0), 0);
  });

  // Compose final list
  const agentsWithCounts = (agents || []).map((agent: any) => {
    const directIds = agentDirectIds[agent.id]  || new Set<string>();
    const allIds    = agentAllOrgIds[agent.id]  || new Set<string>();
    const states    = (agentStates[agent.id]    || []).sort();
    const received  = [...allIds].reduce((s, oid) => s + (orgStoveStats[oid]?.total     ?? 0), 0);
    const available = [...allIds].reduce((s, oid) => s + (orgStoveStats[oid]?.available ?? 0), 0);
    return {
      ...agent,
      assigned_organizations_count: directIds.size,
      assigned_states_count:        states.length,
      total_partners_count:         allIds.size,
      assigned_states:              states,
      stove_summary: { received, sold: agentSoldCount[agent.id] ?? 0, available },
    };
  });

  if (organizationId && agentsWithCounts.length > 0) {
    const agentIds = agentsWithCounts.map((agent: any) => agent.id).filter(Boolean);
    const salesByAgent: Record<string, { count: number; amount: number; saleIds: string[] }> = {};

    const { data: orgSales, error: orgSalesError } = await supabase
      .from("sales")
      .select("id, created_by, amount")
      .eq("organization_id", organizationId)
      .in("created_by", agentIds);

    if (orgSalesError) {
      console.warn("⚠️ Failed to fetch partner-scoped agent sales:", orgSalesError.message);
    }

    (orgSales || []).forEach((sale: any) => {
      if (!sale.created_by) return;
      if (!salesByAgent[sale.created_by]) {
        salesByAgent[sale.created_by] = { count: 0, amount: 0, saleIds: [] };
      }
      salesByAgent[sale.created_by].count += 1;
      salesByAgent[sale.created_by].amount += Number(sale.amount) || 0;
      salesByAgent[sale.created_by].saleIds.push(sale.id);
    });

    // Batch-fetch attended stove counts (sold stove_ids per sale_id)
    const allSaleIds = Object.values(salesByAgent).flatMap((s) => s.saleIds);
    const stoveCountBySaleId: Record<string, number> = {};
    if (allSaleIds.length > 0) {
      const { data: soldStoves } = await supabase
        .from("stove_ids")
        .select("sale_id")
        .in("sale_id", allSaleIds);
      (soldStoves || []).forEach((s: any) => {
        if (s.sale_id) stoveCountBySaleId[s.sale_id] = (stoveCountBySaleId[s.sale_id] || 0) + 1;
      });
    }

    // Partner-level unattended = stove_ids assigned to this org with status 'available'
    const { count: partnerUnattended } = await supabase
      .from("stove_ids")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("status", "available");

    agentsWithCounts.forEach((agent: any) => {
      const stats = salesByAgent[agent.id] || { count: 0, amount: 0, saleIds: [] };
      const attendedCount = stats.saleIds.reduce((sum: number, sid: string) => sum + (stoveCountBySaleId[sid] || 0), 0);
      agent.partner_sales_count = stats.count;
      agent.partner_sold_stoves_count = stats.count;
      agent.partner_sales_amount = stats.amount;
      agent.partner_attended_count = attendedCount;
      agent.partner_unattended_count = partnerUnattended ?? 0;
    });
  }

  // Batch-resolve updated_by names
  const updaterIds = [...new Set(
    agentsWithCounts
      .filter((a: any) => a.updated_by)
      .map((a: any) => a.updated_by as string)
  )];
  const updaterMap: Record<string, string> = {};
  if (updaterIds.length > 0) {
    const { data: updaters } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", updaterIds);
    (updaters || []).forEach((u: any) => { updaterMap[u.id] = u.full_name || u.email; });
  }
  const agentsWithModifier = agentsWithCounts.map((a: any) => ({
    ...a,
    updated_by_name: a.updated_by ? (updaterMap[a.updated_by] ?? null) : null,
  }));

  const totalPages = Math.ceil((count || 0) / limit);

  console.log(`✅ Found ${agents?.length || 0} agents`);

  return {
    message: `Found ${count || 0} agents`,
    data: agentsWithModifier,
    pagination: {
      currentPage: page,
      totalPages,
      totalItems: count || 0,
      itemsPerPage: limit,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    },
  };
}

export async function getAgent(supabase: any, agentId: string) {
  console.log("🔍 Fetching single agent:", agentId);

  const { data: agent, error } = await supabase
    .from("profiles")
    .select("id, full_name, email, phone, role, status, created_at, last_login, updated_at, updated_by")
    .eq("id", agentId)
    .in("role", ["acsl_agent", "acsl_agent_manager", "super_admin"])
    .single();

  if (error) {
    if (error.code === "PGRST116") throw new Error("Agent not found");
    throw new Error(`Database error: ${error.message}`);
  }

  // Also fetch assigned organizations
  const { data: orgs } = await supabase
    .from("acsl_agent_organizations")
    .select(`
      id,
      assigned_at,
      organization_id,
      organizations (
        id,
        partner_name,
        branch,
        state
      )
    `)
    .eq("agent_id", agentId);

  const assignedOrganizations = (orgs || []).map((row: any) => ({
    assignment_id: row.id,
    assigned_at: row.assigned_at,
    ...row.organizations,
  }));

  // Fetch assigned states
  const { data: stateRows } = await supabase
    .from("acsl_agent_states")
    .select("id, state, assigned_at")
    .eq("agent_id", agentId)
    .order("state", { ascending: true });

  const assignedStates = (stateRows || []).map((r: any) => r.state);

  console.log("✅ Agent found:", agent.id);

  return {
    message: "Agent retrieved successfully",
    data: {
      ...agent,
      assigned_organizations: assignedOrganizations,
      assigned_states: assignedStates,
    },
  };
}

export async function getAgentOrganizations(supabase: any, agentId: string, searchParams?: URLSearchParams) {
  const dateFrom = searchParams?.get("date_from") ?? null;
  const dateTo = searchParams?.get("date_to") ?? null;
  console.log("🔍 Fetching organizations for agent:", agentId);

  // Verify the agent exists
  const { data: agent, error: agentError } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", agentId)
    .in("role", ["acsl_agent", "acsl_agent_manager", "super_admin"])
    .single();

  if (agentError) {
    if (agentError.code === "PGRST116") throw new Error("Agent not found");
    throw new Error(`Database error: ${agentError.message}`);
  }

  const { data: rows, error } = await supabase
    .from("acsl_agent_organizations")
    .select(`
      id,
      assigned_at,
      assigned_by,
      organization_id,
      organizations (
        id,
        partner_name,
        branch,
        state,
        contact_person,
        contact_phone,
        email
      )
    `)
    .eq("agent_id", agentId)
    .order("assigned_at", { ascending: false });

  if (error) throw new Error(`Database error: ${error.message}`);

  // Direct org assignments — annotated with source: "direct"
  const directOrgs = (rows || []).map((row: any) => ({
    assignment_id: row.id,
    assigned_at: row.assigned_at,
    assigned_by: row.assigned_by,
    source: "direct" as const,
    ...row.organizations,
  }));

  const directOrgIds = new Set(directOrgs.map((o: any) => o.id));

  // Fetch assigned states
  const { data: stateRows } = await supabase
    .from("acsl_agent_states")
    .select("id, state, assigned_at, assigned_by")
    .eq("agent_id", agentId)
    .order("state", { ascending: true });

  const assignedStates: string[] = (stateRows || []).map((r: any) => r.state);

  // Build a lookup: state → assignment metadata
  const stateAssignmentMap: Record<string, any> = {};
  (stateRows || []).forEach((r: any) => {
    stateAssignmentMap[r.state] = { id: r.id, assigned_at: r.assigned_at, assigned_by: r.assigned_by };
  });

  // Resolve states → organizations. Direct partner assignments take
  // precedence: a state only expands to every org in it when the agent has
  // no specific partners assigned.
  let stateOrgs: any[] = [];
  if (assignedStates.length > 0 && directOrgs.length === 0) {
    const { data: stateOrgRows } = await supabase
      .from("organizations")
      .select("id, partner_name, branch, state, contact_person, contact_phone, email")
      .in("state", assignedStates);

    stateOrgs = (stateOrgRows || [])
      .filter((o: any) => !directOrgIds.has(o.id))
      .map((o: any) => {
        const stateAssignment = stateAssignmentMap[o.state] || {};
        return {
          assignment_id: stateAssignment.id || null,
          assigned_at: stateAssignment.assigned_at || null,
          assigned_by: stateAssignment.assigned_by || null,
          source: "state" as const,
          source_state: o.state,
          ...o,
        };
      });
  }

  const allOrganizations = [...directOrgs, ...stateOrgs];

  console.log(
    `✅ Found ${directOrgs.length} direct + ${stateOrgs.length} state-resolved organizations`
  );

  // Fetch per-org stove counts using the same RPC used by manage-organizations
  // (avoids Supabase's 1000-row default cap on row-fetching queries)
  const allOrgIds = allOrganizations.map((o: any) => o.id).filter(Boolean);
  let orgStatsMap: Record<string, { total: number; sold: number; available: number }> = {};

  if (allOrgIds.length > 0) {
    const { data: stoveCounts, error: stoveRpcErr } = await supabase.rpc(
      "get_organization_stove_counts",
      { org_ids: allOrgIds }
    );

    if (stoveRpcErr) {
      console.warn("⚠️ RPC get_organization_stove_counts failed, counts will be 0:", stoveRpcErr.message);
    } else {
      (stoveCounts || []).forEach((row: any) => {
        orgStatsMap[row.organization_id] = {
          total: row.total_count ?? 0,
          sold: row.sold_count ?? 0,
          available: row.available_count ?? 0,
        };
      });
    }
  }

  // Count stoves sold specifically BY this agent (date-filtered if params provided)
  let agentSoldCount = 0;
  let salesQuery = supabase.from("sales").select("id").eq("created_by", agentId);
  if (dateFrom) salesQuery = salesQuery.gte("sales_date", dateFrom);
  if (dateTo) salesQuery = salesQuery.lte("sales_date", dateTo);
  const { data: agentSaleRows } = await salesQuery;
  const agentSaleIds = (agentSaleRows || []).map((s: any) => s.id as string);
  if (agentSaleIds.length > 0) {
    // Batch to avoid URL length limits
    const BATCH = 200;
    for (let i = 0; i < agentSaleIds.length; i += BATCH) {
      const { count } = await supabase
        .from("stove_ids")
        .select("id", { count: "exact", head: true })
        .in("sale_id", agentSaleIds.slice(i, i + BATCH));
      agentSoldCount += count ?? 0;
    }
  }

  // Annotate each org with accurate stove counts
  const orgsWithStats = allOrganizations.map((o: any) => ({
    ...o,
    total_sales: orgStatsMap[o.id]?.total ?? 0,
    approved_sales: orgStatsMap[o.id]?.sold ?? 0,
    pending_sales: orgStatsMap[o.id]?.available ?? 0,
  }));

  console.log(`✅ Sales stats attached for ${allOrgIds.length} organizations`);

  return {
    message: `Found ${allOrganizations.length} assigned organizations`,
    data: orgsWithStats,
    assigned_states: assignedStates,
    agent_sold_count: agentSoldCount,
    summary: {
      direct_count: directOrgs.length,
      state_count: assignedStates.length,
      state_resolved_org_count: stateOrgs.length,
      total_unique_orgs: allOrganizations.length,
    },
  };
}
