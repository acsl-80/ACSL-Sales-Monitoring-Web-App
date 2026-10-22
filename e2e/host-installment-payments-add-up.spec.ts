import { test, expect, type Page } from "@playwright/test";
import { signIn, USERS, branchSql, callEdgeFunction, getEdgeFunction } from "./helpers";

/**
 * Instalment payments recorded at the same moment all count.
 *
 * installment-payments read the sale's total_paid, inserted the payment and
 * wrote back the total it had read plus the new amount. Two payments at once
 * both read the same total, so one of them went missing from total_paid while
 * both stood on the ledger, and two payments that each fitted the balance
 * could together pay more than the sale amount. The payment and the new total
 * are now written together under a lock on the sale.
 */

const TAG = "E2EADDUP";
const TWIN_A = "a0000000-0000-4000-8000-00000000000a";

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

/** An instalment sale of 42,000 with a first payment of `first`; returns its id. */
async function installmentSale(page: Page, first: number): Promise<string> {
  const seed = Date.now();
  const [org] = await branchSql<{ name: string }>(
    `select partner_name as name from public.organizations where id = '${TWIN_A}'`,
  );
  const [model] = await branchSql<{ id: string }>(
    `select id::text from public.payment_models where name = 'Amina Sales Model' and is_active`,
  );
  const phone = `0805${String(seed).slice(-7).padStart(7, "0")}`;
  const made = await callEdgeFunction(page, "create-sale", {
    transactionId: `${TAG}-${seed}`,
    stoveSerialNo: await freeStove(page),
    organizationId: TWIN_A,
    partnerName: org.name,
    salesDate: "2026-10-20",
    amount: 42000,
    amountReceived: first,
    isInstallment: true,
    paymentModelId: model.id,
    initialPaymentAmount: first,
    initialPaymentMethod: "cash",
    endUserFirstName: "Addup",
    endUserSurname: `Buyer${String(seed).slice(-5)}`,
    phone,
    contactPerson: "Addup Contact",
    contactPhone: phone,
    salesAgentName: "Bala Sani",
    termsAccepted: {
      poaGoverned: true, monitoring: true, noResell: true,
      emissionReductions: true, noExport: true, demonstration: true,
    },
    addressData: { fullAddress: `${TAG} ${seed} Road`, state: "Kogi", city: "Lokoja" },
  });
  expect(made.status, JSON.stringify(made.body)).toBe(200);
  const id = (made.body as { sale_id?: string }).sale_id;
  expect(id).toBeTruthy();
  return id!;
}

/** Posts several payments to one sale at the same moment, from the page. */
async function payAtOnce(page: Page, saleId: string, amounts: number[]): Promise<{ status: number; message?: string }[]> {
  return page.evaluate(
    async ({ saleId, amounts }) => {
      const key = Object.keys(window.localStorage).find(
        (k) => k.startsWith("sb-") && k.endsWith("-auth-token"),
      );
      const stored = JSON.parse(window.localStorage.getItem(key ?? "") ?? "{}");
      const token = stored.access_token ?? stored?.currentSession?.access_token;
      const ref = (key ?? "").replace(/^sb-/, "").replace(/-auth-token$/, "");
      const responses = await Promise.all(
        amounts.map((amount) =>
          fetch(`https://${ref}.supabase.co/functions/v1/installment-payments/${saleId}`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ amount, payment_method: "cash", notes: "e2e at once" }),
          }),
        ),
      );
      return Promise.all(
        responses.map(async (r) => ({ status: r.status, message: (await r.json().catch(() => ({}))).message })),
      );
    },
    { saleId, amounts },
  );
}

async function ledger(saleId: string) {
  const [row] = await branchSql<{ total_paid: string; status: string; ledger: string; rows: number }>(
    `select s.total_paid::text, s.payment_status as status,
            coalesce((select sum(amount) from public.installment_payments where sale_id = s.id), 0)::text as ledger,
            (select count(*)::int from public.installment_payments where sale_id = s.id) as rows
       from public.sales s where s.id = '${saleId}'`,
  );
  return row;
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

test("eight payments at the same moment all count in total_paid", async ({ page }) => {
  test.setTimeout(90_000);
  const saleId = await installmentSale(page, 2000);
  // A warm function first, so the eight arrive together rather than spread
  // out behind a cold start.
  await getEdgeFunction(page, `installment-payments/${saleId}`);
  const statuses = (await payAtOnce(page, saleId, Array(8).fill(1000))).map((r) => r.status);
  expect(statuses, "every payment accepted").toEqual(Array(8).fill(200));
  const after = await ledger(saleId);
  expect(after.rows, "the first payment and eight more on the ledger").toBe(9);
  expect(Number(after.ledger)).toBe(10000);
  expect(Number(after.total_paid), "total_paid agrees with the ledger").toBe(10000);
  expect(after.status).toBe("partially_paid");
});

test("two payments that each fit the balance cannot both be taken", async ({ page }) => {
  test.setTimeout(90_000);
  // 42,000 less 40,000 leaves 2,000: either 1,500 fits, both do not. The
  // second is refused under the lock, against the 500 the first one left.
  const saleId = await installmentSale(page, 40000);
  await getEdgeFunction(page, `installment-payments/${saleId}`);
  const replies = await payAtOnce(page, saleId, [1500, 1500]);
  const statuses = replies.map((r) => r.status);
  expect(statuses.filter((s) => s === 200).length, `one accepted: ${statuses}`).toBe(1);
  expect(statuses.filter((s) => s === 400).length, `one refused: ${statuses}`).toBe(1);
  expect(replies.find((r) => r.status === 400)?.message ?? "").toMatch(/exceeds remaining balance \(500\)/);
  const after = await ledger(saleId);
  expect(Number(after.total_paid)).toBe(41500);
  expect(Number(after.ledger)).toBe(41500);
  expect(after.status).toBe("partially_paid");
});

test("a single payment still records and answers as before", async ({ page }) => {
  test.setTimeout(90_000);
  const saleId = await installmentSale(page, 2000);
  const paid = await callEdgeFunction(page, `installment-payments/${saleId}`, {
    amount: 3000,
    payment_method: "transfer",
    notes: "e2e single",
  });
  expect(paid.status, JSON.stringify(paid.body)).toBe(200);
  const body = paid.body as {
    success?: boolean;
    data?: { id?: string; amount?: number | string; sale_id?: string };
    updated_sale?: { total_paid?: number; payment_status?: string; remaining?: number };
  };
  expect(body.success).toBe(true);
  expect(body.data?.id, "the reply carries the payment row").toBeTruthy();
  expect(body.data?.sale_id).toBe(saleId);
  expect(body.updated_sale).toEqual({ total_paid: 5000, payment_status: "partially_paid", remaining: 37000 });

  const over = await callEdgeFunction(page, `installment-payments/${saleId}`, {
    amount: 99000,
    payment_method: "cash",
  });
  expect(over.status).toBe(400);
  expect((over.body as { message?: string }).message ?? "").toMatch(/exceeds remaining balance/);
});
