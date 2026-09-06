import { test, expect } from "@playwright/test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { signIn, USERS, branchSql, callEdgeFunction } from "./helpers";

/**
 * The payload contract (slice F5): the dictionary is what both apps send, and
 * this spec fails the day either drifts from it.
 *
 *  1. Every dictionary field with a payload key is a key create-sale and, when
 *     correctable, update-sale accept: read from their source, not assumed.
 *  2. Every such key, sent to create-sale, lands in its own column and reads
 *     back as sent (choices as their value, the consents as given).
 *  3. Every correctable key, sent to update-sale, moves its column.
 *  4. The phone app's sources name every key the rules require today. A key
 *     required from a later day is reported, not failed, so the date the
 *     administrator holds is the switch.
 *
 * A guard rather than a red: the web side already meets it. It exists to stay
 * green, and to say exactly which key went missing when it does not.
 */

test.describe.configure({ timeout: 240_000 });

const TWIN_A = "a0000000-0000-4000-8000-00000000000a";
const MARKER = "CONTRACT-SPEC";
const REPO = fileURLToPath(new URL("..", import.meta.url));
const MOBILE = process.env.SALES_MOBILE_DIR ?? join(REPO, "..", "sales-mobile");

type Field = {
  key: string;
  label: string;
  table: string;
  column: string;
  payload: string | null;
  type: string;
  options?: { value: string; label: string }[];
  correctable: boolean;
  mandatoryFrom: string | null;
  status?: string;
};

const DICTIONARY = JSON.parse(readFileSync(join(REPO, "supabase/functions/_shared/sale-dictionary.json"), "utf-8")) as { fields: Field[] };
const LIVE = DICTIONARY.fields.filter((f) => f.status !== "planned");
/** The fields a writer sends: on the sale or its address, with a payload key. */
const SENT = LIVE.filter((f) => f.payload && (f.table === "sales" || f.table === "addresses"));
/** The payment trio is written by the payment path, proven by the bench model spec; the round trips leave it out. */
const PAYMENT = new Set(["payment_model_id", "is_installment", "total_paid"]);
const ROUND_TRIP = SENT.filter((f) => !PAYMENT.has(f.key));
const ADDRESS_KEY: Record<string, string> = { full_address: "fullAddress", city: "city" };

/** The key a field travels under: `addressData.<camel>` for the address, the payload key otherwise. */
function payloadKeyOf(f: Field): string {
  return f.table === "addresses" ? `addressData.${ADDRESS_KEY[f.column] ?? f.column}` : f.payload!;
}

/** The keys a function destructures from its body: `const { a, b, } = body`. */
function acceptedKeys(source: string): Set<string> {
  const keys = new Set<string>();
  // Comments go first, so a brace or a comma inside one cannot shape the match;
  // then the one destructure whose braces hold no other braces and end at `= body`.
  const clean = source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const re = /const\s*\{([^{}]*)\}\s*=\s*body/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean))) {
    for (const raw of m[1].split(",")) {
      const name = raw.trim().split(":")[0].trim();
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) keys.add(name);
    }
  }
  return keys;
}

/** A value of the field's type, distinct per field, that reads back as sent. */
function sample(f: Field, stamp: string, index = 0): unknown {
  if (f.options?.length) return f.options[0].value;
  switch (f.type) {
    case "phone":
      // Eleven digits, distinct per field, so two numbers on one record differ.
      return `0803${stamp.slice(0, 6)}${index % 10}`;
    case "date":
      return "2026-06-01";
    case "money":
      return 25000;
    case "number":
      return 2;
    case "boolean":
      return true;
    case "consents":
      return { poaGoverned: true, monitoring: true, noResell: true, emissionReductions: true, noExport: true, demonstration: true };
    case "signature":
    case "image":
      return undefined;
    default:
      return `${f.key}-${stamp}`;
  }
}

/** JSON with sorted keys, so two objects compare by content. */
function canonical(v: unknown): string {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    return JSON.stringify(Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]])));
  }
  return JSON.stringify(v);
}

function dartFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...dartFiles(p));
    else if (name.endsWith(".dart")) out.push(p);
  }
  return out;
}

