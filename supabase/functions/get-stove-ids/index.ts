import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

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
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { organization_id, status, limit: rawLimit, offset: rawOffset } = await req.json();

  if (!organization_id) {
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

  const pageLimit = Math.min(parseInt(rawLimit ?? "200"), 500);
  const pageOffset = parseInt(rawOffset ?? "0");

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
    .range(pageOffset, pageOffset + pageLimit - 1)
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
          limit: pageLimit,
          offset: pageOffset,
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
