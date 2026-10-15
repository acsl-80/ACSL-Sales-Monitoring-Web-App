import { test, expect, type Page } from "@playwright/test";
import { signIn, USERS, branchSql, callEdgeFunction } from "./helpers";

/**
 * The call centre's register, Phase 4 of docs/plans/phone-and-buyer-rule.md.
 *
 * Decision 1 (2026-10-15): a field sale on a shared number is held from the
 * creditable count until a call confirms it, as a digitised one is. The
 * analysis holds any sale with an unconfirmed row on data_center.shared_phones,
 * so what this proves is who lands on the register, and how:
 *
 *  1. register_shared_phone is server only.
 *  2. A sale on an unshared number writes nothing.
 *  3. A field sale (no opt-in) on a number another sale holds registers both
 *     ends: source sales_app, kind shared_number, unconfirmed, so both are held.
 *  4. Across partners too: a partner who cannot see the other sale still puts
 *     both on the register.
 *  5. Digitisation of the same customer marks the repeat and its match
 *     same_buyer; a different name on the number stays shared_number; nothing
 *     already there changes source.
 *  6. A number the call centre confirmed, then a new sale: the old rows stay
 *     confirmed, the new one is open, and the read says the number is open.
 *  7. An edit that moves a sale off a shared number clears its open row, and
 *     the number left with one sale is no longer on the register.
 *  8. The read counts the whole register, puts repeats first, and filters to
 *     them; "Needs a decision" and the page show the repeat.
 * (Red on today's functions: nothing is registered for a field sale, there is
 * no kind and no count.)
 */

const TAG = "E2EPBG";
const TWIN_A = "a0000000-0000-4000-8000-00000000000a";
const PARTNER_ORG = "a0000000-0000-4000-8000-000000000001"; // partner@ and agent@
const run = String(Date.now() % 1e6).padStart(6, "0");
const spent = new Set<string>();
const num = (slot: number) => `0805${run}${slot}`;
const tail = (phone: string) => phone.slice(1);

async function freeStove(org: string): Promise<string> {
  const rows = await branchSql<{ stove_id: string }>(
    `select stove_id from public.stove_ids_base
      where organization_id = '${org}' and status = 'available' and sale_id is null
        and is_archived is not true
      order by stove_id desc limit 60`,
  );
  const free = rows.map((r) => r.stove_id).find((s) => !spent.has(s));
  expect(free, `a free stove at ${org}`).toBeTruthy();
  spent.add(free!);
  return free!;
}

let seq = 0;
async function sell(
  page: Page,
  org: string,
  first: string,
  surname: string,
  phone: string,
  extra: Record<string, unknown> = {},
): Promise<string> {
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
    ...extra,
  });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return (r.body as { data: { id: string } }).data.id;
}

type Row = { sale_id: string; source: string; kind: string; confirmed: boolean };

