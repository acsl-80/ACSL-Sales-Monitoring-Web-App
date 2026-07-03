import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

/**
 * reconcile-erp-full  (DRY RUN — writes nothing)
 * --------------------------------------------------------------------------
 * Full, automated ERP <-> monitoring reconciliation on ACTUAL stove IDs.
 *
 * Instead of pasting CSVs, this calls the ERP REST API directly (using your
 * ERP login token) and pulls every transferred stove ID for a year together
 * with its sales_reference and sales_date. It then compares that, field by
 * field, against the monitoring stove_ids_base table and returns a complete
 * side-by-side report:
 *
 *   A. missing_in_monitoring   ERP transferred it, monitoring never got it
 *                              -> RE-TRANSFER these from the ERP (idempotent)
 *   B. extra_in_monitoring     monitoring has it (org set) but ERP's transferred
 *                              set for the year doesn't -> phantom / stale / test
 *   C. date_mismatch           transfer_sales_date != ERP sales_date
 *   D. ref_mismatch            sales_reference != ERP sales_reference
 *   E. duplicates_in_monitoring one stove_id with >1 monitoring row
 *   F. matched                 same id, same date, same ref (count only)
 *
 * Body: {
 *   erp_token:   string   (REQUIRED — your ERP access token, Bearer)
 *   year?:       number   (default 2026)
 *   sample_limit?: number (default 2000, max 20000 — rows returned per bucket)
 * }
 *
 * Auth: super_admin JWT (monitoring).
 * Writes nothing. Use the missing_in_monitoring list to re-transfer from ERP.
 * --------------------------------------------------------------------------
 */

const ERP_URL = "https://qcafxvshponbvjfmwvec.supabase.co";
const ERP_ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFjYWZ4dnNocG9uYnZqZm13dmVjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg4NjU4ODYsImV4cCI6MjA2NDQ0MTg4Nn0.76yHHNI58oc2QEpx-kt_FhCTdRGlW-ViXmtAMHmm0oc";

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

