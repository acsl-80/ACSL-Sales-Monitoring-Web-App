import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withCors } from "./cors.ts";
import { authenticate } from "./authenticate.ts";
import { resolveAssignedOrgIds } from "../_shared/resolveAssignedOrgIds.ts";

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
    const { userId, organizationId } = await authenticate(supabase, authHeader);

    const body = await req.json().catch(() => ({}));
    const status: string | undefined = body.status;
    const pageLimit = Math.min(parseInt(body.limit ?? "500"), 500);
    const pageOffset = parseInt(body.offset ?? "0");

    // Resolve all org IDs this agent manages
    const resolved = await resolveAssignedOrgIds(supabase, userId);
    const orgIds = [
      ...new Set([
        ...resolved.assignedOrgIds,
        ...(organizationId ? [organizationId] : []),
      ]),
    ];

    if (orgIds.length === 0) {
      return withCors(
        new Response(
          JSON.stringify({
            success: true,
            data: [],
            pagination: { limit: pageLimit, offset: pageOffset, total: 0 },
            totals: { total_stove_ids: 0, total_stove_available: 0, total_stove_sold: 0 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );
    }

    // Fetch stove IDs across all assigned orgs
    let dataQuery = supabase
      .from("stove_ids")
      .select(
        `id, stove_id, status, created_at, sale_id, organization_id,
         sales!left (id, sales_date, created_at)`
      )
      .in("organization_id", orgIds)
      .range(pageOffset, pageOffset + pageLimit - 1)
      .order("stove_id", { ascending: true });

    if (status) dataQuery = dataQuery.eq("status", status);

    const { data, error } = await dataQuery;

    if (error) {
      return withCors(
        new Response(JSON.stringify({ success: false, message: error.message }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        })
      );
    }

    const transformedData = (data ?? []).map((item: any) => ({
      id: item.id,
      stove_id: item.stove_id,
      status: item.status,
      created_at: item.created_at,
      sale_id: item.sale_id,
      organization_id: item.organization_id,
      sale_date: item.sales?.sales_date || item.sales?.created_at || null,
    }));

    // Aggregate counts (unfiltered by status for totals)
    const [totalResult, availResult, soldResult] = await Promise.all([
      supabase
        .from("stove_ids")
        .select("id", { count: "exact", head: true })
        .in("organization_id", orgIds),
      supabase
        .from("stove_ids")
        .select("id", { count: "exact", head: true })
        .in("organization_id", orgIds)
        .eq("status", "available"),
      supabase
        .from("stove_ids")
        .select("id", { count: "exact", head: true })
        .in("organization_id", orgIds)
        .eq("status", "sold"),
    ]);

    // Total for pagination uses the status-filtered count when a filter is active
    let paginationTotal = totalResult.count ?? 0;
    if (status === "available") paginationTotal = availResult.count ?? 0;
    if (status === "sold")      paginationTotal = soldResult.count ?? 0;

    return withCors(
      new Response(
        JSON.stringify({
          success: true,
          data: transformedData,
          pagination: { limit: pageLimit, offset: pageOffset, total: paginationTotal },
          totals: {
            total_stove_ids: totalResult.count ?? 0,
            total_stove_available: availResult.count ?? 0,
            total_stove_sold: soldResult.count ?? 0,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
  } catch (error: any) {
    console.error("get-agent-stove-ids error:", error);
    const statusCode = error.message?.includes("Unauthorized") ? 403 : 500;
    return withCors(
      new Response(
        JSON.stringify({ success: false, message: error.message || "Internal server error" }),
        { status: statusCode, headers: { "Content-Type": "application/json" } }
      )
    );
  }
});
