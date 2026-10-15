import { test, expect, type Page } from "@playwright/test";
import { signIn, USERS, branchSql, callEdgeFunction } from "./helpers";
import { buyerKey, BUYER_KEY_RULES } from "../supabase/functions/_shared/buyerKey.ts";

/**
 * The phone app's list, Phase 3 of docs/plans/phone-and-buyer-rule.md.
 *
 * `get-end-user-phones` is what the phone app checks offline. It keeps `data`
 * exactly as phone app 1.0.18 reads it and adds, beside it, the buyer keys
 * and the rules they are built with, under an ETag.
 *
 *  1. The key inputs come from buyer_key_inputs, security invoker: anon cannot
 *     call it, a signed-in user can.
 *  2. `data` is what it always was: every sale's number as a 10-digit tail,
 *     cancelled sales included, nothing else, plus count, scanned, truncated.
 *  3. `buyerKeys` holds the key of a sale the caller may read, computed the
 *     way the vectors file says, and no names. `buyerKeyRules` is the served
 *     title list.
 *  4. A partner gets keys only for sales they may read: another partner's
 *     customer is not in their list (create-sale refuses that repeat at sync).
 *  5. The ETag: the same list twice is the same tag; sent back, it is a 304
 *     with no body; a new sale changes it.
 * (Red on today's function: no buyerKeys, no buyerKeyRules, no ETag.)
 */

const TAG = "E2EPBL";
const TWIN_A = "a0000000-0000-4000-8000-00000000000a";
const PARTNER_ORG = "a0000000-0000-4000-8000-000000000001"; // partner@ and agent@
const run = String(Date.now() % 1e6).padStart(6, "0");
const spent = new Set<string>();

type List = {
  success?: boolean;
  data?: string[];
  count?: number;
  scanned?: number;
  truncated?: boolean;
  buyerKeys?: string[];
  buyerKeyRules?: { version: string; titles: string[] };
};

/** The list as the phone app fetches it, with the caller's If-None-Match. */
async function fetchList(
  page: Page,
  ifNoneMatch?: string,
): Promise<{ status: number; etag: string | null; body: List | null; raw: string }> {
  return page.evaluate(async ({ ifNoneMatch }) => {
    const key = Object.keys(window.localStorage).find(
      (k) => k.startsWith("sb-") && k.endsWith("-auth-token"),
    );
    const stored = JSON.parse(window.localStorage.getItem(key ?? "") ?? "{}");
    const token = stored.access_token ?? stored?.currentSession?.access_token;
    const ref = (key ?? "").replace(/^sb-/, "").replace(/-auth-token$/, "");
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (ifNoneMatch) headers["If-None-Match"] = ifNoneMatch;
    const r = await fetch(`https://${ref}.supabase.co/functions/v1/get-end-user-phones`, {
      headers,
    });
    const raw = await r.text();
    let body = null;
    try {
      body = JSON.parse(raw);
    } catch {
      /* a 304 has no body */
    }
    return { status: r.status, etag: r.headers.get("etag"), body, raw };
  }, { ifNoneMatch });
}

async function freeStove(org: string): Promise<string> {
  const rows = await branchSql<{ stove_id: string }>(
    `select stove_id from public.stove_ids_base
      where organization_id = '${org}' and status = 'available' and sale_id is null
        and is_archived is not true
      order by stove_id desc limit 50`,
  );
  const free = rows.map((r) => r.stove_id).find((s) => !spent.has(s));
  expect(free, `a free stove at ${org}`).toBeTruthy();
  spent.add(free!);
  return free!;
}

let seq = 0;
async function sell(page: Page, org: string, first: string, surname: string, phone: string) {
  seq += 1;
  const [o] = await branchSql<{ name: string }>(
    `select partner_name as name from public.organizations where id = '${org}'`,
  );
  const r = await callEdgeFunction(page, "create-sale", {
    transactionId: `${TAG}-${run}-${seq}`,
    stoveSerialNo: await freeStove(org),
    organizationId: org,
    partnerName: o.name,
    salesDate: "2026-10-01",
    amount: 25000,
    endUserFirstName: first,
    endUserSurname: surname,
    endUserName: `${first} ${surname}`,
    phone,
    contactPerson: "Spec Contact",
    contactPhone: phone,
    termsAccepted: {
      poaGoverned: true,
      monitoring: true,
      noResell: true,
      emissionReductions: true,
      noExport: true,
      demonstration: true,
    },
    addressData: { fullAddress: `${TAG} Road`, state: "Kogi", city: "Lokoja" },
  });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
}

const PA = `0809${run}1`; // TWIN_A's customer
const PB = `0809${run}2`; // the partner's own customer
let keyA: string;
let keyB: string;

