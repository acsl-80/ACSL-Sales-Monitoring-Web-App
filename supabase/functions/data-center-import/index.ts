// Data Center: bulk import of digitalized paper receipts.
//
// THE SHAPE, AND WHY IT IS THIS SHAPE
//
// Committing a receipt backlog moves hundreds of stoves from `available` to
// `sold` and visibly changes the sales app's own inventory figures. That is the
// correct outcome, and it is not something anyone should meet by surprise. So
// the path is four separate, explicit steps rather than an upload button:
//
//   stage      rows land in data_center, raw payload kept
//   validate   each row checked and matched against stock, with a reason
//   dry run    what a commit WOULD change, written down, nothing touched
//   commit     sales created through create-sale, in slices, reversible
//
// A RULE THIS FUNCTION DOES NOT BREAK
//
// It never inserts into public.sales. Every sale is created by calling
// create-sale, the same function the Sell Stove form uses, so stock linking,
// status evaluation, phone validation and org scoping stay in one place. A
// second way to create a sale would be a second version of the truth.
//
// WHY WORK IS SLICED
//
// A batch is thousands of rows and each one is an HTTP call to create-sale. No
// single request does the whole thing: each invocation takes a bounded slice,
// records where it stopped, and returns. The client asks again until the batch
// is done, and a failure resumes rather than restarting.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import {
  withConnection,
  withReadConnection,
  type PoolClient,
} from "../_shared/data-center-db.ts";

const DEFAULT_ORIGINS = [
  "https://sales.atmosfair.com.ng",
  "http://localhost:5173",
  "http://localhost:3000",
  "http://127.0.0.1:5173",
];
const ORIGIN_SUFFIXES = [".vercel.app"];

function originAllowed(origin: string): boolean {
  if (!origin) return true;
  const configured = (Deno.env.get("DATA_CENTER_ALLOWED_ORIGINS") ?? "")
    .split(",").map((o) => o.trim()).filter(Boolean);
  return (
    [...DEFAULT_ORIGINS, ...configured].includes(origin) ||
    ORIGIN_SUFFIXES.some((s) => origin.endsWith(s))
  );
}

