import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { signIn, USERS, branchSql, callEdgeFunction } from "./helpers";

/**
 * The external API's second shape carries the Stove DB's names, word for word
 * (A10, D29; slice F4).
 *
 * Both outside doors, get-sales-advanced (a signed-in user) and
 * end-user-records-api (the API key), answer `stove_db` with one object per
 * sale whose keys are exactly the dictionary's Stove DB names: "Sales date",
 * "Serial number", "User surname", "User firstname" and the rest, values from
 * the columns the record holds, choices as their labels, CPA as the six
 * consents. The shapes they served before stay as they were, except that
 * format1 stops guessing the name split and fills cpa. The docs page shows the
 * three shapes from the dictionary.
 *
 * Red on main: no stove_db shape on either door, a guessed split and an empty
 * cpa on format1, no Stove DB column on the docs page.
 */

test.describe.configure({ timeout: 240_000 });

const TWIN_A = "a0000000-0000-4000-8000-00000000000a";
const MARKER = "SHAPE-SPEC";

type Field = { key: string; stoveDbName: string | null; column: string; table: string };
const DICTIONARY = JSON.parse(
  readFileSync(fileURLToPath(new URL("../supabase/functions/_shared/sale-dictionary.json", import.meta.url)), "utf-8"),
) as { fields: Field[] };
const STOVE_DB_NAMES = DICTIONARY.fields.map((f) => f.stoveDbName).filter((n): n is string => Boolean(n));

test.afterAll(async () => {
  await branchSql(
    `update public.stove_ids_base set status = 'available', sale_id = null
      where sale_id in (select id from public.sales where transaction_id like '${MARKER}-%')`,
  ).catch(() => {});
  await branchSql(`delete from public.sales where transaction_id like '${MARKER}-%'`).catch(() => {});
  await branchSql(`delete from public.addresses where full_address like '${MARKER}%'`).catch(() => {});
});

/** One sale of our own, so the values asserted are known. */
async function ownSale(page: import("@playwright/test").Page): Promise<{ id: string; serial: string; tx: string }> {
  const stoves = await callEdgeFunction(page, "data-center-read", { action: "partner_stoves", organizationId: TWIN_A, limit: 100 });
  const free = ((stoves.body as { data?: { stoves?: { stove_id: string; sale_id: string | null }[] } }).data?.stoves ?? []).find((s) => !s.sale_id);
  expect(free, "a free stove of the twin partner").toBeTruthy();
  const [partner] = await branchSql<{ partner_name: string }>(`select partner_name from public.organizations where id = '${TWIN_A}'`);
  const stamp = String(Date.now()).slice(-8);
  const tx = `${MARKER}-${stamp}`;
  const created = await callEdgeFunction(page, "create-sale", {
    transactionId: tx,
    stoveSerialNo: free!.stove_id,
    organizationId: TWIN_A,
    partnerName: partner.partner_name,
    salesDate: "2026-06-01",
    amount: 25000,
    // Two words in the first name: the old guess would have split them.
    endUserFirstName: "Mary Jane",
    endUserSurname: "Okoro",
    phone: `082${stamp}`,
    contactPerson: "Mary Jane Okoro",
    contactPhone: `082${stamp}`,
    otherPhone: `083${stamp}`,
    salesAgentName: "Bala Sani",
    retailerBranch: "Lokoja branch",
    stateBackup: "Kogi",
    lgaBackup: "Lokoja",
    potQuantity: 2,
    heatRetentionDevice: true,
    previousStoveType: "charcoal",
    cookingFuelSource: "purchase",
    cookingLocation: "indoor",
    termsAccepted: { poaGoverned: true, monitoring: true, noResell: true, emissionReductions: true, noExport: true, demonstration: true },
    addressData: { fullAddress: `${MARKER} Road`, state: "Kogi", city: "Lokoja" },
  });
  expect([200, 201], JSON.stringify(created.body).slice(0, 300)).toContain(created.status);
  const id = (created.body as { data?: { id?: string } }).data?.id;
  expect(id).toBeTruthy();
  return { id: id!, serial: free!.stove_id, tx };
}