/** The register rows on a number, waited for: the write lands after the reply. */
async function registered(phone: string, expectCount: number): Promise<Row[]> {
  let rows: Row[] = [];
  for (let i = 0; i < 30; i++) {
    rows = await branchSql<Row>(
      `select sale_id::text, source, kind, confirmed from data_center.shared_phones
        where phone_tail = '${tail(phone)}' order by created_at`,
    );
    if (rows.length >= expectCount) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  return rows;
}

async function held(saleId: string): Promise<boolean> {
  // The analysis's own test (data_center.compute_analysis): an unconfirmed row.
  const [r] = await branchSql<{ held: boolean }>(
    `select exists (select 1 from data_center.shared_phones sp
                     where sp.sale_id = '${saleId}' and sp.confirmed is false) as held`,
  );
  return r.held;
}

test.afterAll(async () => {
  const mine = `select id from public.sales where transaction_id like '${TAG}-%'`;
  await branchSql(`delete from data_center.shared_phones where sale_id in (${mine})`).catch(() => {});
  await branchSql(
    `update public.stove_ids_base set status = 'available', sale_id = null where sale_id in (${mine})`,
  ).catch(() => {});
  await branchSql(`delete from public.installment_payments where sale_id in (${mine})`).catch(
    () => {},
  );
  await branchSql(`delete from public.sales where transaction_id like '${TAG}-%'`).catch(() => {});
  await branchSql(`delete from public.addresses where full_address like '${TAG}%'`).catch(() => {});
});

test.describe.serial("the call centre's register", () => {
  const ids: Record<string, string> = {};
  // Each case makes up to four sales and waits for writes that land after the
  // reply, so a minute is not enough on a cold preview.
  test.beforeEach(() => test.setTimeout(150_000));

  test("register_shared_phone is server only", async () => {
    const [p] = await branchSql<{ definer: boolean; authenticated: boolean; server: boolean }>(`
      select p.prosecdef as definer,
             has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
             has_function_privilege('service_role', p.oid, 'execute') as server
        from pg_proc p where p.proname = 'register_shared_phone'`);
    expect(p).toEqual({ definer: true, authenticated: false, server: true });
  });

  test("a sale on an unshared number writes nothing", async ({ page }) => {
    await signIn(page, USERS.admin);
    ids.alone = await sell(page, TWIN_A, "Zainab", "Lawal", num(1));
    // Long enough for a write after the reply to have landed, then one look.
    await page.waitForTimeout(4_000);
    expect(await registered(num(1), 0)).toEqual([]);
    expect(await held(ids.alone)).toBe(false);
  });

  test("a field sale on a held number registers both ends, unconfirmed", async ({ page }) => {
    await signIn(page, USERS.admin);
    ids.aisha = await sell(page, TWIN_A, "Aisha", "Bello", num(2));
    ids.musa = await sell(page, TWIN_A, "Musa", "Bello", num(2));
    const rows = await registered(num(2), 2);
    expect(rows.map((r) => r.sale_id).sort()).toEqual([ids.aisha, ids.musa].sort());
    for (const r of rows) {
      expect(r).toMatchObject({ source: "sales_app", kind: "shared_number", confirmed: false });
    }
    // Decision 1: both are out of the creditable count until a call.
    expect(await held(ids.aisha)).toBe(true);
    expect(await held(ids.musa)).toBe(true);
  });

  test("across partners: a partner who cannot see the other sale still registers both", async ({
    page,
    browser,
  }) => {
    await signIn(page, USERS.admin);
    ids.ngozi = await sell(page, TWIN_A, "Ngozi", "Eze", num(3));
    // A fresh context: the session lives in localStorage, so a second sign-in
    // on the same page would land on the admin's dashboard instead.
    const partnerContext = await browser.newContext();
    const partnerPage = await partnerContext.newPage();
    await signIn(partnerPage, USERS.partner);
    ids.chika = await sell(partnerPage, PARTNER_ORG, "Chika", "Eze", num(3));
    await partnerContext.close();
    const rows = await registered(num(3), 2);
    expect(rows.map((r) => r.sale_id).sort()).toEqual([ids.ngozi, ids.chika].sort());
  });

  test("digitisation of the same customer marks the repeat and its match same_buyer", async ({
    page,
  }) => {
    await signIn(page, USERS.admin);
    ids.repeat = await sell(page, TWIN_A, "BELLO,", "aisha", num(2), { allowSharedPhone: true });
    const rows = await registered(num(2), 3);
    const by = Object.fromEntries(rows.map((r) => [r.sale_id, r]));
    expect(by[ids.repeat]).toMatchObject({ kind: "same_buyer", source: "digitalisation", confirmed: false });
    expect(by[ids.aisha]).toMatchObject({ kind: "same_buyer", source: "sales_app" });
    // Musa is another person on the number: still only a shared number.
    expect(by[ids.musa]).toMatchObject({ kind: "shared_number", source: "sales_app" });
  });

  test("a confirmed number that gains a sale is open again, old rows still confirmed", async ({
    page,
  }) => {
    await signIn(page, USERS.admin);
    const confirm = await callEdgeFunction(page, "data-center-write", {
      action: "record_shared_phone",
      saleId: ids.ngozi,
      phone: num(3),
      note: `${TAG} household`,
    });
    expect(confirm.status, JSON.stringify(confirm.body)).toBe(200);
    expect(await held(ids.ngozi)).toBe(false);
    const touched = async () =>
      (
        await branchSql<{ at: string }>(
          `select updated_at::text as at from data_center.shared_phones
            where sale_id = '${ids.ngozi}' and phone_tail = '${tail(num(3))}'`,
        )
      )[0].at;
    const confirmedAt = await touched();

    ids.obi = await sell(page, TWIN_A, "Obi", "Eze", num(3));
    const rows = await registered(num(3), 3);
    // A confirmed row is not rewritten by a later sale: its time stands.
    expect(await touched()).toBe(confirmedAt);
    const by = Object.fromEntries(rows.map((r) => [r.sale_id, r]));
    expect(by[ids.ngozi].confirmed).toBe(true);
    expect(by[ids.chika].confirmed).toBe(true);
    expect(by[ids.obi]).toMatchObject({ confirmed: false, source: "sales_app" });
    expect(await held(ids.obi)).toBe(true);

    const read = await callEdgeFunction(page, "data-center-read", {
      action: "shared_phones",
      search: tail(num(3)),
    });
    const group = (read.body as { data: { rows: { phone_tail: string; open_count: number }[] } })
      .data.rows.find((g) => g.phone_tail === tail(num(3)));
    expect(group?.open_count).toBe(1);
  });

  test("an edit that moves a sale off a shared number clears the open rows it leaves", async ({
    page,
  }) => {
    await signIn(page, USERS.admin);
    ids.moveA = await sell(page, TWIN_A, "Ibrahim", "Sule", num(4));
    ids.moveB = await sell(page, TWIN_A, "Ruth", "Sule", num(4));
    expect(await registered(num(4), 2)).toHaveLength(2);

    const moved = await callEdgeFunction(
      page,
      "update-sale",
      {
        endUserName: "Ruth Sule",
        endUserFirstName: "Ruth",
        endUserSurname: "Sule",
        phone: num(5),
        contactPerson: "Spec Contact",
        contactPhone: num(5),
      },
      `?id=${ids.moveB}`,
    );
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);

    let left: Row[] = [];
    for (let i = 0; i < 30; i++) {
      left = await branchSql<Row>(
        `select sale_id::text, source, kind, confirmed from data_center.shared_phones
          where phone_tail = '${tail(num(4))}'`,
      );
      if (left.length === 0) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    // Ibrahim is alone on the number now: nothing is shared, nothing is held.
    expect(left).toEqual([]);
    expect(await held(ids.moveA)).toBe(false);
    expect(await held(ids.moveB)).toBe(false);
  });

  test("a refused same customer writes nothing; one of three leaving keeps the other two open", async ({
    page,
  }) => {
    await signIn(page, USERS.admin);
    const before = await registered(num(2), 3);

    // Sell Stove's own request for Aisha again: refused, nothing written.
    const [o] = await branchSql<{ name: string }>(
      `select partner_name as name from public.organizations where id = '${TWIN_A}'`,
    );
    const refused = await callEdgeFunction(page, "create-sale", {
      transactionId: `${TAG}-${run}-refused`,
      stoveSerialNo: await freeStove(TWIN_A),
      organizationId: TWIN_A,
      partnerName: o.name,
      salesDate: "2026-10-01",
      amount: 25000,
      endUserFirstName: "Aisha",
      endUserSurname: "Bello",
      endUserName: "Aisha Bello",
      phone: num(2),
      contactPerson: "Spec Contact",
      contactPhone: num(2),
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
    expect(refused.status).toBe(409);
    await page.waitForTimeout(3_000);
    expect(await registered(num(2), 0)).toHaveLength(before.length);

    // Musa moves off the number; Aisha and her repeat still share it.
    const moved = await callEdgeFunction(
      page,
      "update-sale",
      {
        endUserName: "Musa Bello",
        endUserFirstName: "Musa",
        endUserSurname: "Bello",
        phone: num(7),
        contactPerson: "Spec Contact",
        contactPhone: num(7),
      },
      `?id=${ids.musa}`,
    );
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    let rows: Row[] = [];
    for (let i = 0; i < 30; i++) {
      rows = await registered(num(2), 0);
      if (!rows.some((r) => r.sale_id === ids.musa)) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(rows.map((r) => r.sale_id).sort()).toEqual([ids.aisha, ids.repeat].sort());
    expect(await held(ids.aisha)).toBe(true);
    expect(await held(ids.musa)).toBe(false);
  });

  test("an edit onto a shared number registers it, and holds the sale already there", async ({
    page,
  }) => {
    await signIn(page, USERS.admin);
    // Zainab was alone on her number; she moves onto Musa's new number.
    const moved = await callEdgeFunction(
      page,
      "update-sale",
      {
        endUserName: "Zainab Lawal",
        endUserFirstName: "Zainab",
        endUserSurname: "Lawal",
        phone: num(7),
        contactPerson: "Spec Contact",
        contactPhone: num(7),
      },
      `?id=${ids.alone}`,
    );
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    const rows = await registered(num(7), 2);
    expect(rows.map((r) => r.sale_id).sort()).toEqual([ids.alone, ids.musa].sort());
    for (const r of rows) expect(r).toMatchObject({ source: "sales_app", confirmed: false });
    expect(await held(ids.musa)).toBe(true);
  });

  test("two first sales on a new number at the same moment are both registered", async ({
    page,
  }) => {
    await signIn(page, USERS.admin);
    const [a, b] = await Promise.all([
      sell(page, TWIN_A, "Kemi", "Ade", num(8)),
      sell(page, TWIN_A, "Tunde", "Ade", num(8)),
    ]);
    const rows = await registered(num(8), 2);
    expect(rows.map((r) => r.sale_id).sort()).toEqual([a, b].sort());
  });

  test("the read counts the whole register, repeats first, and filters to them", async ({ page }) => {
    await signIn(page, USERS.admin);
    const all = await callEdgeFunction(page, "data-center-read", { action: "shared_phones", limit: 500 });
    const body = all.body as {
      data: {
        rows: { phone_tail: string; any_same_buyer: boolean; open_count: number; stoves: { kind: string }[] }[];
        counts: { open_numbers: number; same_buyer_numbers: number; open_stoves: number; same_buyer_stoves: number };
      };
    };
    const [truth] = await branchSql<{ open_numbers: number; same_buyer_numbers: number }>(`
      with g as (select phone_tail,
                        count(*) filter (where confirmed is false) as open_count,
                        bool_or(kind = 'same_buyer') as sb
                   from data_center.shared_phones group by phone_tail having count(*) > 1)
      select (count(*) filter (where open_count > 0))::int as open_numbers,
             (count(*) filter (where open_count > 0 and sb))::int as same_buyer_numbers from g`);
    expect(body.data.counts.open_numbers).toBe(truth.open_numbers);
    expect(body.data.counts.same_buyer_numbers).toBe(truth.same_buyer_numbers);
    expect(body.data.counts.same_buyer_numbers).toBeGreaterThanOrEqual(1);

    // Open repeats lead the list.
    const firstOrdinary = body.data.rows.findIndex((g) => !(g.any_same_buyer && g.open_count > 0));
    const lastRepeat = body.data.rows.map((g) => g.any_same_buyer && g.open_count > 0).lastIndexOf(true);
    if (firstOrdinary !== -1) expect(lastRepeat).toBeLessThan(firstOrdinary);
    expect(body.data.rows.find((g) => g.phone_tail === tail(num(2)))?.stoves.map((s) => s.kind)).toContain(
      "same_buyer",
    );

    const only = await callEdgeFunction(page, "data-center-read", {
      action: "shared_phones",
      sameBuyerOnly: true,
      limit: 500,
    });
    const onlyRows = (only.body as { data: { rows: { any_same_buyer: boolean }[] } }).data.rows;
    expect(onlyRows.length).toBeGreaterThanOrEqual(1);
    for (const g of onlyRows) expect(g.any_same_buyer).toBe(true);
  });

  test("Needs a decision and the register page show the repeat", async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/call-centre");
    const row = page.locator('[data-decision="Same customer recorded twice, unconfirmed"]');
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.getByRole("link", { name: "Review" }).click();
    await expect(page).toHaveURL(/shared-phones\?only=same-buyer/);
    await expect(page.getByLabel("Same customer twice only")).toBeChecked();
    await expect(page.getByTestId("same-buyer-tag").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("shared-phone-counts")).toContainText("with the same customer twice");
  });
});
