import { test, expect, type Page } from "@playwright/test";
import { signIn, USERS, branchSql, callEdgeFunction } from "./helpers";

/**
 * Deleting a sale frees only that sale's stove.
 *
 * One serial can be held by two partners (stock is unique per serial and
 * partner). delete-sale released the stove by serial alone, so deleting one
 * partner's sale set the other partner's stove back to available as well,
 * though its own sale still stood. It now releases the row linked to the
 * sale, or the serial within the sale's own partner.
 */

const TAG = "E2EDELOWN";
const TWIN_A = "a0000000-0000-4000-8000-00000000000a";
const TWIN_B = "a0000000-0000-4000-8000-00000000000b";

const spent = new Set<string>();
const shared: string[] = [];

async function freeStove(page: Page, org: string): Promise<string> {
  const stoves = await callEdgeFunction(page, "data-center-read", {
    action: "partner_stoves",
    organizationId: org,
    limit: 100,
  });
  expect(stoves.status, JSON.stringify(stoves.body)).toBe(200);
  const free = (
    (stoves.body as { data?: { stoves?: { stove_id: string; sale_id: string | null }[] } }).data
      ?.stoves ?? []
  ).find((s) => !s.sale_id && !spent.has(s.stove_id))?.stove_id;
  expect(free, "a free stove to sell").toBeTruthy();
  spent.add(free!);
  return free!;
}

async function sell(page: Page, org: string, serial: string, seed: number): Promise<string> {
  const [o] = await branchSql<{ name: string }>(
    `select partner_name as name from public.organizations where id = '${org}'`,
  );
  const phone = `0806${String(seed).slice(-7).padStart(7, "0")}`;
  const made = await callEdgeFunction(page, "create-sale", {
    transactionId: `${TAG}-${seed}`,
    stoveSerialNo: serial,
    organizationId: org,
    partnerName: o.name,
    salesDate: "2026-10-20",
    amount: 25000,
    amountReceived: 25000,
    endUserFirstName: "Delown",
    endUserSurname: `Buyer${String(seed).slice(-5)}`,
    phone,
    contactPerson: "Delown Contact",
    contactPhone: phone,
    salesAgentName: "Bala Sani",
    termsAccepted: {
      poaGoverned: true, monitoring: true, noResell: true,
      emissionReductions: true, noExport: true, demonstration: true,
    },
    addressData: { fullAddress: `${TAG} ${seed} Road`, state: "Kogi", city: "Lokoja" },
  });
  expect(made.status, JSON.stringify(made.body)).toBe(200);
  return (made.body as { sale_id: string }).sale_id;
}

async function stock(serial: string, org: string) {
  const [row] = await branchSql<{ status: string; sale_id: string | null }>(
    `select status, sale_id::text from public.stove_ids_base where stove_id = '${serial}' and organization_id = '${org}'`,
  );
  return row;
}

test.afterAll(async () => {
  const mine = `select id from public.sales where transaction_id like '${TAG}-%'`;
  await branchSql(
    `update public.stove_ids_base set status = 'available', sale_id = null where sale_id in (${mine})`,
  ).catch(() => {});
  await branchSql(`delete from public.sales where id in (${mine})`).catch(() => {});
  await branchSql(`delete from public.addresses where full_address like '${TAG} %'`).catch(() => {});
  for (const serial of shared) {
    await branchSql(
      `delete from public.stove_ids_base where stove_id = '${serial}' and organization_id = '${TWIN_B}' and factory = '${TAG}'`,
    ).catch(() => {});
  }
});

test("deleting one partner's sale leaves the other partner's sold stove sold", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, USERS.admin);
  const seed = Date.now();

  // One serial at both partners: Twin A's own, and a copy placed at Twin B.
  const serial = await freeStove(page, TWIN_A);
  await branchSql(
    `insert into public.stove_ids_base (stove_id, organization_id, status, factory)
     values ('${serial}', '${TWIN_B}', 'available', '${TAG}')`,
  );
  shared.push(serial);

  const saleA = await sell(page, TWIN_A, serial, seed);
  const saleB = await sell(page, TWIN_B, serial, seed + 1);
  expect(await stock(serial, TWIN_A)).toEqual({ status: "sold", sale_id: saleA });
  expect(await stock(serial, TWIN_B)).toEqual({ status: "sold", sale_id: saleB });

  const deleted = await callEdgeFunction(page, "delete-sale", { saleId: saleA });
  expect(deleted.status, JSON.stringify(deleted.body)).toBe(200);

  expect(await stock(serial, TWIN_A), "the deleted sale's stove is free again").toEqual({
    status: "available", sale_id: null,
  });
  expect(await stock(serial, TWIN_B), "the other partner's stove keeps its sale").toEqual({
    status: "sold", sale_id: saleB,
  });
  const [b] = await branchSql<{ n: number }>(`select count(*)::int as n from public.sales where id = '${saleB}'`);
  expect(b.n, "the other partner's sale still stands").toBe(1);
});
