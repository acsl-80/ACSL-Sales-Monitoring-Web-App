import { test, expect } from "@playwright/test";
import { signIn, USERS, branchSql, callEdgeFunction, getEdgeFunction } from "./helpers";

/**
 * The options are data, held once in the registry and read everywhere (A6,
 * A7, A9, slice 8; slice F3b).
 *
 * Fuel source, cooking location and the baseline stove are option lists in
 * the Data Center registry. One narrow door, public.sale_options(), lets the
 * host read them: the dictionary endpoint serves them to the forms and the
 * phone app, create-sale maps what it is sent onto them (keeping the original
 * words in the note columns), the digitisation sheet's dropdowns carry their
 * labels, and Settings says which questions use a list. The payment type is
 * its own control, apart from the sales model. The Complete card's breakdown
 * gains a bucket per dated rule.
 *
 * Red on main: no lists, no function, free-text inputs, one combined payment
 * dropdown, no usedBy, no dated bucket.
 */

test.describe.configure({ timeout: 240_000 });

const TWIN_A = "a0000000-0000-4000-8000-00000000000a";
const MARKER = "OPTIONS-SPEC";

type Opt = { value: string; label: string };
type DictField = { key: string; type: string; options?: Opt[] };

async function dictionary(page: import("@playwright/test").Page): Promise<DictField[]> {
  const r = await getEdgeFunction(page, "sale-dictionary");
  expect(r.status).toBe(200);
  return (r.body as { fields: DictField[] }).fields;
}

async function valueRow(list: string, value: string): Promise<{ id: string; is_active: boolean }> {
  const [r] = await branchSql<{ id: string; is_active: boolean }>(
    `select id::text as id, is_active from data_center.option_values where list_key = '${list}' and value = '${value}'`,
  );
  expect(r, `${list}.${value} exists`).toBeTruthy();
  return r;
}

test.afterAll(async () => {
  await branchSql(
    `update public.stove_ids_base set status = 'available', sale_id = null
      where sale_id in (select id from public.sales where transaction_id like '${MARKER}-%')`,
  ).catch(() => {});
  await branchSql(`delete from public.sales where transaction_id like '${MARKER}-%'`).catch(() => {});
  await branchSql(`delete from public.addresses where full_address like '${MARKER}%'`).catch(() => {});
});

test("the registry holds the three lists, and the host reads them through one function", async () => {
  const rows = await branchSql<{ list_key: string; value: string; is_active: boolean }>(
    `select list_key, value, is_active from data_center.option_values
      where list_key in ('fuel_source', 'cooking_location', 'baseline_stove')
      order by list_key, sort_order, value`,
  );
  const active = (list: string) => rows.filter((r) => r.list_key === list && r.is_active).map((r) => r.value);
  expect(active("fuel_source")).toEqual(["collect", "purchase"]);
  expect(active("cooking_location")).toEqual(["indoor", "outdoor", "semi_indoor"]);
  expect(active("baseline_stove")).toEqual(["firewood", "charcoal", "lpg"]);
  // The call form's old wording is retired, still readable on old calls.
  const retired = rows.filter((r) => r.list_key === "baseline_stove" && !r.is_active).map((r) => r.value).sort();
  expect(retired).toEqual(expect.arrayContaining(["electric_hotplate", "other", "three_stone_firewood", "traditional_charcoal", "traditional_firewood_metal"]));

  const viaDoor = await branchSql<{ list_key: string; value: string; label: string }>(
    `select list_key, value, label from public.sale_options('fuel_source') order by sort_order`,
  );
  expect(viaDoor.map((r) => `${r.value}=${r.label}`)).toEqual(["collect=Collect it", "purchase=Purchase it"]);
  const [grant] = await branchSql<{ ok: boolean }>(
    `select has_function_privilege('authenticated', 'public.sale_options(text)', 'execute') as ok`,
  );
  expect(grant.ok).toBe(true);
});

