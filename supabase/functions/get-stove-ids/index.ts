import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { callerScope, inScope, ScopeError } from "../_shared/callerScope.ts";

function withCors(res: Response) {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );
  return res;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return withCors(new Response("ok", { status: 200 }));
  }
  // A signed-in, active caller only, and only the organisations in their scope.
  let scope;
  try {
    scope = await callerScope(req);
  } catch (e) {
    const status = e instanceof ScopeError ? e.status : 500;
    return withCors(
      new Response(JSON.stringify({ success: false, message: (e as Error).message }), {
        status,
        headers: { "Content-Type": "application/json" },
      })
    );
  }
  const supabase = scope.serviceClient;

  const {
    organization_id,
    organization_ids,
    status,
    limit: rawLimit,
    offset: rawOffset,
    format: rawFormat,
  } = await req.json();

  // format1 (default) = original single-org behaviour, unchanged, so existing
  // callers keep working without passing anything.
  // format2 = bulk/grouped: returns stoves across MANY orgs in one paginated
  // call (each row carries organization_id so the client can group them), which
  // lets the mobile app cache all orgs in ~34 calls instead of ~900.
  const format = (rawFormat ?? "format1").toString();
  const isBulk = format === "format2";

  if (!isBulk && !organization_id) {
    return withCors(
      new Response(
        JSON.stringify({ success: false, message: "Missing organization_id" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      )
    );
  }

  if (!isBulk && !inScope(scope, organization_id)) {
    return withCors(
      new Response(
        JSON.stringify({ success: false, message: "That organisation is outside your scope" }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      )
    );
  }

  const pageLimit = Math.min(parseInt(rawLimit ?? "200"), 500);
  const pageOffset = parseInt(rawOffset ?? "0");

  // Whether the caller explicitly asked for a page. Older mobile builds fetch a
  // single org's stoves with NO limit/offset and display whatever comes back —
  // so the old 200 default silently capped partners that hold thousands of
  // stoves. When no limit is supplied we now return the org's FULL set in one
  // response (server-side fix, no app update needed). Callers that DO paginate
  // (e.g. the web partners page passes limit+offset) are unaffected.
  const hasExplicitLimit = rawLimit !== undefined && rawLimit !== null;

  // ── format2: bulk stoves across all (or a given set of) organizations ───────
  if (isBulk) {
    // Every organisation for a super admin; otherwise the caller's scope only.
    // A scope short enough for a URL filter is applied here; a larger one (a
    // manager covering hundreds of partners) is left to the stove table's row
    // policy by querying with the caller's own token.
    const requested: string[] | null =
      Array.isArray(organization_ids) && organization_ids.length > 0 ? organization_ids : null;
    let orgFilter: string[] | null = requested;
    let bulkClient = supabase;
    if (scope.orgIds !== null) {
      const allowed = requested ? requested.filter((id) => scope.orgIds!.includes(id)) : scope.orgIds;
      if (allowed.length === 0) {
        return withCors(
          new Response(
            JSON.stringify({
              success: true,
              format: "format2",
              data: [],
              pagination: { limit: pageLimit, offset: pageOffset, total: 0 },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
        );
      }
      if (allowed.length <= 200) {
        orgFilter = allowed;
      } else {
        orgFilter = requested ? allowed : null;
        bulkClient = scope.userClient;
      }
    }

    let bulk = bulkClient
      .from("stove_ids")
      .select("id, stove_id, status, organization_id", { count: "exact" })
      .order("id", { ascending: true })
      .range(pageOffset, pageOffset + pageLimit - 1);
    if (status) bulk = bulk.eq("status", status);
    if (orgFilter) {
      bulk = bulk.in("organization_id", orgFilter);
    }

    const { data: bulkData, error: bulkError, count: bulkCount } = await bulk;
    if (bulkError) {
      return withCors(
        new Response(JSON.stringify({ success: false, message: bulkError.message }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        })
      );
    }

    return withCors(
      new Response(
        JSON.stringify({
          success: true,
          format: "format2",
          data: (bulkData ?? []).map((item: any) => ({
            id: item.id,
            stove_id: item.stove_id,
            status: item.status,
            organization_id: item.organization_id,
          })),
          pagination: {
            limit: pageLimit,
            offset: pageOffset,
            total: bulkCount ?? 0,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
  }

  let query = supabase
    .from("stove_ids")
    .select(
      `
      id,
      stove_id,
      status,
      created_at,
      sale_id,
      sales!left (
        id,
        sales_date,
        created_at
      )
    `
    )
    .eq("organization_id", organization_id)
    // Paginate only when the caller asked for a page. Otherwise return every
    // stove for the org (a wide range beats PostgREST's default 1000-row cap),
    // so old mobile builds that send no limit get the complete set.
    .range(
      hasExplicitLimit ? pageOffset : 0,
      hasExplicitLimit ? pageOffset + pageLimit - 1 : 999999
    )
    .order("stove_id", { ascending: true });

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error } = await query;

  if (error) {
    return withCors(
      new Response(JSON.stringify({ success: false, message: error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      })
    );
  }

  // Transform data to include sale_date from sales relationship
  const transformedData = data?.map((item: any) => ({
    id: item.id,
    stove_id: item.stove_id,
    status: item.status,
    created_at: item.created_at,
    sale_id: item.sale_id,
    sale_date: item.sales?.sales_date || item.sales?.created_at || null,
  }));

  // Get total counts for the organization
  const { count: totalStoveIds, error: countError } = await supabase
    .from("stove_ids")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organization_id);

  const { count: totalStoveAvailable } = await supabase
    .from("stove_ids")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organization_id)
    .eq("status", "available");

  const { count: totalStoveSold } = await supabase
    .from("stove_ids")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organization_id)
    .eq("status", "sold");

  return withCors(
    new Response(
      JSON.stringify({
        success: true,
        data: transformedData,
        pagination: {
          // When no limit was requested we returned everything; report the row
          // count as the effective page size so clients don't assume more pages.
          limit: hasExplicitLimit ? pageLimit : (transformedData?.length ?? 0),
          offset: hasExplicitLimit ? pageOffset : 0,
          total: totalStoveIds ?? 0,
        },
        totals: {
          total_stove_ids: totalStoveIds ?? 0,
          total_stove_available: totalStoveAvailable ?? 0,
          total_stove_sold: totalStoveSold ?? 0,
        },
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    )
  );
});
