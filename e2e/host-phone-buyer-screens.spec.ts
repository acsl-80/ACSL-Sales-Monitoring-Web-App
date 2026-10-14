import { test, expect, type Page } from "@playwright/test";
import { signIn, USERS, branchSql, callEdgeFunction } from "./helpers";

/**
 * The phone number and buyer rule on the screens (Phase 2 of
 * docs/plans/phone-and-buyer-rule.md).
 *
 * Phase 1 put the rule on the server. This proves what people see:
 *
 *  1. The form's lookup, visible_sales_on_phone, runs as the signed-in user
 *     (security invoker): anon cannot call it, a signed-in user can, and it
 *     returns only sales that user may read.
 *  2. Sell Stove, as someone who can see the sales on a number: a different
 *     name shows an amber note and no error; the same name, written another
 *     way, shows the same-customer error naming the sale. One lookup per
 *     typing pause, never a list download. (Red: today's form calls a
 *     duplicate phone an error whatever the name, and never notes.)
 *  3. Sell Stove, as a partner who cannot see those sales: the lookup returns
 *     nothing and the form shows nothing, so the live check reveals no other
 *     partner's customer. The server still refuses the same customer on save
 *     (Phase 1, host-phone-buyer-rule).
 *  4. The Stove record: a number shared by different names is amber; one that
 *     also carries the same customer twice (digitisation) is red, with the
 *     repeat tagged. (Red: every second sale on a number is a red violation.)
 */

const TAG = "E2EPBS";
const TWIN_A = "a0000000-0000-4000-8000-00000000000a";
const run = String(Date.now() % 1e6).padStart(6, "0");
const P = `0806${run}7`; // a number nobody else on the branch holds
const spent = new Set<string>();

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
async function sell(
  page: Page,
  first: string,
  surname: string,
  extra: Record<string, unknown> = {},
): Promise<{ transactionId: string; stove: string }> {
  seq += 1;
  const [org] = await branchSql<{ name: string }>(
    `select partner_name as name from public.organizations where id = '${TWIN_A}'`,
  );
  const transactionId = `${TAG}-${run}-${seq}`;
  const stove = await freeStove(TWIN_A);
  const r = await callEdgeFunction(page, "create-sale", {
    transactionId,
    stoveSerialNo: stove,
    organizationId: TWIN_A,
    partnerName: org.name,
    salesDate: "2026-10-01",
    amount: 25000,
    endUserFirstName: first,
    endUserSurname: surname,
    endUserName: `${first} ${surname}`,
    phone: P,
    contactPerson: "Spec Contact",
    contactPhone: P,
    termsAccepted: {
      poaGoverned: true,
      monitoring: true,
      noResell: true,
      emissionReductions: true,
      noExport: true,
      demonstration: true,
    },
    addressData: { fullAddress: `${TAG} Road`, state: "Kogi", city: "Lokoja" },
    ...extra,
  });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return { transactionId, stove };
}

/** Types into the Sell Stove buyer fields and waits for the lookup that follows. */
async function typeBuyer(page: Page, first: string, surname: string, phone: string) {
  await page.locator("#endUserName").fill(first);
  await page.locator("#endUserSurname").fill(surname);
  const lookup = page.waitForResponse((r) => r.url().includes("/rpc/visible_sales_on_phone"));
  await page.locator("#phone").fill(phone);
  const response = await lookup;
  await expect(page.getByText("Checking…")).toHaveCount(0);
  return (await response.json()) as { transaction_id: string }[];
}

let A: { transactionId: string; stove: string }; // Aisha Bello
let B: { transactionId: string; stove: string }; // Musa Bello, same number
let C: { transactionId: string; stove: string }; // "BELLO, aisha", digitised repeat of A

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