test("the dictionary endpoint serves the registry's options, and follows a retirement", async ({ page }) => {
  await signIn(page, USERS.admin);
  const before = await dictionary(page);
  const fuel = before.find((f) => f.key === "cooking_fuel_source");
  expect(fuel?.type).toBe("select");
  expect(fuel?.options).toEqual([
    { value: "collect", label: "Collect it" },
    { value: "purchase", label: "Purchase it" },
  ]);
  const stove = before.find((f) => f.key === "previous_stove_type");
  expect(stove?.options?.map((o) => o.value)).toEqual(["firewood", "charcoal", "lpg"]);

  const semi = await valueRow("cooking_location", "semi_indoor");
  try {
    const r = await callEdgeFunction(page, "data-center-admin", {
      action: "option_value_upsert",
      value: { listKey: "cooking_location", id: semi.id, label: "Semi-indoor", sortOrder: 3, isActive: false },
    });
    expect(r.status, JSON.stringify(r.body).slice(0, 200)).toBe(200);
    const after = await dictionary(page);
    expect(after.find((f) => f.key === "cooking_location")?.options?.map((o) => o.value)).toEqual(["indoor", "outdoor"]);
  } finally {
    await callEdgeFunction(page, "data-center-admin", {
      action: "option_value_upsert",
      value: { listKey: "cooking_location", id: semi.id, label: "Semi-indoor", sortOrder: 3, isActive: true },
    }).catch(() => {});
  }
});

test("create-sale maps what it is sent onto the lists and keeps the words", async ({ page }) => {
  await signIn(page, USERS.admin);
  const stoves = await callEdgeFunction(page, "data-center-read", { action: "partner_stoves", organizationId: TWIN_A, limit: 100 });
  const free = ((stoves.body as { data?: { stoves?: { stove_id: string; sale_id: string | null }[] } }).data?.stoves ?? []).filter((s) => !s.sale_id);
  expect(free.length, "two free stoves of the twin partner").toBeGreaterThanOrEqual(2);
  const [partner] = await branchSql<{ partner_name: string }>(`select partner_name from public.organizations where id = '${TWIN_A}'`);
  const stamp = String(Date.now()).slice(-8);

  const make = (stove: string, n: number, extra: Record<string, unknown>) =>
    callEdgeFunction(page, "create-sale", {
      transactionId: `${MARKER}-${stamp}-${n}`,
      stoveSerialNo: stove,
      organizationId: TWIN_A,
      partnerName: partner.partner_name,
      salesDate: "2026-06-01",
      amount: 25000,
      endUserFirstName: "Options",
      endUserSurname: `Spec${n}`,
      // Eleven digits, unique per run and per sale.
      phone: `081${stamp.slice(0, 7)}${n}`,
      contactPerson: "Options Spec",
      contactPhone: `081${stamp.slice(0, 7)}${n}`,
      salesAgentName: "Bala Sani",
      stateBackup: "Kogi",
      lgaBackup: "Lokoja",
      termsAccepted: { poaGoverned: true, monitoring: true, noResell: true, emissionReductions: true, noExport: true, demonstration: true },
      addressData: { fullAddress: `${MARKER} Road ${n}`, state: "Kogi", city: "Lokoja" },
      ...extra,
    });

  const a = await make(free[0].stove_id, 1, { cookingFuelSource: "Local market", cookingLocation: "kitchen", previousStoveType: "wood_stove" });
  expect([200, 201], JSON.stringify(a.body).slice(0, 300)).toContain(a.status);
  const b = await make(free[1].stove_id, 2, { cookingFuelSource: "xyz", cookingLocation: "Outdoor", previousStoveType: "Charcoal" });
  expect([200, 201], JSON.stringify(b.body).slice(0, 300)).toContain(b.status);

  const rows = await branchSql<{ tx: string; fuel: string | null; fuel_note: string | null; loc: string | null; loc_note: string | null; stove: string | null }>(
    `select transaction_id as tx, cooking_fuel_source as fuel, cooking_fuel_source_note as fuel_note,
            cooking_location as loc, cooking_location_note as loc_note, previous_stove_type as stove
       from public.sales where transaction_id like '${MARKER}-${stamp}-%' order by transaction_id`,
  );
  expect(rows.map((r) => [r.fuel, r.fuel_note, r.loc, r.loc_note, r.stove])).toEqual([
    ["purchase", "Local market", "indoor", "kitchen", "firewood"],
    [null, "xyz", "outdoor", null, "charcoal"],
  ]);
});

