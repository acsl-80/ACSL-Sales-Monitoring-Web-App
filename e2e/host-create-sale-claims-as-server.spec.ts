import { test, expect, type Page } from "@playwright/test";
import { signIn, USERS, branchSql, callEdgeFunction } from "./helpers";

/**
 * create-sale claims the stove as the server (D62).
 *
 * Since 2026-09-24 stove rows are written by the server only: signed-in users
 * lost UPDATE on stove_ids. create-sale claimed the stove on a client that
 * forwards the caller's login, so every sale made by a signed-in person, which
 * is every sale, failed at the claim with "Failed to update stove_ids", and the
 * sale it had just inserted stayed behind without a stove.
 *
 * The first test is the whole outage: a signed-in seller's sale goes through
 * and its stove is claimed. The second forces a claim to fail, with a trigger
 * that refuses one stove only and is removed afterwards, and asserts the sale
 * is undone rather than left standing.
 */

const TAG = "E2ECLAIM";
/** The partner seeded with free stoves on every preview branch. */
const TWIN_A = "a0000000-0000-4000-8000-00000000000a";
const REFUSE_FN = "zz_spec_refuse_claim";

const spent = new Set<string>();

async function freeStove(page: Page): Promise<string> {
  const stoves = await callEdgeFunction(page, "data-center-read", {
    action: "partner_stoves",
    organizationId: TWIN_A,
    limit: 100,
  });
  expect(stoves.status, JSON.stringify(stoves.body)).toBe(200);
  const free = (
    (stoves.body as { data?: { stoves?: { stove_id: string; sale_id: string | null }[] } }).data
      ?.stoves ?? []
  ).find((s) => !s.sale_id && !spent.has(s.stove_id))?.stove_id;
  expect(free, "a free stove of the twin partner to sell").toBeTruthy();
  spent.add(free!);
  return free!;
}

async function partnerName(): Promise<string> {
  const [org] = await branchSql<{ name: string }>(
    `select partner_name as name from public.organizations where id = '${TWIN_A}'`,
  );
  expect(org?.name, "the twin partner is seeded").toBeTruthy();
  return org.name;
}

function saleBody(serial: string, partner: string, transactionId: string) {
  return {
    transactionId,
    stoveSerialNo: serial,
    organizationId: TWIN_A,
    partnerName: partner,
    salesDate: "2026-09-15",
    amount: 25000,
    endUserFirstName: "Claim",
    endUserSurname: "Server",
    phone: "08012345671",
    contactPerson: "Claim Server",
    contactPhone: "08012345671",
    salesAgentName: "Bala Sani",
    termsAccepted: {
      poaGoverned: true, monitoring: true, noResell: true,
      emissionReductions: true, noExport: true, demonstration: true,
    },
    addressData: { fullAddress: `${TAG} Claim Road`, state: "Kogi", city: "Lokoja" },
  };
}

test.afterAll(async () => {
  // The trigger first, whatever else happened, so a failed run cannot leave a
  // refused stove behind on the sandbox. Then stock, then sales, then addresses,
  // in the order the check constraint on stock allows.
  await branchSql(`drop trigger if exists ${REFUSE_FN} on public.stove_ids_base`).catch(() => {});
  await branchSql(`drop function if exists public.${REFUSE_FN}()`).catch(() => {});
  const mine = `select id from public.sales where transaction_id like '${TAG}-%'`;
  await branchSql(
    `update public.stove_ids_base set status = 'available', sale_id = null where sale_id in (${mine})`,
  ).catch(() => {});
  await branchSql(`delete from public.sales where transaction_id like '${TAG}-%'`).catch(() => {});
  await branchSql(`delete from public.addresses where full_address like '${TAG}%'`).catch(() => {});
});

test("a signed-in seller's sale goes through and claims its stove", async ({ page }) => {
  await signIn(page, USERS.admin);
  const serial = await freeStove(page);
  const transactionId = `${TAG}-${Date.now()}`;

  const made = await callEdgeFunction(page, "create-sale", saleBody(serial, await partnerName(), transactionId));
  expect(
    [200, 201],
    `create-sale answered ${made.status}: ${JSON.stringify(made.body)}`,
  ).toContain(made.status);
  const saleId = (made.body as { data?: { id?: string } }).data?.id;
  expect(saleId, "create-sale named the sale it made").toBeTruthy();

  const [stove] = await branchSql<{ status: string; sale_id: string | null }>(
    `select status, sale_id::text from public.stove_ids_base where stove_id = '${serial}'`,
  );
  expect(stove?.status, "the stove is sold").toBe("sold");
  expect(stove?.sale_id, "and it names the sale that claimed it").toBe(saleId);
});

test("a claim that fails leaves no sale behind", async ({ page }) => {
  await signIn(page, USERS.admin);
  const serial = await freeStove(page);
  const transactionId = `${TAG}-${Date.now()}`;

  // Refuses the claim on this one stove and nothing else.
  await branchSql(
    `create or replace function public.${REFUSE_FN}() returns trigger language plpgsql as $f$
     begin
       if new.stove_id = '${serial}' and new.status = 'sold' then
         raise exception 'spec: this claim is refused on purpose';
       end if;
       return new;
     end $f$`,
  );
  await branchSql(
    `create trigger ${REFUSE_FN} before update on public.stove_ids_base
       for each row execute function public.${REFUSE_FN}()`,
  );
  try {
    const made = await callEdgeFunction(
      page,
      "create-sale",
      saleBody(serial, await partnerName(), transactionId),
    );
    expect(made.status, JSON.stringify(made.body)).toBe(500);

    const left = await branchSql<{ n: number }>(
      `select count(*)::int as n from public.sales where transaction_id = '${transactionId}'`,
    );
    expect(left[0]?.n, "the sale whose stove was not claimed is undone").toBe(0);
    const [stove] = await branchSql<{ status: string }>(
      `select status from public.stove_ids_base where stove_id = '${serial}'`,
    );
    expect(stove?.status, "the stove is still free to sell").not.toBe("sold");
  } finally {
    await branchSql(`drop trigger if exists ${REFUSE_FN} on public.stove_ids_base`).catch(() => {});
    await branchSql(`drop function if exists public.${REFUSE_FN}()`).catch(() => {});
  }
});
