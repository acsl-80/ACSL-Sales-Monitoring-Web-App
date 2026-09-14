import { test, expect } from "@playwright/test";
import { branchSql, callEdgeFunction, signIn, USERS } from "./helpers";

/**
 * Slice 6a of the 2026-09-02 review: the dashboard's numbers come from SQL.
 *
 * The three dashboard functions fetched every sale in the period into the
 * edge function and summed there. PostgREST stops an unranged select at 1,000
 * rows (max_rows in config.toml), so once a scope passed a thousand sales the
 * money cards, the state table and the model donut were computed from the
 * first thousand and presented as totals. On 2026-09-02 production held 2,039
 * live sales; the donut centre read 1,000 and Expected Receivable read
 * ₦44.2m against a true ₦87.8m.
 *
 * This seeds 1,100 sales at the seed's first partner, attributed to its
 * partner agent, and reads the dashboard three ways: the super-admin screen
 * and its function, the partner function, the agent function. Every number is
 * compared with the same SQL over the branch database. Against the old code
 * the super-admin centre reads 1,000 and the receivable is a thousand rows'
 * worth. Against the new code every figure equals the SQL, and the host's
 * all-time total equals the count the Data Center's metrics use.
 */

/** The seed's first partner; partner@ and agent@ belong to it. */
const ORG = "a0000000-0000-4000-8000-000000000001";
/** agent@preview.acsl.test, a partner agent of that organisation. */
const AGENT = "b0000000-0000-4000-8000-000000000005";
const TAG = "E2ECAP";
const SEED_ROWS = 1100;
const YEAR = new Date().getUTCFullYear();
/** The dashboard's own default when no year is picked: 2024 to this year. */
const ALL_YEARS = Array.from({ length: YEAR - 2023 }, (_, i) => 2024 + i);

test.describe.configure({ mode: "serial", timeout: 240_000 });

type Truth = { n: number; amount: number; paid: number };
async function truth(where: string): Promise<Truth> {
  const [r] = await branchSql<{ n: number; amount: string | number; paid: string | number }>(
    `select count(*)::int as n,
            coalesce(sum(amount), 0) as amount,
            coalesce(sum(total_paid), 0) as paid
       from public.sales s
      where s.is_archived is not true and ${where}`,
  );
  return { n: Number(r.n), amount: Number(r.amount), paid: Number(r.paid) };
}
const inYear = `s.sales_date >= '${YEAR}-01-01' and s.sales_date < '${YEAR + 1}-01-01'`;
const allYears = `s.sales_date >= '${ALL_YEARS[0]}-01-01' and s.sales_date < '${YEAR + 1}-01-01'`;
const attributedToAgent = `(s.sold_on_behalf_of = '${AGENT}' or (s.sold_on_behalf_of is null and s.created_by = '${AGENT}'))`;
const sumOf = (rows: unknown, key: string) =>
  (Array.isArray(rows) ? rows : []).reduce((s: number, r: any) => s + (Number(r?.[key]) || 0), 0);

test.beforeAll(async () => {
  await branchSql(`delete from public.sales where transaction_id like '${TAG}%'`);
  // Half outright and paid in full, half on instalment with a part payment,
  // so "received" is what was collected whichever rule a reader applies.
  await branchSql(
    `insert into public.sales (
       transaction_id, stove_serial_no, sales_date, end_user_name, phone,
       contact_person, contact_phone, partner_name, retailer_branch, state_backup,
       lga_backup, amount, total_paid, is_installment, payment_status,
       organization_id, created_by, platform)
     select '${TAG}' || lpad(g::text, 5, '0'),
            '${TAG}' || lpad(g::text, 6, '0'),
            current_date - (g % 120),
            'E2E Cap Buyer ' || g,
            '0800' || lpad(g::text, 7, '0'),
            'E2E Cap Contact',
            '0800' || lpad(g::text, 7, '0'),
            o.partner_name, o.branch, o.state, 'E2E',
            43000,
            case when g % 2 = 0 then 43000 else 1000 end,
            g % 2 = 1,
            case when g % 2 = 0 then 'fully_paid' else 'partially_paid' end,
            o.id, '${AGENT}', 'web'
       from generate_series(1, ${SEED_ROWS}) as g
       cross join public.organizations o
      where o.id = '${ORG}'`,
  );
});