test("no live sale carries a value outside its list", async () => {
  const [bad] = await branchSql<{ n: string }>(
    `select count(*)::text as n from public.sales s
      where s.cancelled_at is null and (
        (s.cooking_fuel_source is not null and s.cooking_fuel_source not in (select value from data_center.option_values where list_key = 'fuel_source'))
        or (s.cooking_location is not null and s.cooking_location not in (select value from data_center.option_values where list_key = 'cooking_location'))
        or (s.previous_stove_type is not null and s.previous_stove_type not in (select value from data_center.option_values where list_key = 'baseline_stove')))`,
  );
  expect(Number(bad.n)).toBe(0);
});

test("the bench offers the lists and asks the payment type on its own", async ({ page }) => {
  await signIn(page, USERS.admin);
  await page.goto("/data-center/import");
  await expect(page.getByRole("heading", { name: "Bulk Import" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: /One receipt at a time/ }).click();
  await expect(page.locator("tbody tr").first()).toBeVisible({ timeout: 30_000 });
  await page.getByPlaceholder("Search by name").fill("Twin Name Partner");
  await page.locator("tbody tr", { hasText: "Twin Name Partner" }).filter({ hasText: "Kogi" }).first().click();
  await expect(page.getByText(/all consignments/).first()).toBeVisible({ timeout: 30_000 });
  await page.locator("tbody tr").first().click();
  await expect(page.locator("#wb-endUserName")).toBeVisible({ timeout: 30_000 });

  const fuel = page.getByLabel("Fuel source", { exact: true });
  await expect(fuel).toBeVisible();
  expect(await fuel.locator("option").allTextContents()).toEqual(expect.arrayContaining(["Collect it", "Purchase it"]));
  const location = page.getByLabel("Cooking location", { exact: true });
  expect(await location.locator("option").allTextContents()).toEqual(expect.arrayContaining(["Indoor", "Outdoor", "Semi-indoor"]));
  expect(await page.getByRole("radio", { name: /Firewood|Charcoal|LPG/ }).count()).toBe(3);
  // The label carries a required mark, so the control is found by its id.
  const type = page.locator("#wb-paymentType");
  await expect(type).toBeVisible();
  expect(await type.locator("option").allTextContents()).toEqual(expect.arrayContaining(["Cash purchase", "Installment purchase"]));
});

test("the sheet's dropdowns carry the registry's labels", async ({ page }) => {
  await signIn(page, USERS.admin);
  const sheet = await callEdgeFunction(page, "data-center-read", { action: "digitisation_sheet", organizationId: TWIN_A });
  expect(sheet.status).toBe(200);
  const columns = (sheet.body as { data: { columns: { field: string; options?: string[] }[] } }).data.columns;
  expect(columns.find((c) => c.field === "cookingFuelSource")?.options).toEqual(["Collect it", "Purchase it"]);
  expect(columns.find((c) => c.field === "cookingLocation")?.options).toEqual(["Indoor", "Outdoor", "Semi-indoor"]);
  expect(columns.find((c) => c.field === "previousStoveType")?.options).toEqual(["Firewood", "Charcoal", "LPG"]);
});

test("Settings says which questions use a list", async ({ page }) => {
  await signIn(page, USERS.admin);
  const r = await callEdgeFunction(page, "data-center-admin", { action: "registry_read" });
  expect(r.status).toBe(200);
  const lists = (r.body as { data: { lists: { key: string; usedBy?: { source: string; label: string }[] }[] } }).data.lists;
  const baseline = lists.find((l) => l.key === "baseline_stove");
  expect(baseline?.usedBy?.map((u) => u.label)).toEqual(expect.arrayContaining(["Baseline stove"]));
  expect(baseline?.usedBy?.some((u) => u.source === "call_form")).toBe(true);
  expect(baseline?.usedBy?.some((u) => u.source === "sale")).toBe(true);
});

test("the Complete card's breakdown has a bucket per dated rule", async ({ page }) => {
  await signIn(page, USERS.admin);
  const run = await callEdgeFunction(page, "data-center-compute", { action: "run" });
  expect(run.status, JSON.stringify(run.body).slice(0, 200)).toBe(200);
  const rows = await branchSql<{ field: string }>(
    `select dimension ->> 'field' as field from data_center.metric_snapshots
      where metric_key = 'sales.incomplete_by_missing'
        and run_id = (select id from data_center.metric_runs order by started_at desc limit 1)`,
  );
  expect(rows.map((r) => r.field)).toEqual(expect.arrayContaining(["city", "evidence", "phone"]));
});
