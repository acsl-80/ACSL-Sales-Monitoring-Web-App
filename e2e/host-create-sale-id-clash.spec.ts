import { test, expect, type Page } from "@playwright/test";
import { signIn, USERS, branchSql, callEdgeFunction } from "./helpers";

/**
 * A transaction ID that is already taken.
 *
 * The phone app builds its IDs from the clock alone, so only 2,160 different
 * ones exist and they repeat. When a sale for a different stove arrived under
 * a taken ID, create-sale answered 409 "transaction ID ... already exists",
 * which the app reads as "already saved": the sale was dropped from the
 * phone's queue and never saved.
 *
 * The rule now: the same stove under the same ID is a retry and keeps the 409.
 * A different stove under a taken ID is saved under a fresh ID, named in the
 * reply. Sending that sale again with its old ID is recognised as the same sale
 * (same stove, same seller, same phone) and gets the 409, so the phone clears
 * it rather than showing "stove already sold" for a sale that saved.
 */

const TAG = "E2ECLASH";
/** The partner seeded with free stoves on every preview branch. */
const TWIN_A = "a0000000-0000-4000-8000-00000000000a";

const spent = new Set<string>();
/** Fresh IDs the server issued, which do not carry the tag. */
const issued = new Set<string>();

type Reply = {
  success?: boolean;
  message?: string;
  data?: { id?: string };
  transaction_id?: string;
  transaction_id_sent?: string;
};

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

/** A phone of its own per sale, so the buyer rule never steps in. */
function phoneFor(seed: number): string {
  return `0802${String(seed).slice(-7).padStart(7, "0")}`;
}

function saleBody(serial: string, partner: string, transactionId: string, phone: string, surname: string) {
  return {
    transactionId,
    stoveSerialNo: serial,
    organizationId: TWIN_A,
    partnerName: partner,
    salesDate: "2026-10-20",
    amount: 25000,
    endUserFirstName: "Clash",
    endUserSurname: surname,
    phone,
    contactPerson: `Clash ${surname}`,
    contactPhone: phone,
    salesAgentName: "Bala Sani",
    termsAccepted: {
      poaGoverned: true, monitoring: true, noResell: true,
      emissionReductions: true, noExport: true, demonstration: true,
    },
    addressData: { fullAddress: `${TAG} Clash Road`, state: "Kogi", city: "Lokoja" },
  };
}

async function salesUnder(transactionId: string): Promise<number> {
  const [row] = await branchSql<{ n: number }>(
    `select count(*)::int as n from public.sales where transaction_id = '${transactionId}'`,
  );
  return row?.n ?? 0;
}

async function salesOfStove(serial: string): Promise<number> {
  const [row] = await branchSql<{ n: number }>(
    `select count(*)::int as n from public.sales where stove_serial_no = '${serial}'`,
  );
  return row?.n ?? 0;
}

test.afterAll(async () => {
  const ids = [...issued].map((t) => `'${t}'`);
  const mine =
    `select id from public.sales where transaction_id like '${TAG}-%'` +
    (ids.length ? ` or transaction_id in (${ids.join(",")})` : "");
  await branchSql(
    `update public.stove_ids_base set status = 'available', sale_id = null where sale_id in (${mine})`,
  ).catch(() => {});
  await branchSql(`delete from public.sales where id in (${mine})`).catch(() => {});
  await branchSql(`delete from public.addresses where full_address like '${TAG}%'`).catch(() => {});
});

test("a taken ID: a retry is answered as saved, a different stove saves under a fresh ID", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, USERS.admin);
  const partner = await partnerName();
  const seed = Date.now();
  const taken = `${TAG}-${seed}`;

  // The first sale takes the ID.
  const stoveA = await freeStove(page);
  const bodyA = saleBody(stoveA, partner, taken, phoneFor(seed), "First");
  const first = await callEdgeFunction(page, "create-sale", bodyA);
  expect([200, 201], `first sale: ${first.status} ${JSON.stringify(first.body)}`).toContain(first.status);
  expect((first.body as Reply).transaction_id, "the reply names the ID it saved under").toBe(taken);

  // The same stove again under the same ID is a retry: 409, nothing new saved.
  const retry = await callEdgeFunction(page, "create-sale", bodyA);
  expect(retry.status, JSON.stringify(retry.body)).toBe(409);
  expect((retry.body as Reply).message ?? "").toMatch(/transaction id/i);
  expect((retry.body as Reply).message ?? "").toMatch(/already exists/i);
  expect(await salesUnder(taken), "the retry saved nothing").toBe(1);

  // A different stove under the taken ID is a clash: it saves, under a fresh ID.
  const stoveB = await freeStove(page);
  const bodyB = saleBody(stoveB, partner, taken, phoneFor(seed + 1), "Second");
  const clash = await callEdgeFunction(page, "create-sale", bodyB);
  expect([200, 201], `clash: ${clash.status} ${JSON.stringify(clash.body)}`).toContain(clash.status);
  const reply = clash.body as Reply;
  expect(reply.data?.id, "the clash saved a sale").toBeTruthy();
  expect(reply.transaction_id_sent, "the reply names the ID that was sent").toBe(taken);
  expect(reply.transaction_id, "and the fresh one it saved under").toMatch(/^[A-Z0-9]{6}$/);
  expect(reply.transaction_id).not.toBe(taken);
  issued.add(reply.transaction_id!);

  expect(await salesUnder(taken), "the taken ID still holds one sale").toBe(1);
  expect(await salesUnder(reply.transaction_id!), "the fresh ID holds the second").toBe(1);
  const [stove] = await branchSql<{ status: string; sale_id: string | null }>(
    `select status, sale_id::text from public.stove_ids_base where stove_id = '${stoveB}'`,
  );
  expect(stove?.status, "the second stove is sold").toBe("sold");
  expect(stove?.sale_id).toBe(reply.data?.id);

  // The phone sends that sale again with its old ID: answered as saved.
  const resend = await callEdgeFunction(page, "create-sale", bodyB);
  expect(resend.status, JSON.stringify(resend.body)).toBe(409);
  expect((resend.body as Reply).message ?? "").toMatch(/transaction id/i);
  expect((resend.body as Reply).message ?? "").toMatch(/already exists/i);
  expect(await salesOfStove(stoveB), "the resend saved nothing").toBe(1);
});
