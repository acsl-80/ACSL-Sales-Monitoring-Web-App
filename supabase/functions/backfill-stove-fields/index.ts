import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

/**
 * backfill-stove-fields
 * --------------------------------------------------------------------------
 * Corrects stove_ids_base.{sales_reference, transfer_sales_date, factory}
 * from authoritative ERP data.
 *
 * Accepts the ERP export in EITHER shape per row:
 *   flat:   { stove_id, sales_reference, sales_date, factory }
 *   nested: { stove_id, sales_reference,
 *             sales_orders: { sales_date, factories: { factory_location } } }
 *
 * Body: { rows: any[], overwrite?: boolean, apply?: boolean }
 *   apply=false (default) -> dry run, returns what WOULD change
 *   apply=true            -> performs the update
 *
 * Delegates the actual bulk work to the apply_stove_field_backfill() RPC.
 * Auth: super_admin JWT.
 * --------------------------------------------------------------------------
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function withCors(r: Response): Response {
  const h = new Headers(r.headers);
  Object.entries(corsHeaders).forEach(([k, v]) => h.set(k, v));
  return new Response(r.body, { status: r.status, statusText: r.statusText, headers: h });
}
function jsonError(message: string, status: number): Response {
  return withCors(new Response(JSON.stringify({ success: false, message }), { status, headers: { "Content-Type": "application/json" } }));
}

// Flatten one ERP row into { stove_id, sales_reference, sales_date, factory }.
function normalize(row: any): { stove_id: string; sales_reference: string | null; sales_date: string | null; factory: string | null } | null {
  if (!row || typeof row !== "object") return null;
  const stove_id = row.stove_id ?? row.stoveId ?? row["Stove ID"];
  if (!stove_id) return null;

  const so = row.sales_orders ?? row.sales_order ?? null;
  const sales_date =
    row.sales_date ?? row.transfer_sales_date ?? so?.sales_date ?? null;
  const factory =
    row.factory ?? so?.factories?.factory_location ?? so?.factory ?? row.factory_location ?? null;
  const sales_reference =
    row.sales_reference ?? so?.sales_reference ?? null;

  return {
    stove_id: String(stove_id).trim(),
    sales_reference: sales_reference != null ? String(sales_reference).trim() : null,
    sales_date: sales_date != null ? String(sales_date).slice(0, 10) : null, // keep YYYY-MM-DD
    factory: factory != null ? String(factory).trim() : null,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return withCors(new Response("ok", { status: 200 }));
  if (req.method !== "POST") return jsonError("Method not allowed", 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return jsonError("Missing authorization header", 401);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return jsonError("Invalid or expired token", 401);

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (!profile || profile.role !== "super_admin") {
    return jsonError("Access denied. Super admin role required.", 403);
  }

  const body = await req.json().catch(() => ({}));
  if (!Array.isArray(body?.rows)) return jsonError("Body must include rows: any[]", 400);

  const overwrite = body.overwrite === true;
  const apply = body.apply === true;

  const flat = body.rows.map(normalize).filter(Boolean);
  if (flat.length === 0) return jsonError("No usable rows (need at least a stove_id each).", 422);

  // One bulk RPC call. jsonb handles tens of thousands of small rows fine.
  const { data, error } = await supabase.rpc("apply_stove_field_backfill", {
    rows: flat,
    do_overwrite: overwrite,
    dry_run: !apply,
  });

  if (error) return jsonError(`Backfill RPC failed: ${error.message}`, 500);

  return withCors(new Response(JSON.stringify({ success: true, mode: apply ? "apply" : "dry_run", overwrite, report: data }), {
    status: 200, headers: { "Content-Type": "application/json" },
  }));
});
