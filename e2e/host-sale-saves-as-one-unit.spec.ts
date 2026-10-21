import { test, expect, type Page } from "@playwright/test";
import { signIn, USERS, branchSql, callEdgeFunction } from "./helpers";

/**
 * A sale saves as one unit.
 *
 * create-sale wrote the buyer's address, the sale, the claim on the stove and
 * the first instalment as four separate requests. A failure partway left the
 * earlier ones behind: an address no sale points to, or a sale reported as
 * saved whose first payment was never recorded while its total_paid counted
 * it. Now one database function writes all four in one transaction, so a
 * failure at any step leaves nothing behind and the stove free to sell.
 *
 * Each step is made to fail on purpose with a trigger that refuses this
 * spec's row and nothing else, the way host-create-sale-claims-as-server
 * does for the claim.
 */

const TAG = "E2EUNIT";
/** The partner seeded with free stoves on every preview branch, unrestricted in models. */
const TWIN_A = "a0000000-0000-4000-8000-00000000000a";
const REFUSE_FN = "e2e_unit_refuse";

const spent = new Set<string>();

type Reply = { success?: boolean; message?: string; sale_id?: string; data?: { id?: string } };

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

async function modelId(): Promise<string> {
  const [m] = await branchSql<{ id: string }>(
    `select id::text from public.payment_models where name = 'Amina Sales Model' and is_active`,
  );
  expect(m?.id, "the Amina model is seeded and active").toBeTruthy();
  return m.id;
}

/** A sale of its own: its own transaction ID, phone and address line. */
function saleBody(serial: string, partner: string, seed: number, extra: Record<string, unknown> = {}) {
  const phone = `0803${String(seed).slice(-7).padStart(7, "0")}`;
  return {
    transactionId: `${TAG}-${seed}`,
    stoveSerialNo: serial,
    organizationId: TWIN_A,
    partnerName: partner,
    salesDate: "2026-10-20",
    amount: 42000,
    amountReceived: 42000,
    endUserFirstName: "Unit",
    endUserSurname: `Buyer${String(seed).slice(-5)}`,
    phone,
    contactPerson: "Unit Contact",
    contactPhone: phone,
    salesAgentName: "Bala Sani",
    termsAccepted: {
      poaGoverned: true, monitoring: true, noResell: true,
      emissionReductions: true, noExport: true, demonstration: true,
    },
    addressData: { fullAddress: `${TAG} ${seed} Unit Road`, state: "Kogi", city: "Lokoja", latitude: 7.8, longitude: 6.7 },
    ...extra,
  };
}

/** What the attempt left behind: sales under its ID, its address rows, its stove's state. */
async function leftBehind(seed: number, serial: string) {
  const [row] = await branchSql<{ sales: number; addresses: number; payments: number; stove: string }>(
    `select
       (select count(*)::int from public.sales where transaction_id = '${TAG}-${seed}') as sales,
       (select count(*)::int from public.addresses where full_address = '${TAG} ${seed} Unit Road') as addresses,
       (select count(*)::int from public.installment_payments ip join public.sales s on s.id = ip.sale_id
         where s.transaction_id = '${TAG}-${seed}') as payments,
       (select status from public.stove_ids_base where stove_id = '${serial}' and organization_id = '${TWIN_A}') as stove`,
  );
  return row;
}

/** Installs a trigger that refuses one row; returns its remover. */
async function refuse(table: string, timing: string, condition: string): Promise<() => Promise<void>> {
  const fn = `${REFUSE_FN}_${table}`;
  await branchSql(
    `create or replace function public.${fn}() returns trigger language plpgsql as $f$
     begin
       if ${condition} then
         raise exception 'spec: refused on purpose';
       end if;
       return new;
     end $f$`,
  );
  await branchSql(`create trigger ${fn} ${timing} on public.${table} for each row execute function public.${fn}()`);
  return async () => {
    await branchSql(`drop trigger if exists ${fn} on public.${table}`).catch(() => {});
    await branchSql(`drop function if exists public.${fn}()`).catch(() => {});
  };
}

test.afterAll(async () => {
  const mine = `select id from public.sales where transaction_id like '${TAG}-%'`;
  await branchSql(
    `update public.stove_ids_base set status = 'available', sale_id = null where sale_id in (${mine})`,
  ).catch(() => {});
  await branchSql(`delete from public.installment_payments where sale_id in (${mine})`).catch(() => {});
  await branchSql(`delete from public.sales where id in (${mine})`).catch(() => {});
  await branchSql(`delete from public.addresses where full_address like '${TAG} %'`).catch(() => {});
});

test.beforeEach(async ({ page }) => {
  await signIn(page, USERS.admin);
});

