import { test, expect } from "@playwright/test";
import { signIn, USERS, branchSql, callEdgeFunction, getEdgeFunction } from "./helpers";

/**
 * "Mandatory" carries a date, and one table says which (A5, D29, slice F3a).
 *
 * public.sale_field_rules holds, per field, the date from which a sale must
 * carry it. The sales app's status rule and the module's completeness rule
 * both read it; the dictionary endpoint serves its dates to the phone app;
 * the bench refuses a new receipt without a field the rules require for its
 * date; create-sale accepts such a sale and the status says incomplete.
 * Moving a date is configuration: nothing is deployed between two verdicts.
 *
 * Red on main: the table does not exist, the admin action is unknown, the
 * status function carries a hard-coded list, and the bench takes a receipt
 * without a city.
 */

test.describe.configure({ timeout: 240_000 });

const TWIN_A = "a0000000-0000-4000-8000-00000000000a";
const RULE = "city";
const MARKER = "RULES-SPEC";

async function ruleDate(field: string): Promise<string | null> {
  const [r] = await branchSql<{ d: string }>(
    `select mandatory_from::text as d from public.sale_field_rules where field_key = '${field}'`,
  );
  return r?.d ?? null;
}

async function setRule(page: import("@playwright/test").Page, field: string, date: string) {
  const r = await callEdgeFunction(page, "data-center-admin", {
    action: "field_rule_set",
    rule: { fieldKey: field, mandatoryFrom: date },
  });
  expect(r.status, `field_rule_set answered ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`).toBe(200);
}

/** A live sale the baseline rule already accepts, with an address row to edit. */
async function acceptedSale(): Promise<{ id: string; addressId: string; status: string; city: string | null; salesDate: string }> {
  const [row] = await branchSql<{ id: string; address_id: string; status: string; city: string | null; d: string }>(
    `select s.id::text as id, s.address_id::text as address_id, s.status, a.city, s.sales_date::text as d
       from public.sales s
       join public.addresses a on a.id = s.address_id
      where s.cancelled_at is null and s.status in ('pending', 'completed')
      order by s.created_at
      limit 1`,
  );
  expect(row, "a live sale the baseline rule accepts").toBeTruthy();
  return { id: row.id, addressId: row.address_id, status: row.status, city: row.city, salesDate: row.d };
}

async function resave(saleId: string): Promise<string> {
  const [r] = await branchSql<{ status: string }>(
    `update public.sales set updated_at = now() where id = '${saleId}' returning status`,
  );
  return r.status;
}

test("the rules table exists, seeded with dated rows and no contact pair", async () => {
  const rows = await branchSql<{ field_key: string; d: string; applies_to: string }>(
    `select field_key, mandatory_from::text as d, array_to_string(applies_to, ',') as applies_to
       from public.sale_field_rules order by field_key`,
  );
  const byKey = Object.fromEntries(rows.map((r) => [r.field_key, r]));
  expect(Object.keys(byKey)).toEqual(
    expect.arrayContaining(["lga_backup", "full_address", "city", "end_user_surname", "sales_agent_name", "pot_quantity", "cooking_fuel_source"]),
  );
  // The form's own rule since the form existed: the sales app only.
  expect(byKey.lga_backup.d).toBe("2000-01-01");
  expect(byKey.lga_backup.applies_to).toBe("sales_app");
  // Four months out, read by both rules.
  expect(byKey.pot_quantity.d).toBe("2027-01-05");
  expect(byKey.pot_quantity.applies_to).toContain("data_center");
  // Go-live is a date after every live sale, never the start of the year.
  expect(byKey.city.d >= "2026-09-06", `city is mandatory from ${byKey.city.d}`).toBe(true);
  // Optional since A4.
  expect(byKey.contact_person).toBeUndefined();
  expect(byKey.contact_phone).toBeUndefined();
  const [rls] = await branchSql<{ on: string }>(
    `select relrowsecurity::text as "on" from pg_class where oid = 'public.sale_field_rules'::regclass`,
  );
  expect(rls.on).toBe("true");
});

test("the status rule judges a sale by the rule of its day, and follows a moved date", async ({ page }) => {
  await signIn(page, USERS.admin);
  const sale = await acceptedSale();
  const before = await ruleDate(RULE);
  expect(before, "the city rule exists").toBeTruthy();
  try {
    await branchSql(`update public.addresses set city = null where id = '${sale.addressId}'`);
    // The rule's date is after the sale: the sale is judged by the old rule.
    await setRule(page, RULE, "2099-01-01");
    expect(await resave(sale.id)).toBe(sale.status);
    // The rule's date moves before the sale: the same row now wants a city.
    await setRule(page, RULE, "2020-01-01");
    expect(await resave(sale.id)).toBe("incomplete");
    // Back again, nothing deployed in between.
    await setRule(page, RULE, "2099-01-01");
    expect(await resave(sale.id)).toBe(sale.status);
  } finally {
    await setRule(page, RULE, before!).catch(() => {});
    await branchSql(
      `update public.addresses set city = ${sale.city === null ? "null" : `'${sale.city.replace(/'/g, "''")}'`} where id = '${sale.addressId}'`,
    ).catch(() => {});
    await resave(sale.id).catch(() => {});
  }
});

