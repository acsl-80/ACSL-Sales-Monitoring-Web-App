// Public API endpoint for End User Records.
// Authenticated via a static bearer API key stored as the
// END_USER_RECORDS_API_KEY edge function secret. Reads via service role.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-api-key, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function withCors(res: Response): Response {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(corsHeaders)) h.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

function json(status: number, body: unknown): Response {
  return withCors(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    })
  );
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

function extractBearer(req: Request): string | null {
  const auth = req.headers.get("authorization") || req.headers.get("Authorization");
  if (auth && auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  const xkey = req.headers.get("x-api-key");
  if (xkey) return xkey.trim();
  return null;
}

interface Params {
  page: number;
  limit: number;
  dateFrom?: string;
  dateTo?: string;
  updatedSince?: string;
  state?: string;
  lga?: string;
  partner_id?: string;
  stove_serial_no?: string;
  status?: string[];
  search?: string;
  include_cancelled: boolean;
}

const VALID_STATUSES = ["completed", "pending", "incomplete"];

async function parseParams(req: Request): Promise<Params> {
  const url = new URL(req.url);
  const q = url.searchParams;
  let body: Record<string, unknown> = {};
  if (req.method === "POST") {
    try { body = await req.json(); } catch { body = {}; }
  }
  const get = (k: string): string | undefined => {
    const v = body[k] ?? q.get(k);
    return v == null || v === "" ? undefined : String(v);
  };
  const page = Math.max(1, parseInt(get("page") || "1", 10) || 1);
  const rawLimit = parseInt(get("limit") || "100", 10) || 100;
  const limit = Math.min(Math.max(1, rawLimit), 500);
  const includeCancelledRaw = get("include_cancelled");
  const include_cancelled = includeCancelledRaw === "true" || includeCancelledRaw === "1";

  // status accepts a single value or a comma-separated list; unknown values are
  // dropped so a typo can never silently widen the result set.
  const rawStatus = body["status"] ?? q.get("status");
  const statusList = (Array.isArray(rawStatus) ? rawStatus : String(rawStatus ?? "").split(","))
    .map((s) => String(s).trim().toLowerCase())
    .filter((s) => VALID_STATUSES.includes(s));

  return {
    page,
    limit,
    dateFrom: get("dateFrom") || get("date_from"),
    dateTo: get("dateTo") || get("date_to"),
    updatedSince: get("updatedSince") || get("updated_since"),
    state: get("state"),
    lga: get("lga"),
    partner_id: get("partner_id"),
    stove_serial_no: get("stove_serial_no") || get("stoveSerialNo"),
    status: statusList.length > 0 ? statusList : undefined,
    search: get("search"),
    include_cancelled,
  };
}

const SELECT = `
  id,
  transaction_id,
  sales_date,
  created_at,
  updated_at,
  end_user_name,
  contact_person,
  phone,
  contact_phone,
  other_phone,
  state_backup,
  lga_backup,
  address_id,
  stove_serial_no,
  partner_name,
  amount,
  total_paid,
  payment_status,
  is_installment,
  is_archived,
  status,
  retailer_branch,
  pot_quantity,
  heat_retention_device,
  previous_stove_type,
  previous_stove_other,
  meals_per_day,
  cooking_fuel_source,
  cooking_location,
  organization_id,
  created_by,
  updated_by,
  sold_on_behalf_of,
  stove_image_id,
  agreement_image_id,
  payment_model_id,
  organization:organizations!left(id, partner_name, branch, state, email),
  payment_model:payment_models!left(id, name, duration_months, fixed_price),
  address:addresses!left(id, street, city, state, country, latitude, longitude, full_address),
  stove_image:uploads!stove_image_id(id, public_id, url, type),
  agreement_image:uploads!agreement_image_id(id, public_id, url, type)
`;

async function attachProfiles(admin: any, rows: any[]) {
  const ids = new Set<string>();
  for (const r of rows) {
    for (const k of ["created_by", "updated_by", "sold_on_behalf_of"]) {
      if (r?.[k]) ids.add(r[k]);
    }
  }
  if (ids.size === 0) return;
  const { data } = await admin
    .from("profiles")
    .select("id, full_name, email, phone, role")
    .in("id", Array.from(ids));
  const byId = new Map<string, any>();
  for (const p of data || []) byId.set(p.id, p);
  for (const r of rows) {
    r.created_by_profile = r.created_by ? byId.get(r.created_by) || null : null;
    r.updated_by_profile = r.updated_by ? byId.get(r.updated_by) || null : null;
    r.sales_agent = r.sold_on_behalf_of
      ? byId.get(r.sold_on_behalf_of) || null
      : r.created_by_profile;
  }
}

async function attachPaymentRecords(admin: any, rows: any[]) {
  const ids = rows.map((r) => r.id).filter(Boolean);
  if (ids.length === 0) return;
  const { data } = await admin
    .from("payment_records")
    .select("id, sale_id, amount, payment_date, payment_method, notes, recorded_by, created_at")
    .in("sale_id", ids)
    .order("payment_date", { ascending: true });
  const bySale = new Map<string, any[]>();
  for (const p of data || []) {
    const arr = bySale.get(p.sale_id) || [];
    arr.push(p);
    bySale.set(p.sale_id, arr);
  }
  for (const r of rows) {
    const list = bySale.get(r.id) || [];
    r.payment_records = list;
    const deposit = list[0]?.amount || 0;
    r.deposit = deposit;
    r.balance = Math.max(0, Number(r.amount || 0) - Number(r.total_paid || 0));
  }
}

// `sales_reference` is the ERP's batch reference. It lives on `stove_ids`, not
// on `sales`, so it is looked up by serial and attached here — it is the join
// key back to the ERP sales order.
async function attachStoveMeta(admin: any, rows: any[]) {
  const serials = Array.from(
    new Set(rows.map((r) => r.stove_serial_no).filter(Boolean))
  );
  if (serials.length === 0) return;
  const { data } = await admin
    .from("stove_ids")
    .select("stove_id, sales_reference, factory")
    .in("stove_id", serials);
  const bySerial = new Map<string, any>();
  for (const s of data || []) bySerial.set(s.stove_id, s);
  for (const r of rows) {
    const s = r.stove_serial_no ? bySerial.get(r.stove_serial_no) : null;
    r.sales_reference = s?.sales_reference ?? null;
    r.factory = s?.factory ?? null;
  }
}

// Cancellation is recorded on the `sales` row itself — archiving the sale and
// stamping cancelled_at / cancelled_by / cancel_reason in one update (see
// adminSalesService.cancelSale). There is no separate cancellations table in
// this project; `cancelled_sales` belongs to the ERP.
//
// The metadata columns are fetched separately and tolerantly: cancelSale has a
// fallback path for deployments where they were never added, so a missing
// column must degrade to nulls rather than fail the whole request.
async function attachCancellation(admin: any, rows: any[]) {
  for (const r of rows) {
    r.is_cancelled = Boolean(r.is_archived);
    r.cancellation_reason = null;
    r.cancelled_by = null;
    r.cancelled_at = null;
  }

  const ids = rows.map((r) => r.id).filter(Boolean);
  if (ids.length === 0) return;

  const { data, error } = await admin
    .from("sales")
    .select("id, cancelled_at, cancelled_by, cancel_reason")
    .in("id", ids);
  if (error) {
    console.warn("Cancellation metadata unavailable:", error.message);
    return;
  }

  const bySale = new Map<string, any>();
  for (const c of data || []) bySale.set(c.id, c);
  for (const r of rows) {
    const c = bySale.get(r.id);
    if (!c) continue;
    r.cancellation_reason = c.cancel_reason ?? null;
    r.cancelled_by = c.cancelled_by ?? null;
    r.cancelled_at = c.cancelled_at ?? null;
    // A stamped cancellation counts even if the archive flag was missed.
    if (c.cancelled_at) r.is_cancelled = true;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return withCors(new Response("ok", { status: 200 }));

  // Auth
  const expected = Deno.env.get("END_USER_RECORDS_API_KEY") || "";
  if (!expected) return json(500, { success: false, error: "API key not configured on server" });
  const provided = extractBearer(req);
  if (!provided || !timingSafeEqual(provided, expected)) {
    return json(401, { success: false, error: "Unauthorized" });
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return json(405, { success: false, error: "Method not allowed" });
  }

  try {
    const params = await parseParams(req);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL") || "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""
    );

    let q = admin.from("sales").select(SELECT, { count: "exact" });

    // Cancelling a sale sets is_archived in the same update that stamps the
    // cancellation metadata, so the archive flag is a complete exclusion.
    if (!params.include_cancelled) q = q.eq("is_archived", false);

    if (params.dateFrom) q = q.gte("sales_date", params.dateFrom);
    if (params.dateTo) q = q.lte("sales_date", params.dateTo);
    if (params.updatedSince) q = q.gte("updated_at", params.updatedSince);
    if (params.state) q = q.eq("state_backup", params.state);
    if (params.lga) q = q.eq("lga_backup", params.lga);
    if (params.partner_id) q = q.eq("organization_id", params.partner_id);
    if (params.stove_serial_no) q = q.eq("stove_serial_no", params.stove_serial_no);
    if (params.status) q = q.in("status", params.status);
    if (params.search) {
      const s = params.search.replace(/[(),]/g, " ").trim();
      q = q.or(
        [
          `end_user_name.ilike.%${s}%`,
          `contact_person.ilike.%${s}%`,
          `phone.ilike.%${s}%`,
          `contact_phone.ilike.%${s}%`,
          `stove_serial_no.ilike.%${s}%`,
          `transaction_id.ilike.%${s}%`,
          `partner_name.ilike.%${s}%`,
        ].join(",")
      );
    }

    const offset = (params.page - 1) * params.limit;
    // sales_date is neither unique nor NOT NULL, so it cannot order pages on its
    // own — ties would let rows repeat or vanish between pages mid-sync. `id`
    // breaks the tie deterministically.
    q = q
      .order("sales_date", { ascending: false, nullsFirst: false })
      .order("id", { ascending: true });

    const { data, error, count } = await q.range(offset, offset + params.limit - 1);
    if (error) return json(500, { success: false, error: error.message });

    const rows: any[] = data || [];
    await Promise.all([
      attachProfiles(admin, rows),
      attachPaymentRecords(admin, rows),
      attachCancellation(admin, rows),
      attachStoveMeta(admin, rows),
    ]);

    // Explicit sync gate, so consumers never have to re-derive the rule.
    for (const r of rows) {
      r.is_ready_to_sync = r.status === "completed" && !r.is_cancelled;
    }

    return json(200, {
      success: true,
      pagination: {
        page: params.page,
        limit: params.limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / params.limit),
      },
      data: rows,
    });
  } catch (e) {
    return json(500, { success: false, error: (e as Error).message });
  }
});