test("an installment sale saves whole: address, sale, claimed stove and first payment", async ({ page }) => {
  test.setTimeout(90_000);
  const seed = Date.now();
  const serial = await freeStove(page);
  const made = await callEdgeFunction(page, "create-sale", saleBody(serial, await partnerName(), seed, {
    isInstallment: true,
    paymentModelId: await modelId(),
    amountReceived: 5000,
    initialPaymentAmount: 5000,
    initialPaymentMethod: "cash",
  }));
  expect(made.status, JSON.stringify(made.body)).toBe(200);
  const saleId = (made.body as Reply).sale_id;
  expect(saleId, "the reply names the sale").toBeTruthy();
  expect((made.body as Reply).data?.id, "and keeps data.id").toBe(saleId);

  const [sale] = await branchSql<{ total_paid: string; payment_status: string; address: string | null; stove: string; stove_sale: string }>(
    `select s.total_paid::text, s.payment_status, a.full_address as address,
            b.status as stove, b.sale_id::text as stove_sale
       from public.sales s
       left join public.addresses a on a.id = s.address_id
       join public.stove_ids_base b on b.stove_id = s.stove_serial_no and b.organization_id = s.organization_id
      where s.id = '${saleId}'`,
  );
  expect(Number(sale.total_paid)).toBe(5000);
  expect(sale.payment_status).toBe("partially_paid");
  expect(sale.address, "the sale points to its address").toBe(`${TAG} ${seed} Unit Road`);
  expect(sale.stove).toBe("sold");
  expect(sale.stove_sale, "the stove names the sale").toBe(saleId);

  const payments = await branchSql<{ amount: string; method: string; notes: string }>(
    `select amount::text, payment_method as method, notes from public.installment_payments where sale_id = '${saleId}'`,
  );
  expect(payments.length, "one first payment on the ledger").toBe(1);
  expect(Number(payments[0].amount)).toBe(5000);
  expect(payments[0].notes).toBe("Initial down payment");
});

test("an outright sale saves with no ledger row, as before", async ({ page }) => {
  test.setTimeout(90_000);
  const seed = Date.now();
  const serial = await freeStove(page);
  const made = await callEdgeFunction(page, "create-sale", saleBody(serial, await partnerName(), seed));
  expect(made.status, JSON.stringify(made.body)).toBe(200);
  const left = await leftBehind(seed, serial);
  expect(left).toEqual({ sales: 1, addresses: 1, payments: 0, stove: "sold" });
});

test("a first payment the database refuses fails the whole sale", async ({ page }) => {
  // No trigger needed: the ledger accepts cash, transfer or pos only. The old
  // path saved the sale, logged the refused payment and answered 200.
  test.setTimeout(90_000);
  const seed = Date.now();
  const serial = await freeStove(page);
  const made = await callEdgeFunction(page, "create-sale", saleBody(serial, await partnerName(), seed, {
    isInstallment: true,
    paymentModelId: await modelId(),
    amountReceived: 5000,
    initialPaymentAmount: 5000,
    initialPaymentMethod: "cheque",
  }));
  expect(made.status, JSON.stringify(made.body)).toBe(400);
  const message = (made.body as Reply).message ?? "";
  expect(message).toMatch(/first payment could not be recorded/i);
  // Never the phone app's "already saved" wording.
  expect(message).not.toMatch(/transaction id/i);
  expect(await leftBehind(seed, serial)).toEqual({ sales: 0, addresses: 0, payments: 0, stove: "available" });
});

for (const step of ["sale", "claim", "payment", "address"] as const) {
  test(`a failure at the ${step} step leaves nothing behind`, async ({ page }) => {
    test.setTimeout(90_000);
    const seed = Date.now();
    const serial = await freeStove(page);
    const txn = `${TAG}-${seed}`;
    const remove = await {
      address: () => refuse("addresses", "before insert", `new.full_address = '${TAG} ${seed} Unit Road'`),
      sale: () => refuse("sales", "before insert", `new.transaction_id = '${txn}'`),
      claim: () => refuse("stove_ids_base", "before update", `new.stove_id = '${serial}' and new.status = 'sold'`),
      payment: () => refuse(
        "installment_payments", "before insert",
        `exists (select 1 from public.sales s where s.id = new.sale_id and s.transaction_id = '${txn}')`,
      ),
    }[step]();
    try {
      const extra = step === "payment"
        ? { isInstallment: true, paymentModelId: await modelId(), amountReceived: 5000, initialPaymentAmount: 5000, initialPaymentMethod: "cash" }
        : {};
      const made = await callEdgeFunction(page, "create-sale", saleBody(serial, await partnerName(), seed, extra));
      expect(made.status, `${step}: ${made.status} ${JSON.stringify(made.body)}`).toBeGreaterThanOrEqual(400);
      expect(await leftBehind(seed, serial), `nothing left after a failed ${step}`).toEqual({
        sales: 0, addresses: 0, payments: 0, stove: "available",
      });
    } finally {
      await remove();
    }
  });
}
