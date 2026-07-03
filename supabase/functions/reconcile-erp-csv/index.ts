import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

/**
 * reconcile-erp-csv  (DRY RUN — writes nothing)
 * --------------------------------------------------------------------------
 * Closes the one gap reconcile-internal cannot: stoves the ERP HAS but may
 * never have transferred. You can't query the ERP DB, so instead you paste/
 * upload a stove-ID export from the ERP (the ERP already produces these CSVs).
 *
 * Accepts EITHER:
 *   - csv_data: string   (the ERP CSV; stove IDs read from a "Stove IDs"
 *                         column, ';'-separated, matching transfer-sales-to-
 *                         monitoring's output. Falls back to scanning every
 *                         cell for ;-separated tokens if no header match.)
 *   - stove_ids: string[]  (a plain list, if you'd rather extract yourself)
 *
 * Compares the ERP set against the monitoring stove_ids table and returns:
 *   A. in_erp_not_monitoring   ERP has it, monitoring doesn't -> NEVER LANDED
 *                              (re-transfer these from the ERP side)
 *   B. in_monitoring_not_erp   monitoring has it, ERP export doesn't -> orphan
 *                              / test data / export incomplete
 *   C. matched                 present on both (count only)
 *
 * This endpoint NEVER writes. To actually backfill bucket A, the ERP must
 * re-send them (its ingest path is idempotent), or feed the CSV to the
 * existing external-csv-sync function.
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
  const newHeaders = new Headers(response.headers);
  Object.entries(corsHeaders).forEach(([k, v]) => newHeaders.set(k, v));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: newHeaders });
}

function jsonError(message: string, status: number): Response {
  return withCors(new Response(JSON.stringify({ success: false, message }), { status, headers: { "Content-Type": "application/json" } }));
}

// Minimal CSV line splitter that respects double-quoted fields.
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      out.push(cur); cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

// Header labels that hold stove IDs, across the formats we accept:
//   - REST API CSV (Accept: text/csv, select=stove_id) -> "stove_id", one per row
//   - ERP UI export saved as CSV                        -> "Stove ID",  one per row
//   - ERP transfer payload format                       -> "Stove IDs", ';'-separated
const STOVE_HEADERS = new Set([
  "stove ids", "stove_ids", "stoveids",
  "stove id", "stove_id", "stoveid",
]);

// Pull stove IDs out of a CSV string. Tolerates one-per-row and ';'-separated lists.
function stoveIdsFromCsv(csv: string): string[] {
  const lines = csv.split(/\r\n|\r|\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return [];

  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const stoveCol = header.findIndex((h) => STOVE_HEADERS.has(h));
  const singleColumn = header.length === 1;

  const ids = new Set<string>();
  const pushTokens = (cell: string) => {
    for (const tok of cell.split(/[;,]/)) {
      const t = tok.trim();
      if (t) ids.add(t);
    }
  };

  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    if (stoveCol >= 0 && cells[stoveCol] !== undefined) {
      pushTokens(cells[stoveCol]);
    } else if (singleColumn && cells[0] !== undefined) {
      // Single-column file with an unrecognized header — treat every row as an ID.
      pushTokens(cells[0]);
    } else {
      // No recognizable header — scan cells that look like ;-separated id lists.
      for (const cell of cells) {
        if (cell.includes(";")) pushTokens(cell);
      }
    }
  }
  return [...ids];
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
  const sampleLimit = Math.min(Math.max(typeof body?.sample_limit === "number" ? body.sample_limit : 1000, 0), 10000);

  // ── Build the ERP set from csv_data or an explicit stove_ids list ──
  let erpList: string[] = [];
  if (Array.isArray(body?.stove_ids)) {
    erpList = body.stove_ids.map((s: unknown) => String(s ?? "").trim()).filter(Boolean);
  } else if (typeof body?.csv_data === "string" && body.csv_data.trim()) {
    erpList = stoveIdsFromCsv(body.csv_data);
  } else {
    return jsonError("Provide either csv_data (string) or stove_ids (string[])", 400);
  }

  const erpSet = new Set(erpList);
  if (erpSet.size === 0) {
    return jsonError("No stove IDs could be extracted from the input.", 422);
  }

  // ── Load monitoring stove_ids table ──
  const monitoringSet = new Set<string>();
  const PAGE = 1000;
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
      if (sid) monitoringSet.add(sid);
    }
    if (data.length < PAGE) break;
    offset += PAGE;
  }

  // ── Diff ──
  const inErpNotMonitoring: string[] = [];
  let matched = 0;
  for (const sid of erpSet) {
    if (monitoringSet.has(sid)) matched++;
    else inErpNotMonitoring.push(sid);
  }
  const inMonitoringNotErp: string[] = [];
  for (const sid of monitoringSet) {
    if (!erpSet.has(sid)) inMonitoringNotErp.push(sid);
  }

  const report = {
    success: true,
    dry_run: true,
    generated_at: new Date().toISOString(),
    note: "DRY RUN — nothing was written. Re-transfer bucket A from the ERP (its ingest is idempotent) to backfill.",
    totals: {
      erp_distinct: erpSet.size,
      monitoring_distinct: monitoringSet.size,
      matched,
      in_erp_not_monitoring: inErpNotMonitoring.length,
      in_monitoring_not_erp: inMonitoringNotErp.length,
    },
    buckets: {
      // A — ERP has it, you never received it. The core discrepancy.
      in_erp_not_monitoring: {
        count: inErpNotMonitoring.length,
        sample: inErpNotMonitoring.slice(0, sampleLimit),
        truncated: inErpNotMonitoring.length > sampleLimit,
      },
      // B — you have it, ERP export doesn't. Orphan / test / partial export.
      in_monitoring_not_erp: {
        count: inMonitoringNotErp.length,
        sample: inMonitoringNotErp.slice(0, sampleLimit),
        truncated: inMonitoringNotErp.length > sampleLimit,
      },
    },
  };

  return withCors(new Response(JSON.stringify(report), { status: 200, headers: { "Content-Type": "application/json" } }));
});
