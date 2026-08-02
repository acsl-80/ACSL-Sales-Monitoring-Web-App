import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  missingRequiredFields,
  resolveSaleStatus,
  saleStatusInputFromRow,
  type SaleStatus,
} from "../_shared/saleStatus.ts";

/**
 * backfill-sale-status
 * --------------------------------------------------------------------------
 * Recomputes `sales.status` for every existing sale using the current
 * definition in _shared/saleStatus.ts.
 *
 * Why this is needed: status was written once at creation time and never
 * revised (update-sale did not touch it), and the old predicate required a
 * stove image — which the sales form has since made optional. So a large
 * number of rows are stuck at `pending` or `incomplete` despite being complete
 * by the form's own rules.
 *
 * Body: {
 *   apply?:      boolean (default false = DRY RUN, reports counts only)
 *   batch_size?: number  (default 1000, max 5000 — rows fetched per page)
 * }
 *
 * Auth: super_admin JWT.
 * --------------------------------------------------------------------------
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function withCors(response: Response): Response {
  const h = new Headers(response.headers);
  Object.entries(corsHeaders).forEach(([k, v]) => h.set(k, v));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: h,
  });
}

function json(body: unknown, status = 200): Response {
  return withCors(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    })
  );
}

const SELECT = `
  id,
  status,
  transaction_id,
  stove_serial_no,
  sales_date,
  contact_person,
  contact_phone,
  end_user_name,
  phone,
  partner_name,
  amount,
  state_backup,
  lga_backup,
  signature,
  address:addresses!left(full_address)
`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return withCors(new Response("ok", { status: 200 }));
  if (req.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader) return json({ success: false, error: "Missing Authorization header" }, 401);

    // Authenticate as the caller, then verify super admin with service role.
    const anonClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: authError } = await anonClient.auth.getUser();
    if (authError || !userData?.user) return json({ success: false, error: "Unauthorized" }, 401);

    const admin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: profile } = await admin
      .from("profiles")
      .select("role")
      .eq("id", userData.user.id)
      .maybeSingle();
    if (profile?.role !== "super_admin") {
      return json({ success: false, error: "Super admin access required" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const apply = body?.apply === true;
    const batchSize = Math.min(Math.max(1, Number(body?.batch_size) || 1000), 5000);

    // transition key ("pending->completed") -> count
    const transitions: Record<string, number> = {};
    const samples: Array<{
      id: string;
      transaction_id: unknown;
      from: string;
      to: SaleStatus;
      missing: string[];
    }> = [];
    // Every row that would LOSE completed status — always reported in full, so a
    // regression can never hide behind the sample cap.
    const demotions: Array<{ id: string; transaction_id: unknown; to: SaleStatus; missing: string[] }> = [];
    let scanned = 0;
    let changed = 0;
    let updateErrors = 0;

    for (let offset = 0; ; offset += batchSize) {
      const { data, error } = await admin
        .from("sales")
        .select(SELECT)
        .order("created_at", { ascending: true })
        .range(offset, offset + batchSize - 1);

      if (error) return json({ success: false, error: error.message }, 500);
      const rows = data || [];
      if (rows.length === 0) break;

      for (const row of rows) {
        scanned++;
        // The left join arrives as an array on some client versions.
        const address = Array.isArray(row.address) ? row.address[0] : row.address;
        const input = saleStatusInputFromRow({ ...row, address });
        const next = resolveSaleStatus(input);
        const current = row.status ?? "(null)";
        if (next === row.status) continue;

        changed++;
        const missing = missingRequiredFields(input);
        const key = `${current}->${next}`;
        transitions[key] = (transitions[key] || 0) + 1;
        if (samples.length < 25) {
          samples.push({
            id: row.id,
            transaction_id: row.transaction_id,
            from: String(current),
            to: next,
            missing,
          });
        }
        if (current === "completed") {
          demotions.push({
            id: row.id,
            transaction_id: row.transaction_id,
            to: next,
            missing,
          });
        }

        if (apply) {
          const { error: updErr } = await admin
            .from("sales")
            .update({ status: next })
            .eq("id", row.id);
          if (updErr) {
            updateErrors++;
            console.error("Failed to update sale", row.id, updErr.message);
          }
        }
      }

      if (rows.length < batchSize) break;
    }

    return json({
      success: true,
      mode: apply ? "applied" : "dry_run",
      scanned,
      changed,
      unchanged: scanned - changed,
      update_errors: updateErrors,
      transitions,
      demotions,
      samples,
      note: apply
        ? "Statuses written."
        : "No changes written. Re-send with { \"apply\": true } to commit.",
    });
  } catch (e) {
    console.error("backfill-sale-status error:", e);
    return json({ success: false, error: (e as Error).message }, 500);
  }
});