test.describe.serial("phone and buyer rule on the screens", () => {
  test("the form's lookup runs as the caller, and anon cannot call it", async () => {
    const [p] = await branchSql<{ invoker: boolean; anon: boolean; authenticated: boolean }>(`
      select not p.prosecdef as invoker,
             has_function_privilege('anon', p.oid, 'execute') as anon,
             has_function_privilege('authenticated', p.oid, 'execute') as authenticated
        from pg_proc p where p.proname = 'visible_sales_on_phone'`);
    expect(p).toEqual({ invoker: true, anon: false, authenticated: true });
  });

  test("set up: two customers on one number, and a digitised repeat of the first", async ({
    page,
  }) => {
    await signIn(page, USERS.admin);
    A = await sell(page, "Aisha", "Bello");
    B = await sell(page, "Musa", "Bello");
    // Digitisation is the one door that may record the same customer again.
    C = await sell(page, "BELLO,", "aisha", { allowSharedPhone: true });
  });

  test("Sell Stove notes a shared number and refuses the same customer, one lookup per pause", async ({
    page,
  }) => {
    await signIn(page, USERS.admin);
    await page.goto("/sales/create");
    await expect(page.locator("#phone")).toBeVisible();

    const lookups: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/rpc/visible_sales_on_phone")) lookups.push(r.url());
      // The old check read the sales table with an ilike on phone.
      if (r.url().includes("/rest/v1/sales?") && r.url().includes("ilike")) lookups.push("OLD");
    });

    // A different name: a note, not an error.
    const rows = await typeBuyer(page, "Grace", "Okon", P);
    expect(rows.map((r) => r.transaction_id).sort()).toEqual(
      [A.transactionId, B.transactionId, C.transactionId].sort(),
    );
    const note = page.getByTestId("phone-shared-note");
    await expect(note).toBeVisible();
    await expect(note).toContainText(A.transactionId);
    await expect(note).toContainText("will still save");
    await expect(page.locator("#phone")).toHaveAttribute("aria-invalid", "false");

    // The same customer, written another way (a title, the other case).
    await typeBuyer(page, "Mrs AISHA", "bello", "+234" + P.slice(1));
    await expect(page.getByTestId("phone-shared-note")).toHaveCount(0);
    await expect(page.locator("#phone")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByText(/same name and phone number\) is already registered on sale/)).toContainText(
      A.transactionId,
    );

    // A lookup per pause, not per keystroke, and never the old table read.
    expect(lookups).not.toContain("OLD");
    expect(lookups.length).toBeLessThanOrEqual(4);
  });

  test("a partner who cannot see those sales is shown nothing about them", async ({ page }) => {
    await signIn(page, USERS.partner);
    await page.goto("/sales/create");
    await expect(page.locator("#phone")).toBeVisible();

    const rows = await typeBuyer(page, "Aisha", "Bello", P);
    expect(rows).toEqual([]);
    await expect(page.getByTestId("phone-shared-note")).toHaveCount(0);
    await expect(page.locator("#phone")).toHaveAttribute("aria-invalid", "false");
  });

  test("the Stove record: amber for a shared number, red with the repeat tagged", async ({
    page,
  }) => {
    await signIn(page, USERS.admin);

    // Musa's record: two other names on his number, Aisha twice. Neither is
    // Musa, so it is only a shared number.
    await page.goto(`/data-center/stove/${encodeURIComponent(B.stove)}`);
    const shared = page.getByTestId("phone-twins");
    await expect(shared).toBeVisible({ timeout: 30_000 });
    await expect(shared).toHaveAttribute("data-tone", "shared");
    await expect(shared).toContainText("Shared number: also on 2 other sales");
    await expect(shared.getByText("same customer", { exact: true })).toHaveCount(0);

    // Aisha's record: her digitised repeat is on the number, so red, and only
    // that row is tagged.
    await page.goto(`/data-center/stove/${encodeURIComponent(A.stove)}`);
    const repeat = page.getByTestId("phone-twins");
    await expect(repeat).toBeVisible({ timeout: 30_000 });
    await expect(repeat).toHaveAttribute("data-tone", "same-buyer");
    await expect(repeat).toContainText("The same customer is on 1 other sale");
    const tagged = repeat.locator("li", { hasText: "same customer" });
    await expect(tagged).toHaveCount(1);
    await expect(tagged).toContainText(C.stove);
  });
});
