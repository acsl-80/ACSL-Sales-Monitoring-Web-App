import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { countInChunks, selectInChunks } from "../_shared/chunkedQuery.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization header");

    // User client — for auth verification only
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } },
    );

    // Service-role client — bypasses RLS for data queries (profiles, etc.)
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) throw new Error("Invalid or expired token");

    const { data: profile, error: profileError } = await serviceClient
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (profileError) throw new Error("Failed to fetch user profile");

    if (profile.role !== "super_admin") {
      return new Response(
        JSON.stringify({ success: false, error: "Unauthorized: Super admin access required" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = await req.json().catch(() => ({}));
    // Accept either a single `year` or an array of `years`. Empty/absent → current year.
    const rawYears: number[] = Array.isArray(body.years) && body.years.length
      ? body.years.map((y: any) => Number(y)).filter((y: number) => !isNaN(y))
      : [Number(body.year) || new Date().getFullYear()];
    const years = [...new Set(rawYears)].sort((a, b) => a - b);
    const minYear = years[0];
    const maxYear = years[years.length - 1];
    // Years are contiguous (or a single year) when the span equals the count.
    const yearsContiguous = maxYear - minYear + 1 === years.length;

    const organizationIds: string[] | null = body.organization_ids?.length ? body.organization_ids : null;
    const stateFilter: string | null = body.state || null;
    const branchFilter: string | null = body.branch || null;

    // Custom date range overrides year-based range when provided
    const hasCustomDate = !!(body.date_from || body.date_to);
    const startDate = body.date_from || `${minYear}-01-01`;
    const endOfYear = body.date_to
      ? (() => { const d = new Date(body.date_to + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); })()
      : `${maxYear + 1}-01-01`;

    /*
     * Stock counted over the selected period, plus stock we cannot date.
     *
     * An earlier cut of this made stock a balance: everything held as at the
     * end of the period. Defensible in the abstract, wrong here for two
     * reasons. Selecting 2026 then returned 2025's stoves as well, so the
     * filter did not filter. And Partner Records in the Data Center does
     * narrow by period, so the two screens disagreed about what a year means,
     * which is the whole problem this work exists to end.
     *
     * The year filter narrows. What was actually broken was the DEFAULT: the
     * dashboard opened on the current year and presented the result as a
     * total, which is how 204 stoves went missing from a figure labelled
     * "Total Stoves Received By Partner(s)". The default is now every year.
     *
     * Undated stock is always included, in every period. `gte`/`lt` against
     * NULL is never true, so a stove with no transfer date would vanish from
     * every view including the all-time one. We know it reached a partner; we
     * only do not know when, and dropping it silently is the worse answer.
     * Production carries none today; the preview seed carries 170, which is
     * how the silent version of this was caught.
     */
    const applyStockPeriod = (query: any, col: string) => {
      if (hasCustomDate || yearsContiguous) {
        return query.or(
          `and(${col}.gte.${startDate},${col}.lt.${endOfYear}),${col}.is.null`
        );
      }
      return query.or(
        years
          .map((y) => `and(${col}.gte.${y}-01-01,${col}.lt.${y + 1}-01-01)`)
          .concat(`${col}.is.null`)
          .join(",")
      );
    };

    // Apply the date period to a query. Contiguous years / custom dates use a
    // simple range; non-contiguous year sets use an OR of per-year ranges.
    const applyPeriod = (query: any, col: string) => {
      if (hasCustomDate || yearsContiguous) {
        return query.gte(col, startDate).lt(col, endOfYear);
      }
      const orParts = years
        .map((y) => `and(${col}.gte.${y}-01-01,${col}.lt.${y + 1}-01-01)`)
        .join(",");
      return query.or(orParts);
    };

    // Resolve partner names from organization_ids (grouped partner may span
    // multiple orgs). The org list can be large when a super admin filters by
    // many partners, so chunk it to keep the request URL small.
    let partnerNames: string[] | null = null;
    if (organizationIds) {
      const { data: orgs } = await selectInChunks(organizationIds, (c) =>
        serviceClient.from("organizations").select("partner_name").in("id", c)
      );
      partnerNames = orgs ? [...new Set(orgs.map((o: any) => o.partner_name).filter(Boolean))] : null;
    }

    // Base sales filters EXCLUDING partner_name (applied per-chunk when large).
    const buildSalesBase = (query: any) => {
      query = query.eq("is_archived", false);
      if (stateFilter) query = query.ilike("state_backup", stateFilter);
      if (branchFilter) query = query.eq("retailer_branch", branchFilter);
      return query;
    };

    // Stoves received count — chunk over organizationIds when present.
    const receivedPromise = organizationIds
      ? countInChunks(organizationIds, (c) =>
          applyStockPeriod(
            serviceClient.from("stove_ids").select("*", { count: "exact", head: true }).not("organization_id", "is", null),
            "transfer_sales_date"
          ).in("organization_id", c)
        )
      : applyStockPeriod(
          serviceClient.from("stove_ids").select("*", { count: "exact", head: true }).not("organization_id", "is", null),
          "transfer_sales_date"
        );

    /*
     * Every number below comes from one SQL function over the same base
     * filter and the same period. Until now the rows were fetched into this
     * function and summed here, and PostgREST stops an unranged select at
     * 1,000 rows (max_rows in config.toml), so the money cards, the state
     * table and the model donut were computed from the first thousand sales
     * and presented as totals: 2,039 live sales read as 1,000 on 2026-09-02.
     *
     * The window is what it was: a custom range or a contiguous year set is
     * an inclusive date pair; a non-contiguous year set is passed as the
     * years themselves. The sold count is the count of those same rows, as
     * before. One thing is stricter: partners that resolve to no name now
     * mean no rows, rather than falling through to every partner.
     */
    const rangeMode = hasCustomDate || yearsContiguous;
    const dateToInclusive = body.date_to || `${maxYear}-12-31`;
    const summaryPromise = serviceClient.rpc("dashboard_sales_summary", {
      p_partner_names: partnerNames,
      p_state: stateFilter,
      p_branch: branchFilter,
      p_date_from: rangeMode ? startDate : null,
      p_date_to: rangeMode ? dateToInclusive : null,
      p_years: rangeMode ? null : years,
      p_top_n: 5,
    });

    const [receivedResult, summaryResult] = await Promise.all([receivedPromise, summaryPromise]);

    if (summaryResult.error) throw new Error("Failed to fetch sales data");
    const summary = summaryResult.data || {};

    const stovesReceivedByPartners = receivedResult.count ?? 0;
    const stovesSoldToEndUsers = Number(summary.total) || 0;
    // Available = received over the period minus sold over the period
    const availableStoves = Math.max(0, stovesReceivedByPartners - stovesSoldToEndUsers);

    const expectedReceivable = Number(summary.expected_receivable) || 0;
    const amountReceived = Number(summary.amount_received) || 0;
    const outstandingBalance = expectedReceivable - amountReceived;

    // The shapes below are unchanged: the SQL gives counts, the percentages
    // are still worked out here, as strings for the two top-five lists and as
    // numbers for the model donut, exactly as the browser and the mobile app
    // have always received them.
    const totalSales = stovesSoldToEndUsers;
    const pct = (count: number) => (totalSales > 0 ? ((count / totalSales) * 100).toFixed(1) : "0");
    const salesByState = (summary.by_state || []).map((r: any) => ({
      state: r.state,
      count: Number(r.count),
    }));
    const topPartners = (summary.by_partner || []).map((r: any) => ({
      name: r.name,
      branch: r.branch ?? null,
      count: Number(r.count),
      percentage: pct(Number(r.count)),
    }));
    const topAgents = (summary.by_agent || []).map((r: any) => ({
      name: r.name,
      count: Number(r.count),
      percentage: pct(Number(r.count)),
    }));
    const salesModelData = (summary.by_model || []).map((r: any) => ({
      model: r.model,
      count: Number(r.count),
      percentage: totalSales > 0 ? (Number(r.count) / totalSales) * 100 : 0,
    }));

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          stovesReceivedByPartners,
          stovesSoldToEndUsers,
          availableStoves,
          expectedReceivable,
          amountReceived,
          outstandingBalance,
          salesByState,
          salesModelData,
          topPartners,
          topAgents,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("Error in get-super-admin-dashboard:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