test.afterAll(async () => {
  await branchSql(
    `update public.stove_ids_base set status = 'available', sale_id = null
      where sale_id in (select id from public.sales where transaction_id like '${MARKER}-%')`,
  ).catch(() => {});
  await branchSql(`delete from public.sales where transaction_id like '${MARKER}-%'`).catch(() => {});
  await branchSql(`delete from public.addresses where full_address like '%${MARKER}%'`).catch(() => {});
});

test("create-sale and update-sale accept every key the dictionary names", () => {
  const create = acceptedKeys(readFileSync(join(REPO, "supabase/functions/create-sale/index.ts"), "utf-8"));
  const update = acceptedKeys(readFileSync(join(REPO, "supabase/functions/update-sale/index.ts"), "utf-8"));
  expect(create.size, "create-sale destructures its body").toBeGreaterThan(10);
  const missingOnCreate = SENT.filter((f) => f.table === "sales" && !create.has(f.payload!)).map((f) => f.payload);
  expect(missingOnCreate, "keys the dictionary names that create-sale does not read").toEqual([]);
  expect(create.has("addressData"), "create-sale reads addressData").toBe(true);
  const missingOnUpdate = SENT.filter((f) => f.table === "sales" && f.correctable && !update.has(f.payload!)).map((f) => f.payload);
  expect(missingOnUpdate, "correctable keys update-sale does not read").toEqual([]);
});

test("every key sent to create-sale lands in its column and reads back as sent", async ({ page }) => {
  await signIn(page, USERS.admin);
  const stoves = await callEdgeFunction(page, "data-center-read", { action: "partner_stoves", organizationId: TWIN_A, limit: 100 });
  const free = ((stoves.body as { data?: { stoves?: { stove_id: string; sale_id: string | null }[] } }).data?.stoves ?? []).find((s) => !s.sale_id);
  expect(free, "a free stove of the twin partner").toBeTruthy();
  const [partner] = await branchSql<{ partner_name: string }>(`select partner_name from public.organizations where id = '${TWIN_A}'`);
  const stamp = String(Date.now()).slice(-9);

  const payload: Record<string, unknown> = {
    transactionId: `${MARKER}-${stamp}`,
    stoveSerialNo: free!.stove_id,
    organizationId: TWIN_A,
    partnerName: partner.partner_name,
    addressData: { state: "Kogi" },
  };
  const sent = new Map<Field, unknown>();
  let index = 0;
  for (const f of ROUND_TRIP) {
    if (["stove_serial_no", "partner_name"].includes(f.key)) continue;
    const v = sample(f, stamp, index++);
    if (v === undefined) continue;
    if (f.table === "addresses") (payload.addressData as Record<string, unknown>)[ADDRESS_KEY[f.column] ?? f.column] = v;
    else payload[f.payload!] = v;
    sent.set(f, v);
  }
  // The joined name is composed from its parts; a state and an LGA the
  // address validator knows; a phone the uniqueness rule has not seen.
  payload.stateBackup = "Kogi";
  payload.lgaBackup = "Lokoja";
  payload.endUserName = `${payload.endUserFirstName} ${payload.endUserSurname}`;

  const created = await callEdgeFunction(page, "create-sale", payload);
  expect([200, 201], JSON.stringify(created.body).slice(0, 300)).toContain(created.status);
  const id = (created.body as { data?: { id?: string } }).data?.id;
  expect(id).toBeTruthy();

  const [row] = await branchSql<Record<string, unknown>>(
    `select to_jsonb(s) || jsonb_build_object('address', to_jsonb(a)) as r
       from public.sales s left join public.addresses a on a.id = s.address_id where s.id = '${id}'`,
  ).then((rows) => rows.map((x) => x.r as Record<string, unknown>));
  const address = (row.address ?? {}) as Record<string, unknown>;
  const mismatches: string[] = [];
  for (const [f, v] of sent) {
    if (["state_backup", "lga_backup", "end_user_name"].includes(f.key)) continue;
    const got = f.table === "addresses" ? address[f.column] : row[f.column];
    const want = typeof v === "number" ? Number(got) : got;
    const same = typeof v === "object" ? canonical(got) === canonical(v) : String(want) === String(v);
    if (!same) mismatches.push(`${payloadKeyOf(f)} sent ${JSON.stringify(v)}, column ${f.table}.${f.column} holds ${JSON.stringify(got)}`);
  }
  expect(mismatches, "keys that did not land in their column").toEqual([]);
});

