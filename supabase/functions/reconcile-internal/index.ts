import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

/**
 * reconcile-internal
 * --------------------------------------------------------------------------
 * Self-contained data-integrity audit that runs ENTIRELY inside the
 * monitoring app. It needs NO access to the ERP database.
 *
 * It answers three questions by comparing two facts the monitoring DB
 * already holds:
 *
 *   1. "What was sent to me?"   -> union of every stove_id ever recorded in
 *                                  stove_transfer_history.stove_ids (JSONB)
 *   2. "What actually exists?"  -> the stove_ids table as it stands now
 *
 * Buckets returned:
 *   A. sent_but_missing       stove_id present in a transfer batch but NOT in
 *                             the stove_ids table  ->  SILENT INGEST FAILURE
 *   B. orphan_no_transfer     stove_id exists in stove_ids but was never seen
 *                             in any transfer batch ->  arrived pre-logging /
 *                             manual / test data
 *   C. duplicated_in_transfers stove_id that appears in more than one transfer
 *                             batch  ->  re-sends (skipped on ingest)
 *
 * NOTE: This cannot detect stoves the ERP HAS but NEVER SENT — that gap is
 * structurally invisible from the monitoring side and requires an ERP export
 * (see reconcile-erp-csv / external-csv-sync).
 *
 * Auth: super_admin JWT (same pattern as get-transfer-history).
 * --------------------------------------------------------------------------
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

function withCors(response: Response): Response {
  const newHeaders = new Headers(response.headers);
  Object.entries(corsHeaders).forEach(([k, v]) => newHeaders.set(k, v));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: newHeaders });
}

function jsonError(message: string, status: number): Response {
  return withCors(new Response(JSON.stringify({ success: false, message }), { status, headers: { "Content-Type": "application/json" } }));
}

// A transfer batch's stove_ids JSONB may hold strings or {stove_id,...} objects.
function extractStoveId(entry: unknown): string | null {
  if (typeof entry === "string") return entry.trim() || null;
  if (entry && typeof entry === "object" && "stove_id" in entry) {
    const v = (entry as { stove_id?: unknown }).stove_id;
    return typeof v === "string" ? v.trim() || null : null;
  }
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return withCors(new Response("ok", { status: 200 }));

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

  // Optional: cap how many sample IDs we return per bucket (full counts always exact).
  let sampleLimit = 500;
  try {
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      if (typeof body?.sample_limit === "number") sampleLimit = Math.min(Math.max(body.sample_limit, 0), 5000);
    }
  } catch { /* ignore */ }

  const PAGE = 1000;

  // ── 1. Reconstruct "what was sent to me" from stove_transfer_history ──
  // sentTo: stove_id -> Set<transaction_id>  (so we can flag re-sends)
  const sentTo = new Map<string, Set<string>>();
  {
    let offset = 0;
    while (true) {
      const { data, error } = await supabase
        .from("stove_transfer_history")
        .select("transaction_id, stove_ids")
        .order("transfer_date", { ascending: true })
        .range(offset, offset + PAGE - 1);
      if (error) return jsonError(`Failed to read stove_transfer_history: ${error.message}`, 500);
      if (!data || data.length === 0) break;

      for (const row of data) {
        const txn = (row.transaction_id as string) || "(unknown)";
        const ids = Array.isArray(row.stove_ids) ? row.stove_ids : [];
        for (const raw of ids) {
          const sid = extractStoveId(raw);
          if (!sid) continue;
          let set = sentTo.get(sid);
          if (!set) { set = new Set<string>(); sentTo.set(sid, set); }
          set.add(txn);
        }
      }
      if (data.length < PAGE) break;
      offset += PAGE;
    }
  }

  // ── 2. "What actually exists" — the stove_ids table ──
  const existing = new Set<string>();
  {
    let offset = 0;
    while (true) {
      const { data, error } = await supabase
        .from("stove_ids")
        .select("stove_id")
        .order("stove_id", { ascending: true })
        .range(offset, offset + PAGE - 1);
      if (error) return jsonError(`Failed to read stove_ids: ${error.message}`, 500);
      if (!data || data.length === 0) break;
      for (const row of data) {
        const sid = (row.stove_id as string)?.trim();
        if (sid) existing.add(sid);
      }
      if (data.length < PAGE) break;
      offset += PAGE;
    }
  }

  // ── 3. Diff into buckets ──
  const sentButMissing: string[] = [];      // A: bug — sent but never landed
  const duplicatedInTransfers: { stove_id: string; transaction_ids: string[] }[] = []; // C: re-sends

  for (const [sid, txns] of sentTo) {
    if (!existing.has(sid)) sentButMissing.push(sid);
    if (txns.size > 1) duplicatedInTransfers.push({ stove_id: sid, transaction_ids: [...txns] });
  }

  const orphanNoTransfer: string[] = []; // B: exists but never in any transfer batch
  for (const sid of existing) {
    if (!sentTo.has(sid)) orphanNoTransfer.push(sid);
  }

  const report = {
    success: true,
    generated_at: new Date().toISOString(),
    note: "Monitoring-side audit only. Stoves the ERP holds but never transferred are NOT detectable here — use an ERP CSV export for that gap.",
    totals: {
      distinct_stove_ids_sent: sentTo.size,
      distinct_stove_ids_existing: existing.size,
      sent_but_missing: sentButMissing.length,
      orphan_no_transfer: orphanNoTransfer.length,
      duplicated_in_transfers: duplicatedInTransfers.length,
    },
    buckets: {
      // A — the real bug: transfer logged but row never created (silent failure)
      sent_but_missing: {
        count: sentButMissing.length,
        sample: sentButMissing.slice(0, sampleLimit),
        truncated: sentButMissing.length > sampleLimit,
      },
      // B — present but unexplained: manual/test/pre-logging inserts
      orphan_no_transfer: {
        count: orphanNoTransfer.length,
        sample: orphanNoTransfer.slice(0, sampleLimit),
        truncated: orphanNoTransfer.length > sampleLimit,
      },
      // C — re-sends (these were skipped on ingest; not an error, just info)
      duplicated_in_transfers: {
        count: duplicatedInTransfers.length,
        sample: duplicatedInTransfers.slice(0, sampleLimit),
        truncated: duplicatedInTransfers.length > sampleLimit,
      },
    },
  };

  return withCors(new Response(JSON.stringify(report), { status: 200, headers: { "Content-Type": "application/json" } }));
});
