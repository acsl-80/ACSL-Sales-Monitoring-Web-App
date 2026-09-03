import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withCors } from "./cors.ts";
import { authenticate } from "./authenticate.ts";
import { resolveAssignedOrgIds } from "../_shared/resolveAssignedOrgIds.ts";
import { countInChunks } from "../_shared/chunkedQuery.ts";

/**
 * The sales-derived numbers, in the shape this function has always returned.
 * The SQL gives counts; the percentage is still worked out here.
 */
const shapeSummary = (summary: any) => {
  const total = Number(summary?.total) || 0;
  const expectedReceivable = Number(summary?.expected_receivable) || 0;
  const amountReceived = Number(summary?.amount_received) || 0;
  const byState = (summary?.by_state || []).map((r: any) => ({ state: r.state, count: Number(r.count) }));
  const salesModelData = (summary?.by_model || []).map((r: any) => ({
    model: r.model,
    count: Number(r.count),
    percentage: total > 0 ? (Number(r.count) / total) * 100 : 0,
  }));
  return { expectedReceivable, amountReceived, byState, salesModelData };
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return withCors(new Response("ok", { status: 200 }));
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const authHeader = req.headers.get("Authorization") ?? "";
    const { userId, userRole, organizationId } = await authenticate(supabase, authHeader);

    // Parse year from body
    const { year = new Date().getFullYear() } = await req.json().catch(() => ({}));
    const startDate = `${year}-01-01`;
    const endOfYear = `${year + 1}-01-01`; // exclusive upper bound

    // Partner Agent / Agent: dashboard is scoped to their own recorded sales only
    // (RBAC: Dashboard -> "Own sales"), not the whole partner organization.
    const isOwnSalesScope = userRole === "partner_agent" || userRole === "agent";

    // Attribution filter: match sales attributed to this person via
    // sold_on_behalf_of, falling back to created_by for older/edge-case rows
    // where sold_on_behalf_of was never backfilled. Always excludes cancelled
    // sales (is_archived = true) — a cancelled-then-corrected sale must count
    // once, not twice, in every KPI derived from the `sales` table.
    const personalSalesFilter = (q: any) =>
      q
        .eq("is_archived", false)
        .or(`sold_on_behalf_of.eq.${userId},and(sold_on_behalf_of.is.null,created_by.eq.${userId})`);

    if (isOwnSalesScope) {
      // Stove inventory (received/available) belongs to the partner organization —
      // a partner agent inherits visibility into their org's whole stove ledger,
      // same as the partner they're tied to. Sales-derived numbers (sold count,
      // financials, sales model, by-state) are attributed to the agent personally.
      const [receivedResult, summaryResult] = await Promise.all([
        organizationId
          ? supabase
              .from("stove_ids")
              .select("*", { count: "exact", head: true })
              .eq("organization_id", organizationId)
              .lt("created_at", endOfYear)
          : Promise.resolve({ count: 0 }),

        // One SQL call for every sales-derived number. The rows used to be
        // fetched here and summed, and an unranged select stops at 1,000.
        // Received is what was collected, total_paid, for outright sales too.
        supabase.rpc("dashboard_sales_summary", {
          p_agent_ids: [userId],
          p_date_from: startDate,
          p_date_to: `${year}-12-31`,
          p_sold_before: endOfYear,
        }),
      ]);

      if (summaryResult.error) throw new Error("Failed to fetch sales data");
      const summary = summaryResult.data || {};
      const { expectedReceivable, amountReceived, byState, salesModelData } = shapeSummary(summary);

      const stovesReceived = receivedResult.count ?? 0;
      const stovesSold = Number(summary.sold_cumulative) || 0;

      return withCors(
        new Response(
          JSON.stringify({
            success: true,
            data: {
              stovesReceived,
              stovesSold,
              availableStoves: Math.max(0, stovesReceived - stovesSold),
              expectedReceivable,
              amountReceived,
              outstandingBalance: expectedReceivable - amountReceived,
              byState,
              salesModelData,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );
    }

    // Resolve org IDs assigned to this agent
    const resolved = await resolveAssignedOrgIds(supabase, userId);
    const assignedOrgIds = [...new Set([...resolved.assignedOrgIds, ...(organizationId ? [organizationId] : [])])];

    if (assignedOrgIds.length === 0) {
      return withCors(
        new Response(
          JSON.stringify({
            success: true,
            data: {
              stovesReceived: 0, stovesSold: 0, availableStoves: 0,
              expectedReceivable: 0, amountReceived: 0, outstandingBalance: 0,
              byState: [], salesModelData: [],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );
    }

    // A plain ACSL agent (not a manager) sees stove inventory across every
    // partner assigned to them, but sales-derived numbers are attributed to
    // them personally — same split as the partner-agent case above. An
    // acsl_agent_manager, by contrast, is tracking their whole team's
    // performance, so their sales stay aggregated across assignedOrgIds.
    const isPersonalSalesAttribution = userRole === "acsl_agent";

    // A manager must see every sale their team recorded, even for a partner
    // org that's only assigned to the subordinate — not the manager — so the
    // team's own sales are matched by attribution (sold_on_behalf_of) in
    // addition to the org-based scope.
    // Attribution-only clause (no org) — used to count sales actually sold by
    // the manager or an ACSL agent on their team, as opposed to org-wide sales.
    let teamIds: string[] | null = null;
    let teamAttributionClause: string | null = null;
    if (userRole === "acsl_agent_manager") {
      const { data: subordinates } = await supabase
        .from("profiles")
        .select("id")
        .eq("manager_id", userId)
        .eq("role", "acsl_agent");
      teamIds = [userId, ...(subordinates || []).map((s: any) => s.id)];
      // Attribution matches EITHER sold_on_behalf_of OR created_by — the latter
      // is the fallback for older rows where sold_on_behalf_of was never set.
      const teamList = teamIds.join(",");
      teamAttributionClause = `sold_on_behalf_of.in.(${teamList}),created_by.in.(${teamList})`;
    }

    // Stove inventory is org-only (no attribution): a chunked exact count up
    // to the end of the selected year, as before. Every sales-derived number
    // comes from one SQL call over the same scope: an ACSL agent's own
    // attributed sales, or, for a manager, every sale of an assigned
    // organisation plus every sale the team recorded elsewhere, each counted
    // once. The rows used to be fetched here and summed, and an unranged
    // select stops at 1,000; the sold count was the length of that capped set.
    // Received is what was collected, total_paid, for outright sales too.
    const scopeParams = isPersonalSalesAttribution
      ? { p_agent_ids: [userId] }
      : { p_organization_ids: assignedOrgIds, p_team_ids: teamIds };
    const [receivedResult, summaryResult] = await Promise.all([
      countInChunks(assignedOrgIds, (c) =>
        supabase
          .from("stove_ids")
          .select("*", { count: "exact", head: true })
          .in("organization_id", c)
          .lt("created_at", endOfYear)
      ),
      supabase.rpc("dashboard_sales_summary", {
        ...scopeParams,
        p_date_from: startDate,
        p_date_to: `${year}-12-31`,
        p_sold_before: endOfYear,
      }),
    ]);

    if (summaryResult.error) throw new Error("Failed to fetch sales data");
    const summary = summaryResult.data || {};
    const stovesSoldCount = Number(summary.sold_cumulative) || 0;
    const { expectedReceivable, amountReceived, byState, salesModelData } = shapeSummary(summary);

    // Actual sales made by the manager + their team (attribution only, not the
    // full org-wide scope). Only meaningful for acsl_agent_manager.
    let teamSalesCount: number | null = null;
    if (teamAttributionClause) {
      const { count } = await supabase
        .from("sales")
        .select("*", { count: "exact", head: true })
        .eq("is_archived", false)
        .or(teamAttributionClause)
        .gte("sales_date", startDate)
        .lt("sales_date", endOfYear);
      teamSalesCount = count ?? 0;
    }

    return withCors(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            stovesReceived: receivedResult.count ?? 0,
            stovesSold: stovesSoldCount,
            availableStoves: Math.max(0, (receivedResult.count ?? 0) - stovesSoldCount),
            expectedReceivable,
            amountReceived,
            outstandingBalance: expectedReceivable - amountReceived,
            byState,
            salesModelData,
            teamSalesCount,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
  } catch (error: any) {
    console.error("ACSL agent dashboard error:", error);
    let statusCode = 500;
    if (error.message?.includes("Unauthorized")) statusCode = 403;
    return withCors(
      new Response(
        JSON.stringify({ success: false, message: error.message || "Internal server error" }),
        { status: statusCode, headers: { "Content-Type": "application/json" } }
      )
    );
  }
});