function expectStoveDbRow(row: Record<string, unknown>) {
  expect(Object.keys(row).sort()).toEqual([...STOVE_DB_NAMES].sort());
  expect(row["Serial number"]).toBeTruthy();
  expect(row["User firstname"]).toBe("Mary Jane");
  expect(row["User surname"]).toBe("Okoro");
  expect(row["Contact person"]).toBe("Mary Jane Okoro");
  expect(row["Sales agent"]).toBe("Bala Sani");
  expect(row["Sales branch"]).toBe("Lokoja branch");
  expect(row["Number of Pots"]).toBe(2);
  expect(row["Wonderbox"]).toBe(true);
  // Choices travel as the words the agreement uses.
  expect(row["Baseline stove"]).toBe("Charcoal");
  expect(row["Fuel source"]).toBe("Purchase it");
  expect(row["LGA"]).toBe("Lokoja");
  expect(row["State"]).toBe("Kogi");
  expect(row["Sales date"]).toBe("2026-06-01");
  // CPA is the six consents (D27).
  expect(row["CPA"]).toEqual({ poaGoverned: true, monitoring: true, noResell: true, emissionReductions: true, noExport: true, demonstration: true });
}

test("get-sales-advanced answers stove_db with the Stove DB names, word for word", async ({ page }) => {
  await signIn(page, USERS.admin);
  const sale = await ownSale(page);
  const r = await callEdgeFunction(page, "get-sales-advanced", { responseFormat: "stove_db", stoveSerialNo: sale.serial, limit: 5 });
  expect(r.status, JSON.stringify(r.body).slice(0, 200)).toBe(200);
  const body = r.body as { responseFormat: string; data: Record<string, unknown>[] };
  expect(body.responseFormat).toBe("stove_db");
  const row = body.data.find((d) => d["Serial number"] === sale.serial);
  expect(row, "our sale, in the Stove DB shape").toBeTruthy();
  expectStoveDbRow(row!);
});

test("format1 takes the name from its two columns and fills cpa", async ({ page }) => {
  await signIn(page, USERS.admin);
  const sale = await ownSale(page);
  const r = await callEdgeFunction(page, "get-sales-advanced", { responseFormat: "format1", stoveSerialNo: sale.serial, limit: 5 });
  expect(r.status).toBe(200);
  const row = (r.body as { data: Record<string, unknown>[] }).data.find((d) => d.serialNumber === sale.serial);
  expect(row).toBeTruthy();
  expect(row!.userName).toBe("Mary Jane");
  expect(row!.userSurname).toBe("Okoro");
  expect(row!.cpa).toEqual({ poaGoverned: true, monitoring: true, noResell: true, emissionReductions: true, noExport: true, demonstration: true });
});

test("end-user-records-api answers stove_db too, and its own shape carries the new columns", async ({ page }) => {
  await signIn(page, USERS.admin);
  const sale = await ownSale(page);
  const keyResp = await callEdgeFunction(page, "get-end-user-api-key", {});
  expect(keyResp.status, JSON.stringify(keyResp.body).slice(0, 200)).toBe(200);
  const keyBody = keyResp.body as Record<string, unknown>;
  const apiKey = String(keyBody.apiKey ?? keyBody.api_key ?? keyBody.key ?? (keyBody.data as Record<string, unknown> | undefined)?.apiKey ?? "");
  expect(apiKey, "the records API key").toBeTruthy();

  const fetchShape = (format: string | null) =>
    page.evaluate(
      async ({ key, serial, format }) => {
        const supabaseKey = Object.keys(window.localStorage).find((k) => k.startsWith("sb-") && k.endsWith("-auth-token"));
        const ref = (supabaseKey ?? "").replace(/^sb-/, "").replace(/-auth-token$/, "");
        const url = new URL(`https://${ref}.supabase.co/functions/v1/end-user-records-api`);
        url.searchParams.set("stove_serial_no", serial);
        if (format) url.searchParams.set("format", format);
        const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${key}` } });
        return { status: res.status, body: await res.json().catch(() => null) };
      },
      { key: apiKey, serial: sale.serial, format },
    );

  const own = await fetchShape(null);
  expect(own.status, JSON.stringify(own.body).slice(0, 200)).toBe(200);
  const ownRow = (own.body as { data: Record<string, unknown>[] }).data[0];
  expect(ownRow.end_user_first_name).toBe("Mary Jane");
  expect(ownRow.end_user_surname).toBe("Okoro");
  expect(ownRow.selling_agent_name).toBe("Bala Sani");

  const stove = await fetchShape("stove_db");
  expect(stove.status).toBe(200);
  const row = (stove.body as { data: Record<string, unknown>[] }).data[0];
  expectStoveDbRow(row);
});

test("the docs page shows the Stove DB shape beside the two it had", async ({ page }) => {
  await signIn(page, USERS.admin);
  await page.goto("/docs/superadmin");
  await page.getByRole("tab", { name: /Response Formats/ }).click();
  await expect(page.getByText(/stove_db/).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("User surname").first()).toBeVisible();
  await expect(page.getByText("Number of Pots").first()).toBeVisible();
});
