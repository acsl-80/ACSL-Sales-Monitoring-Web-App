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

  /*
   * Which agents cover this partner.
   *
   * Four queries and a hand-applied precedence rule became one call. The rule
   * lives in public.acsl_agents_covering_org, the same definition the forward
   * lookup uses, so this list and an agent's own partner list cannot disagree.
   * It also honours exclusions, which the version here could not see at all.
   */
  let filteredAgentIds: string[] | null = null;
  if (organizationId) {
    const { data: coveringRows, error: coveringError } = await supabase.rpc(
      "acsl_agents_covering_org",
      { p_org_id: organizationId },
    );
    if (coveringError) {
      throw new Error(`Could not resolve agents for this partner: ${coveringError.message}`);
    }

    filteredAgentIds = [...new Set((coveringRows || []).map((r: any) => r.agent_id as string))];
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

  /*
   * 3: effective coverage for the whole page, in one call.
   *
   * This is why acsl_agent_org_scope takes an array. It used to be a third
   * query expanding states to orgs, plus a hand-applied precedence rule that
   * was the fourth copy of something the database now decides once. The rows
   * below are the same answer create-sale gates on, so what an admin reads
   * here and what an agent can actually do cannot drift apart.
   */
  const { data: scopeRows, error: scopeError } = await supabase.rpc(
    "acsl_agent_org_scope",
    { p_agent_ids: agentIdList },
  );
  if (scopeError) {
    throw new Error(`Could not resolve agent coverage: ${scopeError.message}`);
  }

  // Named partners and held states stay as they are: both are shown in the UI
  // and both remain true whichever rule is in force for the agent.
  const agentDirectIds: Record<string, Set<string>> = {};
  const agentAllOrgIds: Record<string, Set<string>> = {};
  const agentStates:    Record<string, string[]>     = {};

  (allDirectOrgRows || []).forEach((r: any) => {
    if (!agentDirectIds[r.agent_id]) agentDirectIds[r.agent_id] = new Set();
    agentDirectIds[r.agent_id].add(r.organization_id);
  });
  (allStateRows || []).forEach((r: any) => {
    if (!agentStates[r.agent_id]) agentStates[r.agent_id] = [];
    agentStates[r.agent_id].push(r.state);
  });
  (scopeRows || []).forEach((r: any) => {
    if (!agentAllOrgIds[r.agent_id]) agentAllOrgIds[r.agent_id] = new Set();
    agentAllOrgIds[r.agent_id].add(r.organization_id);
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
    // Batch to keep request URLs small — sale volume can far exceed page size.
    const SALE_BATCH = 200;
    for (let i = 0; i < allSaleIds.length; i += SALE_BATCH) {
      const { data: soldStoves } = await supabase
        .from("stove_ids")
        .select("sale_id")
        .in("sale_id", allSaleIds.slice(i, i + SALE_BATCH));
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

  /*
   * What this agent actually covers, from the one definition of the rule.
   *
   * This used to restate the precedence condition verbatim, the fourth copy of
   * it. Now the database decides and this only presents the answer: which
   * partners, and whether each arrived by name or by state.
   *
   * Exclusions are handled for free. The old version could not express one, so
   * a partner an admin had carved out still appeared in this list.
   */
  const { data: scopeRows, error: scopeError } = await supabase.rpc(
    "acsl_agent_org_scope",
    { p_agent_ids: [agentId] },
  );
  if (scopeError) throw new Error(`Could not resolve coverage: ${scopeError.message}`);

  const sourceByOrgId = new Map<string, string>(
    (scopeRows || []).map((r: any) => [r.organization_id as string, r.source as string]),
  );
  const directMetaByOrgId = new Map<string, any>(directOrgs.map((o: any) => [o.id, o]));
  const coveredOrgIds = [...sourceByOrgId.keys()];

  let coveredOrgRows: any[] = [];
  if (coveredOrgIds.length > 0) {
    const { data, error: orgErr } = await supabase
      .from("organizations")
      .select("id, partner_name, branch, state, contact_person, contact_phone, email")
      .in("id", coveredOrgIds);
    if (orgErr) throw new Error(`Database error: ${orgErr.message}`);
    coveredOrgRows = data || [];
  }

  const allOrganizations = coveredOrgRows.map((o: any) => {
    if (sourceByOrgId.get(o.id) === "explicit") {
      // Keep the row the direct query already built: it carries the real
      // assignment id and who made it.
      return directMetaByOrgId.get(o.id) ?? {
        assignment_id: null, assigned_at: null, assigned_by: null,
        source: "direct" as const, ...o,
      };
    }
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

  const viaState = allOrganizations.filter((o: any) => o.source === "state").length;
  console.log(
    `✅ Found ${allOrganizations.length - viaState} direct + ${viaState} state-resolved organizations`
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

  // Sales model entitlements, as bare IDs — the SAME field `manage-organizations`
  // returns. Agent roles read their partners from HERE, not from that endpoint,
  // so omitting it made every agent-selected partner look unrestricted (the
  // clients treat a missing list as "unknown" and show every model).
  const modelIdsByOrg: Record<string, string[]> = {};
  let modelLookupOk = true;
  if (allOrgIds.length > 0) {
    const { data: modelLinks, error: modelLinksErr } = await supabase
      .from("organization_payment_models")
      .select("organization_id, payment_model_id")
      .in("organization_id", allOrgIds);

    if (modelLinksErr) {
      console.warn("⚠️ Could not fetch payment model assignments:", modelLinksErr.message);
      // Report null (unknown) rather than [] — [] would read as a real answer.
      modelLookupOk = false;
    } else {
      for (const link of modelLinks || []) {
        (modelIdsByOrg[link.organization_id] ||= []).push(link.payment_model_id);
      }
    }
  }

  // Annotate each org with accurate stove counts
  const orgsWithStats = allOrganizations.map((o: any) => ({
    ...o,
    total_sales: orgStatsMap[o.id]?.total ?? 0,
    approved_sales: orgStatsMap[o.id]?.sold ?? 0,
    pending_sales: orgStatsMap[o.id]?.available ?? 0,
    payment_model_ids: modelLookupOk ? (modelIdsByOrg[o.id] || []) : null,
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
      state_resolved_org_count: viaState,
      total_unique_orgs: allOrganizations.length,
    },
  };
}