test.afterAll(async () => {
  await branchSql(`delete from public.sales where transaction_id like '${TAG}%'`);
});

test("the super-admin dashboard counts every sale, past the thousandth row", async ({ page }) => {
  const t = await truth(allYears);
  expect(t.n, "the seed did not land").toBeGreaterThan(1000);

  await signIn(page, USERS.admin);
  await page.goto("/dashboard");

  // The screen. The Sales by Models centre is the count of sales in the period;
  // the card is the sum of their amounts.
  const modelsDonut = page.getByText("TOTAL SALES", { exact: true }).locator("xpath=..");
  await expect(modelsDonut, "the donut centre should be every sale, not the first thousand").toContainText(
    t.n.toLocaleString("en-US"),
    { timeout: 45_000 },
  );
  await expect(
    page.getByText(`₦${Math.round(t.amount).toLocaleString("en-US")}`, { exact: true }).first(),
    "Expected Receivable should be the sum over every sale",
  ).toBeVisible({ timeout: 15_000 });

  // The function behind it, with the dashboard's own default period.
  const r = await callEdgeFunction(page, "get-super-admin-dashboard", { years: ALL_YEARS });
  expect(r.status).toBe(200);
  const d = (r.body as any)?.data ?? {};
  expect(Number(d.stovesSoldToEndUsers), "sold count").toBe(t.n);
  expect(Number(d.expectedReceivable), "expected receivable").toBe(t.amount);
  expect(Number(d.amountReceived), "amount received is what was collected").toBe(t.paid);
  expect(Number(d.outstandingBalance), "outstanding").toBe(t.amount - t.paid);
  expect(sumOf(d.salesModelData, "count"), "the model donut sums to the total").toBe(t.n);
  expect(sumOf(d.salesByState, "count"), "the state table sums to the total").toBe(t.n);

  // Both dashboards count a live sale the same way: is_archived is not true,
  // the predicate data_center.compute_metrics uses for sales.total.
  const [dc] = await branchSql<{ n: number }>(
    `select count(*)::int as n from public.sales where is_archived is not true`,
  );
  expect(Number(d.stovesSoldToEndUsers), "the host's all-time total equals the Data Center's").toBe(
    Number(dc.n),
  );
});

test("the partner dashboard counts every sale of the organisation", async ({ page }) => {
  const t = await truth(`s.organization_id = '${ORG}' and ${inYear}`);
  expect(t.n).toBeGreaterThan(1000);

  await signIn(page, USERS.partner);
  const r = await callEdgeFunction(page, "get-dashboard-stats", { year: YEAR });
  expect(r.status).toBe(200);
  const d = (r.body as any)?.data ?? {};
  expect(Number(d.totalExpectedAmount), "expected amount").toBe(t.amount);
  expect(Number(d.totalAmountPaid), "amount paid is what was collected").toBe(t.paid);
  expect(Number(d.totalAmountOwed), "amount owed").toBe(t.amount - t.paid);
  expect(sumOf(d.byState, "count"), "by state sums to the organisation's sales").toBe(t.n);
  expect(sumOf(d.salesModelData, "count"), "by model sums to the organisation's sales").toBe(t.n);
});

test("the agent dashboard counts every sale attributed to the agent", async ({ page }) => {
  const t = await truth(`${attributedToAgent} and ${inYear}`);
  expect(t.n).toBeGreaterThan(1000);
  const [cumulative] = await branchSql<{ n: number }>(
    `select count(*)::int as n from public.sales s
      where s.is_archived is not true and ${attributedToAgent} and s.sales_date < '${YEAR + 1}-01-01'`,
  );

  await signIn(page, USERS.agent);
  const r = await callEdgeFunction(page, "super-admin-agent-dashboard", { year: YEAR });
  expect(r.status).toBe(200);
  const d = (r.body as any)?.data ?? {};
  expect(Number(d.stovesSold), "stoves sold is a count, not a capped row set").toBe(Number(cumulative.n));
  expect(Number(d.expectedReceivable), "expected receivable").toBe(t.amount);
  expect(Number(d.amountReceived), "amount received is what was collected").toBe(t.paid);
  expect(sumOf(d.byState, "count"), "by state sums to the agent's sales").toBe(t.n);
  expect(sumOf(d.salesModelData, "count"), "by model sums to the agent's sales").toBe(t.n);
});