test.afterAll(async () => {
  const mine = `select id from public.sales where transaction_id like '${TAG}-%'`;
  await branchSql(
    `update public.stove_ids_base set status = 'available', sale_id = null where sale_id in (${mine})`,
  ).catch(() => {});
  await branchSql(`delete from public.installment_payments where sale_id in (${mine})`).catch(
    () => {},
  );
  await branchSql(`delete from public.sales where transaction_id like '${TAG}-%'`).catch(() => {});
  await branchSql(`delete from public.addresses where full_address like '${TAG}%'`).catch(() => {});
});

test.describe.serial("the phone app's list", () => {
  test("the key inputs are read as the caller, and anon cannot read them", async () => {
    const [p] = await branchSql<{ invoker: boolean; anon: boolean; authenticated: boolean }>(`
      select not p.prosecdef as invoker,
             has_function_privilege('anon', p.oid, 'execute') as anon,
             has_function_privilege('authenticated', p.oid, 'execute') as authenticated
        from pg_proc p where p.proname = 'buyer_key_inputs'`);
    expect(p).toEqual({ invoker: true, anon: false, authenticated: true });
  });

  test("set up: one customer at another partner, one of the partner's own", async ({ page }) => {
    await signIn(page, USERS.admin);
    await sell(page, TWIN_A, "Ngozi", "Eze", PA);
    await sell(page, PARTNER_ORG, "Bala", "Usman", PB);
    keyA = await buyerKey(PA, "Ngozi", "Eze", null);
    keyB = await buyerKey(PB, "Bala", "Usman", null);
    expect(keyA).toMatch(/^[0-9a-f]{16}$/);
  });

  test("data is what phone app 1.0.18 reads, unchanged", async ({ page }) => {
    await signIn(page, USERS.agent);
    const r = await fetchList(page);
    expect(r.status).toBe(200);
    const body = r.body!;
    expect(body.success).toBe(true);
    expect(body.truncated).toBe(false);
    expect(Array.isArray(body.data)).toBe(true);
    for (const d of body.data!) expect(d).toMatch(/^\d{10}$/);

    // The same set the July function returns: every sale's number with ten
    // digits or more, cancelled sales included, for every caller alike.
    const expected = await branchSql<{ tail: string }>(`
      select distinct right(regexp_replace(phone, '[^0-9]', '', 'g'), 10) as tail
        from public.sales
       where phone is not null and length(regexp_replace(phone, '[^0-9]', '', 'g')) >= 10`);
    expect(new Set(body.data)).toEqual(new Set(expected.map((e) => e.tail)));
    expect(body.count).toBe(body.data!.length);
    const [{ n }] = await branchSql<{ n: number }>(
      `select count(*)::int as n from public.sales where phone is not null`,
    );
    expect(body.scanned).toBe(n);
    expect(body.data).toContain(PA.slice(1));
  });

  test("buyerKeys carry the keys of sales the caller may read, and no names", async ({ page }) => {
    await signIn(page, USERS.admin);
    const r = await fetchList(page);
    const body = r.body!;
    expect(body.buyerKeyRules).toEqual(BUYER_KEY_RULES);
    expect(body.buyerKeys).toContain(keyA);
    expect(body.buyerKeys).toContain(keyB);
    for (const k of body.buyerKeys!) expect(k).toMatch(/^[0-9a-f]{16}$/);
    // Keys, never names.
    expect(r.raw).not.toContain("Ngozi");
    expect(r.raw).not.toContain("Usman");
  });

  test("a partner gets keys only for sales they may read", async ({ page }) => {
    await signIn(page, USERS.partner);
    const body = (await fetchList(page)).body!;
    expect(body.buyerKeys).toContain(keyB);
    expect(body.buyerKeys).not.toContain(keyA);
    // The number itself stays in `data` for everyone, as it always was.
    expect(body.data).toContain(PA.slice(1));
  });

  test("an unchanged list costs a 304; a new sale changes the tag", async ({ page }) => {
    await signIn(page, USERS.partner);
    const first = await fetchList(page);
    // Weak or strong: the gateway may mark it weak on the way out.
    expect(first.etag).toMatch(/^(W\/)?"[0-9a-f]{16}"$/);
    const again = await fetchList(page);
    expect(again.etag).toBe(first.etag);

    const cached = await fetchList(page, first.etag!);
    expect(cached.status).toBe(304);
    expect(cached.raw).toBe("");

    await sell(page, PARTNER_ORG, "Hauwa", "Garba", `0809${run}3`);
    const changed = await fetchList(page, first.etag!);
    expect(changed.status).toBe(200);
    expect(changed.etag).not.toBe(first.etag);
    expect(changed.body!.buyerKeys).toContain(await buyerKey(`0809${run}3`, "Hauwa", "Garba", null));
  });
});
