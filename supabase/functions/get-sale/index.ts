import { createClient } from "https://esm.sh/@supabase/supabase-js";
function withCors(res) {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );
  return res;
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return withCors(
      new Response("ok", {
        status: 200,
      })
    );
  }
  const url = new URL(req.url);
  const saleId = url.searchParams.get("id");
  const transactionId = url.searchParams.get("transaction_id");
  const stoveSerialNo = url.searchParams.get("stove_serial_no");

  // Validate that at least one parameter is provided
  if (!saleId && !transactionId && !stoveSerialNo) {
    return withCors(
      new Response(
        JSON.stringify({
          success: false,
          message:
            "Missing required parameter: id, transaction_id, or stove_serial_no",
        }),
        {
          status: 400,
        }
      )
    );
  }
  // Auth client — uses user JWT for authentication
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL"),
    Deno.env.get("SUPABASE_ANON_KEY"),
    {
      global: {
        headers: {
          Authorization: req.headers.get("Authorization"),
        },
      },
    }
  );
  // Admin client — uses service role key, bypasses RLS for data queries
  const adminSupabase = createClient(
    Deno.env.get("SUPABASE_URL"),
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  );
  try {
    // Authenticate user
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) {
      return withCors(
        new Response(
          JSON.stringify({
            success: false,
            message: "Unauthorized",
          }),
          {
            status: 401,
          }
        )
      );
    }
    const userId = userData.user.id;
    // Get user profile (including role) — use adminSupabase to bypass RLS
    const { data: profile, error: profileError } = await adminSupabase
      .from("profiles")
      .select("organization_id, role")
      .eq("id", userId)
      .maybeSingle();
    // Roles with system-wide sales visibility (mirror get-sales-advanced):
    // super_admin plus ACSL agent roles can view any sale regardless of org.
    const systemWideRoles = [
      "super_admin",
      "acsl_agent",
      "acsl_agent_manager",
      "super_admin_agent",
    ];
    const hasSystemWideAccess = systemWideRoles.includes(profile?.role);

    if (
      profileError ||
      (!profile?.organization_id && !hasSystemWideAccess)
    ) {
      return withCors(
        new Response(
          JSON.stringify({
            success: false,
            message: "User must belong to an organization or be a super admin",
          }),
          {
            status: 400,
          }
        )
      );
    }
    // Fetch sale with joins — use adminSupabase to bypass RLS on uploads/addresses
    let saleQuery = adminSupabase.from("sales").select(
      `
        *,
        address:addresses (*),
        stove_image:uploads!sales_stove_image_id_fkey (*),
        agreement_image:uploads!sales_agreement_image_id_fkey (*),
        payment_model:payment_models!left (*),
        installment_payments (*)
        `
    );

    // Apply the appropriate filter based on available parameters
    if (saleId) {
      saleQuery = saleQuery.eq("id", saleId);
    } else if (transactionId) {
      saleQuery = saleQuery.eq("transaction_id", transactionId);
    } else if (stoveSerialNo) {
      saleQuery = saleQuery.eq("stove_serial_no", stoveSerialNo);
    }

    // Apply organization filter only for org-scoped users. Roles with system-wide
    // access (super_admin + ACSL agents) can view any sale.
    if (!hasSystemWideAccess) {
      saleQuery = saleQuery.eq("organization_id", profile.organization_id);
    }
    const { data: sale, error: saleError } = await saleQuery.maybeSingle();
    if (saleError || !sale) {
      return withCors(
        new Response(
          JSON.stringify({
            success: false,
            message: "Sale not found or access denied",
            error: saleError,
          }),
          {
            status: 404,
          }
        )
      );
    }

    // Fetch creator profile separately (avoids FK constraint dependency)
    if (sale.created_by) {
      const { data: creator } = await adminSupabase
        .from("profiles")
        .select("id, full_name, email, phone, role")
        .eq("id", sale.created_by)
        .maybeSingle();
      sale.creator = creator || null;
    }

    return withCors(
      new Response(
        JSON.stringify({
          success: true,
          data: sale,
        }),
        {
          status: 200,
        }
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