test("the module's completeness rule carries the dated clauses and still runs", async () => {
  const [p] = await branchSql<{ p: string }>(`select data_center.completeness_predicate('s') as p`);
  expect(p.p).toMatch(/s\.sales_date::date < '2027-01-05'/);
  expect(p.p).toContain("pot_quantity");
  // The baseline stays the module's own six fields: LGA is not in it.
  expect(p.p).not.toContain("lga_backup");
  const [n] = await branchSql<{ n: string }>(`select count(*)::text as n from public.sales s where ${p.p}`);
  expect(Number(n.n)).toBeGreaterThanOrEqual(0);
});

test("the dictionary endpoint serves the table's dates, and follows a change", async ({ page }) => {
  await signIn(page, USERS.admin);
  const before = await ruleDate(RULE);
  try {
    const first = await getEdgeFunction(page, "sale-dictionary");
    expect(first.status).toBe(200);
    const fields = (first.body as { fields: { key: string; mandatoryFrom: string | null }[] }).fields;
    expect(fields.find((f) => f.key === RULE)?.mandatoryFrom).toBe(before);
    await setRule(page, RULE, "2030-02-03");
    const second = await getEdgeFunction(page, "sale-dictionary");
    const moved = (second.body as { fields: { key: string; mandatoryFrom: string | null }[] }).fields;
    expect(moved.find((f) => f.key === RULE)?.mandatoryFrom).toBe("2030-02-03");
  } finally {
    await setRule(page, RULE, before!).catch(() => {});
  }
});

test("the bench refuses a receipt without a field the rules require for its date", async ({ page }) => {
  await signIn(page, USERS.admin);
  const before = await ruleDate(RULE);
  try {
    await setRule(page, RULE, "2020-01-01");
    await page.goto("/data-center/import");
    await expect(page.getByRole("heading", { name: "Bulk Import" })).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: /One receipt at a time/ }).click();
    await expect(page.locator("tbody tr").first()).toBeVisible({ timeout: 30_000 });
    await page.getByPlaceholder("Search by name").fill("Twin Name Partner");
    await page.locator("tbody tr", { hasText: "Twin Name Partner" }).filter({ hasText: "Kogi" }).first().click();
    await expect(page.getByText(/all consignments/).first()).toBeVisible({ timeout: 30_000 });
    await page.locator("tbody tr").first().click();
    await expect(page.locator("#wb-endUserName")).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Save as finished" }).click();
    await expect(page.getByText(/City\/town\/village is required/)).toBeVisible({ timeout: 15_000 });
  } finally {
    await setRule(page, RULE, before!).catch(() => {});
  }
});

test("create-sale accepts a sale without a dated field, and the status says incomplete", async ({ page }) => {
  await signIn(page, USERS.admin);
  const before = await ruleDate(RULE);
  const stoves = await callEdgeFunction(page, "data-center-read", { action: "partner_stoves", organizationId: TWIN_A, limit: 100 });
  const free = ((stoves.body as { data?: { stoves?: { stove_id: string; sale_id: string | null }[] } }).data?.stoves ?? []).find((s) => !s.sale_id);
  expect(free, "a free stove of the twin partner").toBeTruthy();
  const [partner] = await branchSql<{ partner_name: string }>(`select partner_name from public.organizations where id = '${TWIN_A}'`);
  const phone = `080${String(Date.now()).slice(-8)}`;
  try {
    await setRule(page, RULE, "2020-01-01");
    const created = await callEdgeFunction(page, "create-sale", {
      transactionId: `${MARKER}-${Date.now()}`,
      stoveSerialNo: free!.stove_id,
      organizationId: TWIN_A,
      partnerName: partner.partner_name,
      salesDate: "2026-06-01",
      amount: 25000,
      endUserFirstName: "Rules",
      endUserSurname: "Spec",
      // A phone is unique across sales, so each run brings its own.
      phone,
      contactPerson: "Rules Spec",
      contactPhone: phone,
      salesAgentName: "Bala Sani",
      stateBackup: "Kogi",
      lgaBackup: "Lokoja",
      termsAccepted: { poaGoverned: true, monitoring: true, noResell: true, emissionReductions: true, noExport: true, demonstration: true },
      // No city: the rule wants one, the server still takes the sale.
      addressData: { fullAddress: `${MARKER} Road`, state: "Kogi" },
    });
    expect([200, 201], `create-sale answered ${created.status}: ${JSON.stringify(created.body).slice(0, 300)}`).toContain(created.status);
    const saleId = (created.body as { data?: { id?: string } }).data?.id;
    expect(saleId).toBeTruthy();
    expect((created.body as { status?: string }).status, "the response carries the trigger's verdict").toBe("incomplete");
    const [row] = await branchSql<{ status: string }>(`select status from public.sales where id = '${saleId}'`);
    expect(row.status).toBe("incomplete");
    // Give it the city and the verdict lifts on the next save.
    await branchSql(`update public.addresses set city = 'Lokoja' where id = (select address_id from public.sales where id = '${saleId}')`);
    expect(await resave(saleId!)).not.toBe("incomplete");
  } finally {
    await setRule(page, RULE, before!).catch(() => {});
  }
});
