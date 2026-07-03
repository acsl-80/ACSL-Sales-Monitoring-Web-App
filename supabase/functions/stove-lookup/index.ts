/**
 * stove-lookup — exact stove ID search with role-based visibility
 *
 * Role logic:
 *   super_admin   → sees any stove in the database (including archived)
 *   partner/admin → sees stove only if it belongs to their organization
 *   acsl_agent    → sees stove only if it belongs to one of their assigned orgs
 *   partner_agent → sees stove only if a sale they created has this stove serial no.
 *
 * Returns:
 *   { found: false }  — stove not visible to this user (or does not exist)
 *   { found: true, stove: {...}, sale: {...} | null }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveAssignedOrgIds } from "../_shared/resolveAssignedOrgIds.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const stoveId = url.searchParams.get("stove_id")?.trim();

    if (!stoveId) {
      return respond({ error: "Missing required parameter: stove_id" }, 400);
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return respond({ error: "Unauthorized" }, 401);

    // Service-role client for data queries (bypasses RLS)
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Verify user identity
    const userSupabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: userData, error: authError } = await userSupabase.auth.getUser();
    if (authError || !userData?.user) return respond({ error: "Unauthorized" }, 401);

    const userId = userData.user.id;

    // Fetch caller profile
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, role, organization_id")
      .eq("id", userId)
      .single();

    if (profileError || !profile) return respond({ error: "Unauthorized" }, 401);

    const { role, organization_id: orgId } = profile;

    const allowedRoles = ["super_admin", "partner", "admin", "acsl_agent", "acsl_agent_manager", "super_admin_agent", "partner_agent", "agent"];
    if (!allowedRoles.includes(role)) return respond({ error: "Access denied" }, 403);

    // ── 1. Fetch the stove by exact stove_id (service role → no RLS filter) ──
    const { data: stoveRow, error: stoveError } = await supabase
      .from("stove_ids")
      .select(`
        id,
        stove_id,
        sale_id,
        organization_id,
        status,
        sales_reference,
        is_archived,
        archive_note,
        created_at,
        organizations (
          id,
          partner_name,
          branch,
          state,
          address,
          email,
          contact_person,
          contact_phone
        )
      `)
      .eq("stove_id", stoveId)
      .maybeSingle();

    if (stoveError) {
      console.error("stove query error:", stoveError);
      return respond({ error: "Database error" }, 500);
    }

    // ── 2. Role-based visibility check ───────────────────────────────────────
    if (!stoveRow) {
      // Stove does not exist at all
      return respond({ found: false });
    }

    const stoveOrgId = stoveRow.organization_id;

    if (role === "partner" || role === "admin") {
      // Partner sees stove only if it belongs to their org
      if (stoveOrgId !== orgId) return respond({ found: false });

    } else if (role === "acsl_agent" || role === "acsl_agent_manager" || role === "super_admin_agent") {
      // ACSL agent sees stove only if it belongs to one of their assigned orgs
      const { assignedOrgIds } = await resolveAssignedOrgIds(supabase, userId);
      if (!assignedOrgIds.includes(stoveOrgId)) return respond({ found: false });

    } else if (role === "partner_agent" || role === "agent") {
      // Partner agent sees stove only if a sale they personally created has this serial no.
      const { data: ownSale } = await supabase
        .from("sales")
        .select("id")
        .eq("stove_serial_no", stoveId)
        .eq("created_by", userId)
        .maybeSingle();
      if (!ownSale) return respond({ found: false });
    }
    // super_admin: no restriction — falls through

    // ── 3. Build stove response object ────────────────────────────────────────
    const org = stoveRow.organizations as any;
    const stove = {
      id: stoveRow.id,
      stove_id: stoveRow.stove_id,
      status: stoveRow.status,
      created_at: stoveRow.created_at,
      sales_reference: stoveRow.sales_reference || null,
      is_archived: stoveRow.is_archived || false,
      archive_note: stoveRow.archive_note || null,
      organization_id: stoveOrgId,
      organization_name: org?.partner_name || null,
      branch: org?.branch || null,
      location: org?.state || null,
      address: org?.address || null,
      email: org?.email || null,
      contact_name: org?.contact_person || null,
      contact_phone: org?.contact_phone || null,
    };

    // ── 4. Fetch full sale details if sold ────────────────────────────────────
    let sale = null;
    if (stoveRow.status === "sold") {
      const { data: saleRow } = await supabase
        .from("sales")
        .select(`
          *,
          address:addresses (*),
          stove_image:uploads!sales_stove_image_id_fkey (*),
          agreement_image:uploads!sales_agreement_image_id_fkey (*),
          payment_model:payment_models!left (*)
        `)
        .eq("stove_serial_no", stoveId)
        .maybeSingle();

      if (saleRow) {
        // Attach creator profile
        if (saleRow.created_by) {
          const { data: creator } = await supabase
            .from("profiles")
            .select("id, full_name, email, phone, role")
            .eq("id", saleRow.created_by)
            .maybeSingle();
          saleRow.creator = creator || null;
        }
        sale = saleRow;
      }
    }

    return respond({ found: true, stove, sale });

  } catch (err) {
    console.error("stove-lookup error:", err);
    return respond({ error: err.message || "Internal server error" }, 500);
  }
});
