import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function withCors(res: Response): Response {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.headers.set(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type"
  );
  return res;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return withCors(
      new Response("ok", {
        status: 200,
      })
    );
  }

  // Parse year or date filters from body
  let dateFrom: string | null = null;
  let dateTo: string | null = null;
  let endOfYear: string | null = null; // exclusive upper bound for balance-sheet stove counts
  try {
    const body = await req.json().catch(() => ({}));
    if (body.year) {
      dateFrom = `${body.year}-01-01`;
      dateTo = `${body.year}-12-31`;
      endOfYear = `${Number(body.year) + 1}-01-01`;
    } else {
      dateFrom = body.date_from || null;
      dateTo = body.date_to || null;
      // Derive endOfYear from dateTo if present (for balance-sheet queries)
      if (dateTo) {
        const toYear = new Date(dateTo).getFullYear();
        endOfYear = `${toYear + 1}-01-01`;
      }
    }
  } catch (_) {
    // ignore parse errors
  }

  // Create client for user authentication
  const userSupabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    {
      global: {
        headers: { Authorization: req.headers.get("Authorization") ?? "" },
      },
    }
  );

  // Create service client for data operations (bypasses RLS)
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  try {
    // Authenticate user with user client
    const { data: userData, error: authError } =
      await userSupabase.auth.getUser();
    if (authError || !userData?.user) {
      return withCors(
        new Response(
          JSON.stringify({ success: false, message: "Unauthorized" }),
          { status: 401 }
        )
      );
    }

    // Get user profile and organization using service client
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("organization_id, role")
      .eq("id", userData.user.id)
      .single();

    if (profileError || !profile) {
      return withCors(
        new Response(
          JSON.stringify({
            success: false,
            message: "Profile not found",
          }),
          { status: 404 }
        )
      );
    }

    // Allow admin/partner and agent/partner_agent users to access dashboard stats
    if (!["partner", "admin", "partner_agent", "agent"].includes(profile.role)) {
      return withCors(
        new Response(
          JSON.stringify({
            success: false,
            message: "Admin or Agent access required",
          }),
          { status: 403 }
        )
      );
    }

    const organizationId = profile.organization_id;

    if (!organizationId) {
      return withCors(
        new Response(
          JSON.stringify({
            success: false,
            message: "User has no organization assigned",
          }),
          { status: 403 }
        )
      );
    }

    /*
     * Balance-sheet stove counts: cumulative as of end of selected year.
     *
     * Dated by transfer_sales_date, not created_at. created_at is when the row
     * reached this database, which is a fact about the sync rather than about
     * the stove: a January transfer imported in March counted as March. It
     * happened to agree on today's data, and it is the same column
     * get-super-admin-dashboard counts on, so the partner view and the global
     * view can no longer answer the same question differently.
     *
     * Every stock row on production carries a transfer date, so nothing falls
     * out of the count by switching.
     */
    let stovesReceivedQuery = supabase
      .from("stove_ids")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", organizationId);
    // Undated stock counts, for the same reason as the global view: `lt` alone
    // drops NULLs, and a stove with no transfer date is still held.
    if (endOfYear) {
      stovesReceivedQuery = stovesReceivedQuery.or(
        `transfer_sales_date.lt.${endOfYear},transfer_sales_date.is.null`
      );
    }

    let stovesSoldQuery = supabase
      .from("sales")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("is_archived", false);
    if (endOfYear) stovesSoldQuery = stovesSoldQuery.lt("sales_date", endOfYear);

    const [
      { count: totalStovesReceived, error: stovesReceivedError },
      { count: stovesSoldCumulative, error: stovesSoldError },
    ] = await Promise.all([stovesReceivedQuery, stovesSoldQuery]);

    if (stovesReceivedError) console.error("Error fetching stoves received:", stovesReceivedError);
    if (stovesSoldError) console.error("Error fetching stoves sold:", stovesSoldError);

    const totalStovesSold = stovesSoldCumulative ?? 0;
    const totalStovesAvailable = Math.max(0, (totalStovesReceived ?? 0) - totalStovesSold);

    // Get total sales count for the organization (exclude cancelled)
    const { count: totalSalesCount, error: salesCountError } = await supabase
      .from("sales")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("is_archived", false);

    if (salesCountError) {
      console.error("Error fetching sales count:", salesCountError);
      return withCors(
        new Response(
          JSON.stringify({
            success: false,
            message: "Error fetching sales data",
          }),
          { status: 500 }
        )
      );
    }

    // Get sales agents count for the organization
    const { count: salesAgentsCount, error: agentsCountError } = await supabase
      .from("profiles")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .in("role", ["partner_agent", "agent"]);

    if (agentsCountError) {
      console.error("Error fetching agents count:", agentsCountError);
      return withCors(
        new Response(
          JSON.stringify({
            success: false,
            message: "Error fetching agents data",
          }),
          { status: 500 }
        )
      );
    }

    // Get sales with completed status count
    const { count: completedSalesCount, error: completedCountError } =
      await supabase
        .from("sales")
        .select("*", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .eq("is_archived", false)
        .eq("status", "completed");

    if (completedCountError) {
      console.error(
        "Error fetching completed sales count:",
        completedCountError
      );
    }

    // Get sales with landmarks count (sales that have address with non-null coordinates)
    const { count: salesWithLandmarkCount, error: landmarkCountError } =
      await supabase
        .from("sales")
        .select(
          `
        id,
        address:addresses!inner(
          latitude,
          longitude
        )
      `,
          { count: "exact", head: true }
        )
        .eq("organization_id", organizationId)
        .eq("is_archived", false)
        .not("address.latitude", "is", null)
        .not("address.longitude", "is", null);

    if (landmarkCountError) {
      console.error(
        "Error fetching sales with landmark count:",
        landmarkCountError
      );
    }

    // Get pending sales count (incomplete or pending status)
    const { count: pendingSalesCount, error: pendingCountError } =
      await supabase
        .from("sales")
        .select("*", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .eq("is_archived", false)
        .in("status", ["incomplete", "pending"]);

    if (pendingCountError) {
      console.error("Error fetching pending sales count:", pendingCountError);
    }

    /*
     * Money and breakdowns from one SQL function, over is_archived is not
     * true (the Data Center's predicate) and the same date window. The rows
     * used to be fetched here and summed, and an unranged select stops at
     * 1,000 rows, so a partner past a thousand sales saw a thousand.
     *
     * Two rules change with it, both on purpose. Amount received is what
     * was collected, total_paid, for outright sales too: the rule the Paid
     * badge follows since slice 2. And a sale with no state or no amount is
     * still a sale: it counts under "Unknown" instead of leaving the chart.
     * Production has none of either today, so no figure moves.
     */
    const { data: summary, error: financialError } = await supabase.rpc("dashboard_sales_summary", {
      p_organization_ids: [organizationId],
      p_date_from: dateFrom,
      p_date_to: dateTo,
    });
    if (financialError) console.error("Error fetching sales summary:", financialError);
    const s = (financialError ? null : summary) || {};

    const totalSalesAmount = Number(s.expected_receivable) || 0;
    const totalAmountPaid = Number(s.amount_received) || 0;
    const totalAmountOwed = totalSalesAmount - totalAmountPaid;
    const customersOwing = Number(s.customers_owing) || 0;

    const totalSalesForPct = Number(s.total) || 0;
    const salesModelData = (s.by_model || []).map((r: any) => ({
      model: r.model,
      count: Number(r.count),
      percentage: totalSalesForPct > 0 ? (Number(r.count) / totalSalesForPct) * 100 : 0,
    }));
    const byState = (s.by_state || []).map((r: any) => ({ state: r.state, count: Number(r.count) }));

    // Return dashboard statistics
    const dashboardStats = {
      totalSales: totalSalesCount || 0,
      salesAgents: salesAgentsCount || 0,
      completedSales: completedSalesCount || 0,
      stovesWithLandmark: salesWithLandmarkCount || 0,
      pendingSales: pendingSalesCount || 0,
      totalSalesAmount: totalSalesAmount,
      // Financial summary fields
      totalExpectedAmount: totalSalesAmount,
      totalAmountPaid: totalAmountPaid,
      totalAmountOwed: totalAmountOwed,
      totalCustomers: totalSalesCount || 0,
      customersOwing: customersOwing,
      organizationId: organizationId,
      totalStovesReceived: totalStovesReceived || 0,
      totalStovesSold: totalStovesSold || 0,
      totalStovesAvailable: totalStovesAvailable || 0,
      // Chart data
      byState,
      salesModelData,
    };

    return withCors(
      new Response(
        JSON.stringify({
          success: true,
          data: dashboardStats,
          message: "Dashboard statistics retrieved successfully",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      )
    );
  } catch (error) {
    console.error("Error in get-dashboard-stats:", error);
    return withCors(
      new Response(
        JSON.stringify({
          success: false,
          message: "Internal server error",
        }),
        { status: 500 }
      )
    );
  }
});
