// KPI stats for the agents manager dashboard

export async function getKpiStats(supabase: any, searchParams: URLSearchParams) {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    .toISOString().split("T")[0];
  const rawFrom = searchParams.get("date_from");
  const rawTo   = searchParams.get("date_to");
  const hasDateFilter = !!(rawFrom || rawTo);
  const from = rawFrom || thirtyDaysAgo;
  const to   = rawTo   || now.toISOString().split("T")[0];

  console.log(`📊 KPI stats: ${from} → ${to}`);

  // ── Agent profiles (id + name) ──────────────────────────────────────────────
  const { data: agentProfiles, error: profilesErr } = await supabase
    .from("profiles")
    .select("id")
    .in("role", ["acsl_agent", "acsl_agent_manager"]);
  if (profilesErr) throw new Error(`Failed to fetch agent profiles: ${profilesErr.message}`);

  const agentIds = new Set((agentProfiles || []).map((p: any) => p.id as string));

  // ── Sales in date range ─────────────────────────────────────────────────────
  const { data: salesData, error: salesErr } = await supabase
    .from("sales")
    .select("id, created_by, organization_id, state_backup")
    .eq("is_archived", false)
    .gte("sales_date", from)
    .lte("sales_date", to);
  if (salesErr) throw new Error(`Failed to fetch sales: ${salesErr.message}`);

  const sales: any[] = salesData || [];
  const agentSales = sales.filter((s) => agentIds.has(s.created_by));
  const agentSaleIds = agentSales.map((s) => s.id as string);

  // Total active agents
  const activeAgentIds = [...new Set(agentSales.map((s) => s.created_by as string))];

  // Total active partners
  const activePartnerIds = [
    ...new Set(sales.filter((s) => s.organization_id).map((s) => s.organization_id as string)),
  ];

  // Most active state
  const stateCount: Record<string, number> = {};
  sales.forEach((s) => {
    if (s.state_backup) stateCount[s.state_backup] = (stateCount[s.state_backup] || 0) + 1;
  });
  const stateEntries = Object.entries(stateCount).sort((a, b) => b[1] - a[1]);
  const mostActiveState      = stateEntries[0]?.[0] ?? null;
  const mostActiveStateSales = stateEntries[0]?.[1] ?? 0;

  // ── Total stoves sold by agents in range (batched) ──────────────────────────
  let totalSoldByAgents = 0;
  const BATCH = 200;
  for (let i = 0; i < agentSaleIds.length; i += BATCH) {
    const { count } = await supabase
      .from("stove_ids")
      .select("id", { count: "exact", head: true })
      .in("sale_id", agentSaleIds.slice(i, i + BATCH));
    totalSoldByAgents += count ?? 0;
  }

  // ── Stoves in stock ─────────────────────────────────────────────────────────
  // No date filter → current snapshot of available stoves (all-time)
  // Date filter    → stoves that came into inventory during that period
  let stovesInStock = 0;
  {
    let q = supabase.from("stove_ids").select("id", { count: "exact", head: true }).eq("is_archived", false);
    if (hasDateFilter) {
      q = q.gte("created_at", `${from}T00:00:00.000Z`).lte("created_at", `${to}T23:59:59.999Z`);
    } else {
      q = q.eq("status", "available");
    }
    const { count, error: stockErr } = await q;
    if (stockErr) console.warn(`⚠️ Stock count error: ${stockErr.message}`);
    stovesInStock = count ?? 0;
  }

  console.log(
    `✅ KPI: soldByAgents=${totalSoldByAgents}, activeAgents=${activeAgentIds.length}, ` +
    `activePartners=${activePartnerIds.length}, mostActiveState=${mostActiveState}, inStock=${stovesInStock}`
  );

  return {
    message: "KPI stats retrieved",
    data: {
      totalSoldByAgents,
      totalActiveAgents: activeAgentIds.length,
      mostActiveState,
      mostActiveStateSales,
      totalActivePartners: activePartnerIds.length,
      stovesInStock: stovesInStock ?? 0,
      activeAgentIds,
      activePartnerIds,
    },
  };
}