function json(body: unknown, status = 200): Response {
  return withCors(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

function jsonError(message: string, status: number): Response {
  return json({ success: false, message }, status);
}

interface ErpRow {
  stove_id: string;
  sales_reference: string;
  sales_orders: { sales_date: string | null; transferred_at: string | null } | null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return withCors(new Response("ok"));
  if (req.method !== "POST") return jsonError("Method not allowed", 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return jsonError("Missing authorization header", 401);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // ── Auth: super_admin only ──
  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return jsonError("Invalid or expired token", 401);
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (!profile || profile.role !== "super_admin") {
    return jsonError("Access denied. Super admin role required.", 403);
  }

  const body = await req.json().catch(() => ({}));
  const erpToken = typeof body?.erp_token === "string" ? body.erp_token.trim() : "";
  if (!erpToken) return jsonError("Provide erp_token (your ERP login access token).", 400);
  const year = Number(body?.year) || 2026;
  const sampleLimit = Math.min(Math.max(typeof body?.sample_limit === "number" ? body.sample_limit : 2000, 0), 20000);

  const yearStart = `${year}-01-01`;
  const yearEnd = `${year + 1}-01-01`;

  // ── 1. Pull the ERP transferred-stoves set (paginated REST) ──
  // Map: stove_id -> { ref, date }. Also track ERP-side duplicate stove_ids.
  const erpMap = new Map<string, { ref: string; date: string | null }>();
  const erpRefsById = new Map<string, string[]>(); // stove_id -> all refs it appears under
  const erpActualPerRef = new Map<string, number>(); // sales_reference -> actual ID count
  {
    const PAGE = 1000;
    let offset = 0;
    const select =
      "stove_id,sales_reference,sales_orders!inner(sales_date,transferred_at)";
    while (true) {
      const url =
        `${ERP_URL}/rest/v1/sold_stove_ids?select=${encodeURIComponent(select)}` +
        `&sales_orders.transferred_at=not.is.null` +
        `&sales_orders.sales_date=gte.${yearStart}` +
        `&sales_orders.sales_date=lt.${yearEnd}` +
        `&order=stove_id.asc&limit=${PAGE}&offset=${offset}`;
      const res = await fetch(url, {
        headers: { apikey: ERP_ANON, Authorization: `Bearer ${erpToken}` },
      });
      if (!res.ok) {
        const txt = await res.text();
        return jsonError(`ERP fetch failed (${res.status}): ${txt.slice(0, 300)}`, 502);
      }
      const rows = (await res.json()) as ErpRow[];
      if (!rows.length) break;
      for (const r of rows) {
        const sid = String(r.stove_id ?? "").trim();
        if (!sid) continue;
        const ref = String(r.sales_reference ?? "").trim();
        erpMap.set(sid, { ref, date: r.sales_orders?.sales_date ?? null });
        erpRefsById.set(sid, [...(erpRefsById.get(sid) ?? []), ref]);
        if (ref) erpActualPerRef.set(ref, (erpActualPerRef.get(ref) ?? 0) + 1);
      }
      if (rows.length < PAGE) break;
      offset += PAGE;
    }
  }

  if (erpMap.size === 0) {
    return jsonError(
      "ERP returned 0 transferred stoves for the year. Check the token is valid (not expired) and the year is correct.",
      422,
    );
  }

  // ── 1b. Pull ERP order DECLARED counts (number_of_stoves) and compare to the
  // actual attached IDs. This explains why the ERP dashboard (which sums the
  // declared field) can exceed the real stove count monitoring can ever hold.
  const declaredVsActual: Array<{ sales_reference: string; declared: number; actual: number; diff: number }> = [];
  let erpDeclaredSum = 0;
  {
    const PAGE = 1000;
    let offset = 0;
    while (true) {
      const url =
        `${ERP_URL}/rest/v1/sales_orders?select=sales_reference,number_of_stoves` +
        `&transferred_at=not.is.null` +
        `&sales_date=gte.${yearStart}&sales_date=lt.${yearEnd}` +
        `&order=sales_reference.asc&limit=${PAGE}&offset=${offset}`;
      const res = await fetch(url, {
        headers: { apikey: ERP_ANON, Authorization: `Bearer ${erpToken}` },
      });
      if (!res.ok) break; // non-fatal: skip this section if it fails
      const rows = (await res.json()) as Array<{ sales_reference: string; number_of_stoves: number }>;
      if (!rows.length) break;
      for (const r of rows) {
        const ref = String(r.sales_reference ?? "").trim();
        const declared = Number(r.number_of_stoves) || 0;
        erpDeclaredSum += declared;
        const actual = erpActualPerRef.get(ref) ?? 0;
        if (declared !== actual) {
          declaredVsActual.push({ sales_reference: ref, declared, actual, diff: declared - actual });
        }
      }
      if (rows.length < PAGE) break;
      offset += PAGE;
    }
  }

  // ── 2. Pull monitoring rows from stove_ids_base (the real table) ──
  // Map: stove_id -> array of rows (to detect duplicates + compare fields).
  interface MonRow { ref: string | null; date: string | null; org: string | null }
  const monMap = new Map<string, MonRow[]>();
  {
    const PAGE = 1000;
    let offset = 0;
    while (true) {
      const { data, error } = await supabase
        .from("stove_ids_base")
        .select("stove_id, sales_reference, transfer_sales_date, organization_id")
        .order("stove_id", { ascending: true })
        .range(offset, offset + PAGE - 1);
      if (error) return jsonError(`Failed to read stove_ids_base: ${error.message}`, 500);
      if (!data || data.length === 0) break;
      for (const row of data) {
        const sid = String(row.stove_id ?? "").trim();
        if (!sid) continue;
        const arr = monMap.get(sid) ?? [];
        arr.push({
          ref: (row.sales_reference as string) ?? null,
          date: (row.transfer_sales_date as string) ?? null,
          org: (row.organization_id as string) ?? null,
        });
        monMap.set(sid, arr);
      }
      if (data.length < PAGE) break;
      offset += PAGE;
    }
  }

  // ── 3. Diff ──
  const missing: Array<{ stove_id: string; erp_ref: string; erp_date: string | null }> = [];
  const dateMismatch: Array<{ stove_id: string; erp_date: string | null; monitoring_date: string | null; ref: string }> = [];
  const refMismatch: Array<{ stove_id: string; erp_ref: string; monitoring_ref: string | null; date: string | null }> = [];
  const duplicates: Array<{ stove_id: string; rows: number; orgs: (string | null)[] }> = [];
  let matched = 0;

  for (const [sid, erp] of erpMap) {
    const monRows = monMap.get(sid);
    if (!monRows || monRows.length === 0) {
      missing.push({ stove_id: sid, erp_ref: erp.ref, erp_date: erp.date });
      continue;
    }
    if (monRows.length > 1) {
      duplicates.push({ stove_id: sid, rows: monRows.length, orgs: monRows.map((r) => r.org) });
    }
    // Compare against the newest/representative row (any row with org set, else first)
    const rep = monRows.find((r) => r.org) ?? monRows[0];
    const dateOk = (rep.date ?? null) === (erp.date ?? null);
    const refOk = (rep.ref ?? "") === (erp.ref ?? "");
    if (!dateOk) dateMismatch.push({ stove_id: sid, erp_date: erp.date, monitoring_date: rep.date, ref: erp.ref });
    if (!refOk) refMismatch.push({ stove_id: sid, erp_ref: erp.ref, monitoring_ref: rep.ref, date: erp.date });
    if (dateOk && refOk) matched++;
  }

  // Extra in monitoring: has org set, not in the ERP transferred set for this year,
  // AND its monitoring date falls in this year (so we compare like-for-like).
  const extra: Array<{ stove_id: string; monitoring_ref: string | null; monitoring_date: string | null }> = [];
  for (const [sid, rows] of monMap) {
    if (erpMap.has(sid)) continue;
    for (const r of rows) {
      if (!r.org) continue;
      if (r.date && r.date >= yearStart && r.date < yearEnd) {
        extra.push({ stove_id: sid, monitoring_ref: r.ref, monitoring_date: r.date });
        break;
      }
    }
  }

  // ERP-side duplicates: a stove ID appearing under >1 sold_stove_ids row.
  // This is the usual cause of "ERP declared > actual distinct" — same physical
  // stove counted twice in the ERP. Includes the refs so it's fixable there.
  const erpDupeList: Array<{ stove_id: string; times: number; refs: string[] }> = [];
  for (const [sid, refs] of erpRefsById) {
    if (refs.length > 1) erpDupeList.push({ stove_id: sid, times: refs.length, refs });
  }

  const cap = <T>(a: T[]) => ({ count: a.length, truncated: a.length > sampleLimit, sample: a.slice(0, sampleLimit) });

  return json({
    success: true,
    dry_run: true,
    year,
    generated_at: new Date().toISOString(),
    totals: {
      erp_transferred_distinct: erpMap.size,
      erp_declared_sum: erpDeclaredSum, // what the ERP dashboard shows
      erp_declared_vs_actual_gap: erpDeclaredSum - erpMap.size,
      erp_duplicate_ids: erpDupeList.length,
      monitoring_distinct: monMap.size,
      matched,
      missing_in_monitoring: missing.length,
      extra_in_monitoring: extra.length,
      date_mismatch: dateMismatch.length,
      ref_mismatch: refMismatch.length,
      duplicates_in_monitoring: duplicates.length,
    },
    buckets: {
      missing_in_monitoring: cap(missing), // A — re-transfer these from ERP
      extra_in_monitoring: cap(extra),     // B — phantom / stale
      date_mismatch: cap(dateMismatch),    // C
      ref_mismatch: cap(refMismatch),      // D
      duplicates_in_monitoring: cap(duplicates), // E
      erp_duplicate_ids: cap(erpDupeList),
      // ERP orders whose declared number_of_stoves != actual attached IDs.
      // diff > 0 means the ERP dashboard over-counts vs real stoves -> fix in ERP.
      erp_declared_vs_actual: cap(declaredVsActual.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))),
    },
    note:
      "DRY RUN — nothing was written. Re-transfer 'missing_in_monitoring' from the ERP (ingest is idempotent). " +
      "'date_mismatch' rows need transfer_sales_date corrected; 'extra'/'duplicates' are candidates for cleanup.",
  });
});