function resolveCors(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
  if (originAllowed(origin) && origin) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function json(body: unknown, status: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

class BadRequest extends Error {}

// ---------------------------------------------------------------------------
// Row validation
//
// Every rule here mirrors one create-sale enforces. Checking first is not
// duplication for its own sake: it turns "the 412th row failed" into a list an
// operator can work through before anything is written.
// ---------------------------------------------------------------------------

const NG_PHONE = /^(?:0|\+?234)[7-9][0-1]\d{8}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A transaction ID, in create-sale's own format.
 *
 * The Sell Stove form generates this in the browser: six characters from A-Z
 * and 0-9. create-sale requires one and refuses a duplicate, so the import has
 * to mint them too rather than leave the field out.
 *
 * 36^6 is about 2.2 billion, so a single collision is unlikely but not rare
 * across a real backlog: at 500,000 existing sales each new id has roughly a
 * 0.023% chance of clashing, which is a hundred or so clashes over a full
 * import. Hence the retry at the call site rather than a hope.
 */
const TXN_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
function newTransactionId(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => TXN_ALPHABET[b % TXN_ALPHABET.length]).join("");
}

/** The six consents. create-sale requires every one of them to be true. */
const TERMS_KEYS = [
  "poaGoverned", "monitoring", "noResell",
  "emissionReductions", "noExport", "demonstration",
] as const;

export interface NormalizedRow {
  stoveSerialNo: string;
  salesDate: string;
  endUserName: string;
  phone: string;
  contactPerson: string;
  contactPhone: string;
  amount: number;
  amountReceived: number | null;
  state: string;
  lga: string;
  fullAddress: string;
  aka: string | null;
  otherPhone: string | null;
}

function text(raw: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = raw[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

/**
 * Turn one spreadsheet row into something create-sale would accept, or explain
 * why it cannot be.
 *
 * Returns the reason as a sentence rather than a code. The person reading it is
 * a data clerk with the receipt in front of them, not a developer.
 */
export function normalizeRow(
  raw: Record<string, unknown>,
): { ok: true; row: NormalizedRow } | { ok: false; reason: string } {
  const serial = text(raw, "stove_serial_no", "Stove Serial Number", "serial", "stoveSerialNo");
  if (!serial) return { ok: false, reason: "No stove serial number" };

  const firstName = text(raw, "first_name", "User First Name", "firstName");
  const lastName = text(raw, "last_name", "User Last Name", "surname", "lastName");
  const combined = text(raw, "end_user_name", "endUserName", "name");
  const endUserName = combined || [firstName, lastName].filter(Boolean).join(" ").trim();
  if (!endUserName) return { ok: false, reason: "No end user name" };

  const phone = text(raw, "phone", "Primary Phone Number", "primary_phone", "primaryPhone");
  if (!phone) return { ok: false, reason: "No end user phone number" };
  const cleanedPhone = phone.replace(/[\s-]/g, "");
  if (!NG_PHONE.test(cleanedPhone)) {
    return { ok: false, reason: `Phone number "${phone}" is not a valid Nigerian number` };
  }

  const salesDateRaw = text(raw, "sales_date", "Sales Date", "date", "salesDate");
  if (!salesDateRaw) return { ok: false, reason: "No sale date" };
  // Accept both ISO and the DD/MM/YYYY a spreadsheet usually produces.
  let salesDate = salesDateRaw;
  if (!ISO_DATE.test(salesDate)) {
    const m = salesDate.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (!m) return { ok: false, reason: `Sale date "${salesDateRaw}" is not a date we recognise` };
    salesDate = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  if (Number.isNaN(Date.parse(salesDate))) {
    return { ok: false, reason: `Sale date "${salesDateRaw}" is not a real date` };
  }

  const amountRaw = text(raw, "amount", "Sale Amount", "price", "saleAmount");
  const amount = Number(amountRaw.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, reason: `Sale amount "${amountRaw}" is not a number above zero` };
  }

  const receivedRaw = text(raw, "amount_received", "Amount Received", "amountReceived");
  const amountReceived = receivedRaw === "" ? null : Number(receivedRaw.replace(/[^0-9.]/g, ""));
  if (amountReceived !== null && (!Number.isFinite(amountReceived) || amountReceived < 0)) {
    return { ok: false, reason: `Amount received "${receivedRaw}" is not a number` };
  }
  if (amountReceived !== null && amountReceived > amount) {
    return { ok: false, reason: "Amount received is greater than the sale amount" };
  }

  const state = text(raw, "state", "State", "user_state", "state_backup");
  if (!state) return { ok: false, reason: "No state" };
  const lga = text(raw, "lga", "LGA", "Local Govt Area", "lga_backup");
  if (!lga) return { ok: false, reason: "No local government area" };

  const fullAddress = text(raw, "address", "User Residential Address", "full_address", "fullAddress");
  if (!fullAddress) return { ok: false, reason: "No residential address" };

  // The buyer defaults to the end user, which is what a receipt with one name
  // on it means.
  const contactPerson = text(raw, "contact_person", "Contact Person", "buyer") || endUserName;
  const contactPhoneRaw = text(raw, "contact_phone", "Contact Phone", "buyer_phone") || cleanedPhone;
  const contactPhone = contactPhoneRaw.replace(/[\s-]/g, "");
  if (!NG_PHONE.test(contactPhone)) {
    return { ok: false, reason: `Contact phone "${contactPhoneRaw}" is not a valid Nigerian number` };
  }

  const otherPhoneRaw = text(raw, "other_phone", "Alternative Phone Number", "alt_phone");
  const otherPhone = otherPhoneRaw ? otherPhoneRaw.replace(/[\s-]/g, "") : null;

  return {
    ok: true,
    row: {
      stoveSerialNo: serial.toUpperCase(),
      salesDate,
      endUserName,
      phone: cleanedPhone,
      contactPerson,
      contactPhone,
      amount,
      amountReceived,
      state,
      lga,
      fullAddress,
      aka: text(raw, "aka", "AKA", "nickname") || null,
      otherPhone,
    },
  };
}

// ---------------------------------------------------------------------------

async function readConfig(conn: PoolClient, key: string, fallback: unknown) {
  const r = await conn.queryObject<{ value: unknown }>({
    text: "select value from data_center.workflow_config where key = $1",
    args: [key],
  });
  return r.rows[0]?.value ?? fallback;
}

serve(async (req) => {
  const cors = resolveCors(req);
  const requestOrigin = req.headers.get("Origin") ?? "";
  if (!originAllowed(requestOrigin)) {
    return json({ error: "Origin not permitted", code: "bad_origin" }, 403, cors);
  }
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") {
    return json({ error: "Method not allowed", code: "method_not_allowed" }, 405, cors);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Missing authorization header", code: "no_token" }, 401, cors);
    }
    const token = authHeader.slice("Bearer ".length);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );
    const { data: auth, error: authError } = await supabase.auth.getUser(token);
    if (authError || !auth?.user) {
      return json({ error: "Unauthorized", code: "invalid_token" }, 401, cors);
    }
    const userId = auth.user.id;

    const { data: profile } = await supabase
      .from("profiles").select("role, organization_id").eq("id", userId).single();
    if (!profile) {
      return json({ error: "No profile for this user", code: "no_profile" }, 403, cors);
    }
    const superAdmin = profile.role === "super_admin";

    let body: { action?: string; [key: string]: unknown } = {};
    try {
      body = await req.json();
    } catch {
      return json({ error: "Body must be JSON", code: "bad_body" }, 400, cors);
    }

    // Two separate grants, deliberately. Uploading and validating is clerical;
    // committing changes live inventory. import.commit is never implied by an
    // access level and has to be granted on its own.
    const features = superAdmin ? null : await withReadConnection(async (conn) => {
      const r = await conn.queryObject<{ access_role: string | null; keys: string[] | null }>({
        text: `select
                 (select access_role from data_center.module_access where user_id = $1) as access_role,
                 (select coalesce(array_agg(feature_key), '{}')
                    from data_center.feature_grants where user_id = $1) as keys`,
        args: [userId],
      });
      const accessRole = r.rows[0]?.access_role ?? null;
      if (!accessRole) return null;
      const roleFeatures: Record<string, string[]> = {
        viewer: ["records.view", "call_records.view", "dashboard.view"],
        editor: [
          "records.view", "call_records.view", "dashboard.view",
          "call_records.edit", "import.upload", "import.exceptions",
        ],
      };
      return [...new Set([...(roleFeatures[accessRole] ?? []), ...(r.rows[0]?.keys ?? [])])];
    });

    if (!superAdmin && features === null) {
      return json({ error: "No Data Center access", code: "no_access" }, 403, cors);
    }
    const can = (key: string) => superAdmin || (features ?? []).includes(key);

    const requireFeature = (key: string) => {
      if (!can(key)) throw new BadRequest(`This needs the ${key} permission`);
    };

    switch (body.action) {
      /**
       * Stage a parsed file. The client does the CSV parsing, so an unreadable
       * file is a problem the operator sees immediately rather than a batch
       * that fails server-side minutes later.
       */
      case "stage": {
        requireFeature("import.upload");
        const rows = body.rows as Record<string, unknown>[] | undefined;
        const organizationId = String(body.organizationId ?? "");
        if (!Array.isArray(rows) || rows.length === 0) throw new BadRequest("No rows to import");
        if (rows.length > 20_000) throw new BadRequest("That file has more than 20,000 rows. Split it.");
        if (!organizationId) throw new BadRequest("Choose which partner this batch belongs to");

        return await withConnection(async (conn) => {
          await conn.queryObject("begin");
          try {
            await conn.queryObject({
              text: "select set_config('data_center.actor', $1, true)",
              args: [userId],
            });
            const batch = await conn.queryObject<{ id: string }>({
              text: `insert into data_center.import_batches
                       (source, filename, uploaded_by, organization_id, total_rows, state)
                     values ('receipt', $1, $2, $3, $4, 'staged') returning id`,
              args: [body.filename ?? null, userId, organizationId, rows.length],
            });
            const batchId = batch.rows[0].id;

            // One statement for the whole file. Row by row would be thousands
            // of round trips for a file an operator is watching.
            await conn.queryObject({
              text: `insert into data_center.import_rows (batch_id, row_number, raw)
                     select $1, ordinality, value
                     from jsonb_array_elements($2::jsonb) with ordinality`,
              args: [batchId, JSON.stringify(rows)],
            });
            await conn.queryObject("commit");
            return json({ data: { batchId, totalRows: rows.length } }, 200, cors);
          } catch (err) {
            await conn.queryObject("rollback");
            throw err;
          }
        });
      }

      /**
       * Validate every staged row and match it against stock.
       *
       * A serial that does not match becomes an EXCEPTION, not a rejection.
       * Roughly 8% of real serials miss, including malformed ones like `10110`
       * against a nine digit norm, and a human with the receipt can usually
       * fix them. Treating that as failure would throw away one row in twelve.
       */
      case "validate": {
        requireFeature("import.upload");
        const batchId = String(body.batchId ?? "");
        if (!batchId) throw new BadRequest("batchId is required");

        return await withConnection(async (conn) => {
          await conn.queryObject("begin");
          try {
            await conn.queryObject({
              text: "select set_config('data_center.actor', $1, true)",
              args: [userId],
            });
            const batchRow = await conn.queryObject<{ organization_id: string }>({
              text: "select organization_id from data_center.import_batches where id = $1 for update",
              args: [batchId],
            });
            if (batchRow.rows.length === 0) throw new BadRequest("No such batch");
            const orgId = batchRow.rows[0].organization_id;

            const pending = await conn.queryObject<{ id: string; raw: Record<string, unknown> }>({
              text: `select id, raw from data_center.import_rows
                     where batch_id = $1 and status in ('pending','valid','rejected','exception')
                     order by row_number`,
              args: [batchId],
            });

            // Shape each row first, then ask the database once which of the
            // serials exist. One query for the whole batch rather than one per
            // row, which at 20,000 rows is the difference between seconds and
            // an afternoon.
            const shaped = pending.rows.map((r) => ({ id: r.id, result: normalizeRow(r.raw) }));
            const serials = shaped
              .filter((s) => s.result.ok)
              .map((s) => (s.result as { ok: true; row: NormalizedRow }).row.stoveSerialNo);

            const stock = await conn.queryObject<{ stove_id: string; status: string; organization_id: string }>({
              text: `select stove_id, status, organization_id from public.stove_ids_base
                     where upper(stove_id) = any($1::text[])`,
              args: [[...new Set(serials)]],
            });
            const byStoveId = new Map(stock.rows.map((s) => [s.stove_id.toUpperCase(), s]));

            let valid = 0, rejected = 0, exception = 0;
            for (const s of shaped) {
              if (!s.result.ok) {
                rejected++;
                await conn.queryObject({
                  text: `update data_center.import_rows
                         set status = 'rejected', rejection_reason = $2, exception_reason = null,
                             normalized = null
                         where id = $1`,
                  args: [s.id, s.result.reason],
                });
                continue;
              }
              const row = s.result.row;
              const found = byStoveId.get(row.stoveSerialNo);

              let exceptionReason: string | null = null;
              if (!found) {
                exceptionReason = `Stove serial "${row.stoveSerialNo}" is not in stock records`;
              } else if (found.organization_id !== orgId) {
                exceptionReason = `Stove serial "${row.stoveSerialNo}" belongs to a different partner`;
              } else if (found.status === "sold") {
                exceptionReason = `Stove serial "${row.stoveSerialNo}" is already recorded as sold`;
              }

              if (exceptionReason) {
                exception++;
                await conn.queryObject({
                  text: `update data_center.import_rows
                         set status = 'exception', exception_reason = $2, rejection_reason = null,
                             stove_serial_no = $3, normalized = $4::jsonb
                         where id = $1`,
                  args: [s.id, exceptionReason, row.stoveSerialNo, JSON.stringify(row)],
                });
              } else {
                valid++;
                // Carry the serial exactly as stock spells it, not as the
                // operator typed it or as this function upper-cased it for
                // matching. create-sale compares case-sensitively, so a row
                // that validated on `SA000000A0` would be refused at commit for
                // a stove recorded as `SA000000a0`.
                const canonical = { ...row, stoveSerialNo: found!.stove_id };
                await conn.queryObject({
                  text: `update data_center.import_rows
                         set status = 'valid', rejection_reason = null, exception_reason = null,
                             stove_serial_no = $2, normalized = $3::jsonb
                         where id = $1`,
                  args: [s.id, found!.stove_id, JSON.stringify(canonical)],
                });
              }
            }

            await conn.queryObject({
              text: `update data_center.import_batches
                     set state = 'validated', valid_rows = $2, rejected_rows = $3
                     where id = $1`,
              args: [batchId, valid, rejected + exception],
            });
            await conn.queryObject("commit");
            return json({ data: { valid, rejected, exception } }, 200, cors);
          } catch (err) {
            await conn.queryObject("rollback");
            throw err;
          }
        });
      }

      /**
       * What a commit would change, written down and nothing touched.
       *
       * The stove list is the point: these are the serials that would move from
       * available to sold, which is the change people will notice in the sales
       * app's own inventory.
       */
      case "dry_run": {
        requireFeature("import.upload");
        const batchId = String(body.batchId ?? "");
        if (!batchId) throw new BadRequest("batchId is required");

        return await withConnection(async (conn) => {
          const counts = await conn.queryObject<{ status: string; n: number }>({
            text: `select status, count(*)::int n from data_center.import_rows
                   where batch_id = $1 group by status`,
            args: [batchId],
          });
          const stoves = await conn.queryObject<{ stove_serial_no: string }>({
            text: `select stove_serial_no from data_center.import_rows
                   where batch_id = $1 and status = 'valid' order by row_number limit 500`,
            args: [batchId],
          });
          const summary = {
            byStatus: Object.fromEntries(counts.rows.map((c) => [c.status, c.n])),
            stovesThatWouldSell: stoves.rows.map((s) => s.stove_serial_no),
            note: "Committing marks each of these stoves sold and creates a sale for it. Nothing has changed yet.",
          };
          await conn.queryObject({
            text: `update data_center.import_batches
                   set state = case when state = 'validated' then 'dry_run' else state end,
                       dry_run_at = now(), dry_run_summary = $2::jsonb
                   where id = $1`,
            args: [batchId, JSON.stringify(summary)],
          });
          return json({ data: summary }, 200, cors);
        });
      }

      /**
       * Commit one slice.
       *
       * Each row is claimed, then created through create-sale, then recorded.
       * The claim is taken first and separately: if create-sale fails, the
       * claim is released rather than leaving a stove nobody can import.
       */
      case "commit": {
        requireFeature("import.commit");
        const batchId = String(body.batchId ?? "");
        if (!batchId) throw new BadRequest("batchId is required");

        const sliceSize = Number(
          await withReadConnection((c) => readConfig(c, "import.slice_size", 25)),
        ) || 25;

        const slice = await withReadConnection(async (conn) => {
          const r = await conn.queryObject<{
            id: string; stove_serial_no: string; normalized: NormalizedRow;
          }>({
            text: `select id, stove_serial_no, normalized from data_center.import_rows
                   where batch_id = $1 and status = 'valid'
                   order by row_number limit $2`,
            args: [batchId, sliceSize],
          });
          return r.rows;
        });

        if (slice.length === 0) {
          await withConnection(async (conn) => {
            await conn.queryObject({
              text: `update data_center.import_batches
                     set state = 'committed', committed_at = now(), committed_by = $2
                     where id = $1 and state <> 'committed'`,
              args: [batchId, userId],
            });
          });
          return json({ data: { done: true, committed: 0 } }, 200, cors);
        }

        // create-sale requires partnerName as well as organizationId, so both
        // come from one lookup rather than the name being guessed from the file.
        const org = await withReadConnection(async (conn) => {
          const r = await conn.queryObject<{ organization_id: string; partner_name: string }>({
            text: `select b.organization_id, o.partner_name
                   from data_center.import_batches b
                   left join public.organizations o on o.id = b.organization_id
                   where b.id = $1`,
            args: [batchId],
          });
          return r.rows[0] ?? null;
        });
        if (!org?.organization_id) throw new BadRequest("This batch has no partner");

        let committed = 0;
        const failures: { rowId: string; reason: string }[] = [];

        for (const row of slice) {
          // Claim first. The primary key is the lock: a second batch asking for
          // the same serial gets a conflict here rather than a duplicate sale.
          const claimed = await withConnection(async (conn) => {
            const r = await conn.queryObject({
              text: `insert into data_center.import_claims (stove_serial_no, batch_id, row_id, claimed_by)
                     values ($1, $2, $3, $4)
                     on conflict (stove_serial_no) do nothing
                     returning stove_serial_no`,
              args: [row.stove_serial_no, batchId, row.id, userId],
            });
            return r.rows.length > 0;
          });

          if (!claimed) {
            failures.push({ rowId: row.id, reason: "Another import is already committing this stove" });
            await withConnection(async (conn) => {
              await conn.queryObject({
                text: `update data_center.import_rows
                       set status = 'exception', exception_reason = $2 where id = $1`,
                args: [row.id, "Another import is already committing this stove"],
              });
            });
            continue;
          }

          // Through create-sale, never around it. The caller's own token is
          // forwarded so the sale is attributed to them and org scoping is
          // enforced by the same code the Sell Stove form goes through.
          // create-sale's own field names, not this module's. Anything it does
          // not name is omitted rather than guessed: a receipt does not carry a
          // payment model, a drawn signature or an uploaded photo, and
          // create-sale requires none of them.
          const n = row.normalized;
          const payload = {
            stoveSerialNo: n.stoveSerialNo,
            salesDate: n.salesDate,
            endUserName: n.endUserName,
            aka: n.aka,
            phone: n.phone,
            otherPhone: n.otherPhone,
            contactPerson: n.contactPerson,
            contactPhone: n.contactPhone,
            amount: n.amount,
            amountReceived: n.amountReceived,
            stateBackup: n.state,
            lgaBackup: n.lga,
            addressData: { fullAddress: n.fullAddress, state: n.state, city: n.lga },
            organizationId: org.organization_id,
            partnerName: org.partner_name,
            // The six consents. A digitalized receipt asserts they were
            // accepted on paper, which is what the paper agreement is. See
            // workflow_config `import.require_paper_agreement`.
            termsAccepted: Object.fromEntries(TERMS_KEYS.map((k) => [k, true])),
          };

          let saleId: string | null = null;
          let reason = "";
          // Three attempts, but only for a transaction ID collision. Any other
          // refusal is a fact about the row and retrying would just produce the
          // same answer more slowly.
          for (let attempt = 0; attempt < 3 && !saleId; attempt++) {
            try {
              const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/create-sale`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: authHeader,
                  apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
                },
                body: JSON.stringify({ ...payload, transactionId: newTransactionId() }),
              });
              const out = await res.json().catch(() => ({}));
              // create-sale answers { success, sale_id, data: { id } }.
              const created = out?.data?.id ?? out?.sale_id ?? out?.saleId ?? null;
              if (res.ok && created) {
                saleId = created;
                break;
              }
              reason = out?.message ?? out?.error ?? `create-sale refused this row (${res.status})`;
              if (!/transaction id/i.test(reason)) break;
            } catch (err) {
              reason = `create-sale could not be reached: ${err instanceof Error ? err.message : "unknown"}`;
              break;
            }
          }

          await withConnection(async (conn) => {
            await conn.queryObject("begin");
            try {
              await conn.queryObject({
                text: "select set_config('data_center.actor', $1, true)",
                args: [userId],
              });
              if (saleId) {
                await conn.queryObject({
                  text: `update data_center.import_rows
                         set status = 'committed', sale_id = $2, resolved_by = $3, resolved_at = now()
                         where id = $1`,
                  args: [row.id, saleId, userId],
                });
                await conn.queryObject({
                  text: "update data_center.import_claims set sale_id = $2 where row_id = $1",
                  args: [row.id, saleId],
                });
              } else {
                // Release the claim: the sale did not happen, so nothing should
                // be holding the stove.
                await conn.queryObject({
                  text: "delete from data_center.import_claims where row_id = $1",
                  args: [row.id],
                });
                await conn.queryObject({
                  text: `update data_center.import_rows
                         set status = 'exception', exception_reason = $2 where id = $1`,
                  args: [row.id, reason],
                });
              }
              await conn.queryObject("commit");
            } catch (err) {
              await conn.queryObject("rollback");
              throw err;
            }
          });

          if (saleId) committed++;
          else failures.push({ rowId: row.id, reason });
        }

        const remaining = await withConnection(async (conn) => {
          const r = await conn.queryObject<{ n: number }>({
            text: `select count(*)::int n from data_center.import_rows
                   where batch_id = $1 and status = 'valid'`,
            args: [batchId],
          });
          const left = r.rows[0]?.n ?? 0;
          await conn.queryObject({
            text: `update data_center.import_batches
                   set committed_rows = (select count(*) from data_center.import_rows
                                          where batch_id = $1 and status = 'committed'),
                       state = case when $2 = 0 then 'committed' else 'validated' end,
                       committed_at = case when $2 = 0 then now() else committed_at end,
                       committed_by = case when $2 = 0 then $3 else committed_by end,
                       last_error = $4
                   where id = $1`,
            args: [batchId, left, userId, failures.length ? failures[0].reason : null],
          });
          return left;
        });

        return json(
          { data: { committed, failed: failures.length, remaining, done: remaining === 0, failures } },
          200,
          cors,
        );
      }

      /**
       * Put a committed batch back.
       *
       * Each sale is removed through delete-sale, which releases the stove to
       * available as part of its own job. Deleting rows here instead would
       * leave stock believing stoves were still sold.
       */
      case "rollback": {
        requireFeature("import.commit");
        const batchId = String(body.batchId ?? "");
        if (!batchId) throw new BadRequest("batchId is required");

        const sliceSize = Number(
          await withReadConnection((c) => readConfig(c, "import.slice_size", 25)),
        ) || 25;

        const slice = await withReadConnection(async (conn) => {
          const r = await conn.queryObject<{ id: string; sale_id: string }>({
            text: `select id, sale_id from data_center.import_rows
                   where batch_id = $1 and status = 'committed' and sale_id is not null
                   order by row_number limit $2`,
            args: [batchId, sliceSize],
          });
          return r.rows;
        });

        let reversed = 0;
        for (const row of slice) {
          let ok = false;
          try {
            const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/delete-sale`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: authHeader,
                apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
              },
              body: JSON.stringify({ saleId: row.sale_id }),
            });
            ok = res.ok;
          } catch {
            ok = false;
          }
          if (!ok) continue;

          await withConnection(async (conn) => {
            await conn.queryObject("begin");
            try {
              await conn.queryObject({
                text: "select set_config('data_center.actor', $1, true)",
                args: [userId],
              });
              await conn.queryObject({
                text: `update data_center.import_rows
                       set status = 'valid', sale_id = null where id = $1`,
                args: [row.id],
              });
              await conn.queryObject({
                text: "delete from data_center.import_claims where row_id = $1",
                args: [row.id],
              });
              await conn.queryObject("commit");
            } catch (err) {
              await conn.queryObject("rollback");
              throw err;
            }
          });
          reversed++;
        }

        const remaining = await withConnection(async (conn) => {
          const r = await conn.queryObject<{ n: number }>({
            text: `select count(*)::int n from data_center.import_rows
                   where batch_id = $1 and status = 'committed'`,
            args: [batchId],
          });
          const left = r.rows[0]?.n ?? 0;
          if (left === 0) {
            await conn.queryObject({
              text: `update data_center.import_batches
                     set state = 'rolled_back', committed_rows = 0 where id = $1`,
              args: [batchId],
            });
            await conn.queryObject({
              text: "select data_center.release_import_claims($1)",
              args: [batchId],
            });
          }
          return left;
        });

        return json({ data: { reversed, remaining, done: remaining === 0 } }, 200, cors);
      }

      /** Fix the serial on an exception row and put it back in the queue. */
      case "resolve_exception": {
        requireFeature("import.exceptions");
        const rowId = String(body.rowId ?? "");
        const serial = String(body.correctedSerial ?? "").trim().toUpperCase();
        if (!rowId) throw new BadRequest("rowId is required");
        if (!serial) throw new BadRequest("A corrected stove serial is required");

        return await withConnection(async (conn) => {
          await conn.queryObject("begin");
          try {
            await conn.queryObject({
              text: "select set_config('data_center.actor', $1, true)",
              args: [userId],
            });
            const r = await conn.queryObject<{ batch_id: string; normalized: NormalizedRow }>({
              text: "select batch_id, normalized from data_center.import_rows where id = $1 for update",
              args: [rowId],
            });
            if (r.rows.length === 0) throw new BadRequest("No such row");

            const orgRow = await conn.queryObject<{ organization_id: string }>({
              text: "select organization_id from data_center.import_batches where id = $1",
              args: [r.rows[0].batch_id],
            });
            const stock = await conn.queryObject<{ stove_id: string; status: string; organization_id: string }>({
              text: `select stove_id, status, organization_id from public.stove_ids_base
                     where upper(stove_id) = $1`,
              args: [serial],
            });

            // The same checks validate applies. A correction that does not
            // resolve the problem stays an exception with the new reason,
            // rather than becoming valid and failing later at commit.
            let reason: string | null = null;
            if (stock.rows.length === 0) reason = `Stove serial "${serial}" is not in stock records`;
            else if (stock.rows[0].organization_id !== orgRow.rows[0]?.organization_id) {
              reason = `Stove serial "${serial}" belongs to a different partner`;
            } else if (stock.rows[0].status === "sold") {
              reason = `Stove serial "${serial}" is already recorded as sold`;
            }

            // Same rule as validate: downstream carries stock's own spelling.
            const canonicalSerial = stock.rows[0]?.stove_id ?? serial;
            const normalized = { ...(r.rows[0].normalized ?? {}), stoveSerialNo: canonicalSerial };
            await conn.queryObject({
              text: `update data_center.import_rows
                     set corrected_serial = $2,
                         stove_serial_no = $2,
                         normalized = $3::jsonb,
                         status = case when $4::text is null then 'valid' else 'exception' end,
                         exception_reason = $4,
                         resolved_by = $5, resolved_at = now()
                     where id = $1`,
              args: [rowId, canonicalSerial, JSON.stringify(normalized), reason, userId],
            });

            // Recount rather than adjust. Resolving an exception moves a row
            // between buckets, and a counter nudged by hand drifts the moment
            // anything else touches the batch.
            await conn.queryObject({
              text: `update data_center.import_batches b
                     set valid_rows    = (select count(*) from data_center.import_rows r
                                           where r.batch_id = b.id and r.status = 'valid'),
                         rejected_rows = (select count(*) from data_center.import_rows r
                                           where r.batch_id = b.id and r.status in ('rejected','exception'))
                     where b.id = $1`,
              args: [r.rows[0].batch_id],
            });
            await conn.queryObject("commit");
            return json({ data: { rowId, resolved: reason === null, reason } }, 200, cors);
          } catch (err) {
            await conn.queryObject("rollback");
            throw err;
          }
        });
      }

      /**
       * Which partners this caller may import for.
       *
       * Scoped, not the whole list: create-sale will refuse an org the caller
       * is not assigned to anyway, and offering one that will be refused is a
       * worse experience than not offering it.
       */
      case "partners": {
        requireFeature("import.upload");
        return await withReadConnection(async (conn) => {
          if (superAdmin) {
            const r = await conn.queryObject({
              text: `select id, partner_name from public.organizations
                     order by partner_name limit 500`,
            });
            return json({ data: r.rows }, 200, cors);
          }
          // Everyone else sees their own organization, plus anything assigned
          // to them as an ACSL agent.
          const r = await conn.queryObject({
            text: `select o.id, o.partner_name from public.organizations o
                   where o.id = $2
                      or o.id in (select organization_id from public.acsl_agent_organizations
                                   where agent_id = $1)
                   order by o.partner_name limit 500`,
            args: [userId, profile.organization_id ?? null],
          });
          return json({ data: r.rows }, 200, cors);
        });
      }

      case "batches": {
        requireFeature("import.upload");
        return await withReadConnection(async (conn) => {
          const r = await conn.queryObject({
            text: `select b.id, b.filename, b.state, b.total_rows, b.valid_rows,
                          b.rejected_rows, b.committed_rows, b.uploaded_at, b.dry_run_at,
                          b.committed_at, b.last_error,
                          o.partner_name, p.full_name as uploaded_by_name,
                          (select count(*)::int from data_center.import_rows r
                            where r.batch_id = b.id and r.status = 'exception') as exception_rows
                   from data_center.import_batches b
                   left join public.organizations o on o.id = b.organization_id
                   left join public.profiles p on p.id = b.uploaded_by
                   order by b.uploaded_at desc limit 50`,
          });
          return json({ data: r.rows }, 200, cors);
        });
      }

      case "rows": {
        requireFeature("import.upload");
        const batchId = String(body.batchId ?? "");
        const status = String(body.status ?? "");
        if (!batchId) throw new BadRequest("batchId is required");
        return await withReadConnection(async (conn) => {
          const r = await conn.queryObject({
            text: `select id, row_number, status, rejection_reason, exception_reason,
                          stove_serial_no, corrected_serial, sale_id, raw
                   from data_center.import_rows
                   where batch_id = $1 and ($2 = '' or status = $2)
                   order by row_number limit 300`,
            args: [batchId, status],
          });
          return json({ data: r.rows }, 200, cors);
        });
      }

      default:
        return json(
          { error: `Unknown action: ${body.action ?? "(none)"}`, code: "unknown_action" },
          400,
          cors,
        );
    }
  } catch (err) {
    if (err instanceof BadRequest) {
      return json({ error: err.message, code: "bad_request" }, 400, resolveCors(req));
    }
    console.error("[data-center-import]", err);
    return json({ error: "Data Center import failed", code: "internal" }, 500, resolveCors(req));
  }
});