test("every correctable key sent to update-sale moves its column", async ({ page }) => {
  await signIn(page, USERS.admin);
  const [target] = await branchSql<{ id: string }>(
    `select id::text as id from public.sales where transaction_id like '${MARKER}-%' order by created_at desc limit 1`,
  );
  expect(target, "the sale the previous test made").toBeTruthy();
  const stamp = String(Date.now()).slice(-9);
  const patch: Record<string, unknown> = { addressData: {} };
  const sent = new Map<Field, unknown>();
  let index = 0;
  for (const f of ROUND_TRIP) {
    if (!f.correctable || f.type === "signature" || f.type === "image") continue;
    const v = f.type === "phone" ? `0806${stamp.slice(0, 6)}${index++ % 10}` : sample(f, stamp, index++);
    if (v === undefined) continue;
    if (f.table === "addresses") (patch.addressData as Record<string, unknown>)[ADDRESS_KEY[f.column] ?? f.column] = v;
    else patch[f.payload!] = v;
    sent.set(f, v);
  }
  patch.stateBackup = "Kogi";
  patch.lgaBackup = "Lokoja";
  patch.endUserName = `${patch.endUserFirstName ?? "Contract"} ${patch.endUserSurname ?? "Spec"}`;

  const updated = await callEdgeFunction(page, `update-sale?id=${target.id}`, patch);
  expect([200], JSON.stringify(updated.body).slice(0, 300)).toContain(updated.status);
  const [row] = await branchSql<Record<string, unknown>>(
    `select to_jsonb(s) || jsonb_build_object('address', to_jsonb(a)) as r
       from public.sales s left join public.addresses a on a.id = s.address_id where s.id = '${target.id}'`,
  ).then((rows) => rows.map((x) => x.r as Record<string, unknown>));
  const address = (row.address ?? {}) as Record<string, unknown>;
  const mismatches: string[] = [];
  for (const [f, v] of sent) {
    if (["state_backup", "lga_backup", "end_user_name", "contact_phone", "other_phone"].includes(f.key)) continue;
    const got = f.table === "addresses" ? address[f.column] : row[f.column];
    const same = typeof v === "object" ? canonical(got) === canonical(v) : String(got) === String(v);
    if (!same) mismatches.push(`${payloadKeyOf(f)} sent ${JSON.stringify(v)}, column ${f.table}.${f.column} holds ${JSON.stringify(got)}`);
  }
  expect(mismatches, "correctable keys that did not move their column").toEqual([]);
});

test("the phone app names every key the rules require today", async () => {
  expect(existsSync(join(MOBILE, "lib")), `the sales-mobile repo at ${MOBILE} (set SALES_MOBILE_DIR to point elsewhere)`).toBe(true);
  const sources = dartFiles(join(MOBILE, "lib")).map((p) => readFileSync(p, "utf-8")).join("\n");
  const rules = await branchSql<{ field_key: string; mandatory_from: string }>(
    `select field_key, mandatory_from::text as mandatory_from from public.sale_field_rules
      where 'sales_app' = any(applies_to) and mandatory_from is not null order by mandatory_from, field_key`,
  );
  const today = new Date().toISOString().slice(0, 10);
  const byKey = new Map(LIVE.map((f) => [f.key, f]));
  const names = (f: Field) => (f.table === "addresses" ? ADDRESS_KEY[f.column] ?? f.column : f.payload!);
  const mentions = (name: string) => sources.includes(`'${name}'`) || sources.includes(`"${name}"`);
  const missingNow: string[] = [];
  const missingLater: string[] = [];
  for (const r of rules) {
    const f = byKey.get(r.field_key);
    if (!f || !(f.payload || f.table === "addresses")) continue;
    const name = names(f);
    if (mentions(name)) continue;
    (r.mandatory_from <= today ? missingNow : missingLater).push(`${name} (${f.label}, from ${r.mandatory_from})`);
  }
  if (missingLater.length) console.log(`Required from a later day and not yet in the phone app: ${missingLater.join("; ")}`);
  expect(missingNow, "keys the rules require today that the phone app does not send").toEqual([]);
});
