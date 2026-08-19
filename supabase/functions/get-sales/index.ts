import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js";
function withCors(res) {
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
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL"),
    Deno.env.get("SUPABASE_ANON_KEY"),
    {
      global: {
        headers: {
          Authorization: req.headers.get("Authorization") || "",
        },
      },
    }
  );
  try {
    const url = new URL(req.url);
    const params = url.searchParams;
    const queryParam = params.get("query") || "";
    const fromDate = params.get("from");
    const toDate = params.get("to");
    const state = params.get("state");
    const lga = params.get("lga");
    const page = parseInt(params.get("page") || "1");
    const limit = parseInt(params.get("limit") || "10");
    const offset = (page - 1) * limit;

    // Authenticate user
    const { data: userData, error: authError } = await supabase.auth.getUser();
    if (authError || !userData?.user) {
      return withCors(
        new Response(
          JSON.stringify({ success: false, message: "Unauthorized" }),
          { status: 401 }
        )
      );
    }
    const userId = userData.user.id;

    // Get organization
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("organization_id")
      .eq("id", userId)
      .maybeSingle();
    if (profileError || !profile?.organization_id) {
      return withCors(
        new Response(
          JSON.stringify({ success: false, message: "No organization found" }),
          { status: 403 }
        )
      );
    }

    // Build query
    let salesQuery = supabase
      .from("sales")
      .select(
        `
        *,
        stove_image_id:stove_image_id (*),
        agreement_image_id:agreement_image_id (*),
        address:address_id (*)
      `,
        { count: "exact" }
      )
      .eq("organization_id", profile.organization_id);

    // Search by transaction_id or stove_serial_no
    if (queryParam) {
      salesQuery = salesQuery.or(
        `transaction_id.ilike.%${queryParam}%,stove_serial_no.ilike.%${queryParam}%`
      );
    }
    if (fromDate) {
      salesQuery = salesQuery.gte("sales_date", fromDate);
    }
    if (toDate) {
      salesQuery = salesQuery.lte("sales_date", toDate);
    }
    if (state) {
      salesQuery = salesQuery.eq("state_backup", state);
    }
    if (lga) {
      salesQuery = salesQuery.eq("lga_backup", lga);
    }

    salesQuery = salesQuery
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    const { data: sales, count, error: queryError } = await salesQuery;

    if (queryError?.code === "PGRST103") {
      return withCors(
        new Response(
          JSON.stringify({
            success: true,
            sales: [],
            pagination: {
              page,
              limit,
              total: 0,
              totalPages: 1,
            },
          }),
          { status: 200 }
        )
      );
    }
    if (queryError) {
      return withCors(
        new Response(
          JSON.stringify({
            success: false,
            message: "Failed to fetch sales",
            error: queryError,
          }),
          { status: 500 }
        )
      );
    }

    return withCors(
      new Response(
        JSON.stringify({
          success: true,
          sales,
          pagination: {
            page,
            limit,
            total: count || 0,
            totalPages: count ? Math.ceil(count / limit) : 1,
          },
        }),
        { status: 200 }
      )
    );
  } catch (err) {
    return withCors(
      new Response(
        JSON.stringify({
          success: false,
          message: "Unexpected error",
          error: err.message,
        }),
        {
          status: 500,
        }
      )
    );
  }
});
