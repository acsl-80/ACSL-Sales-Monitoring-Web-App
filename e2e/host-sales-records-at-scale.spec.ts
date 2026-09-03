import { test, expect, type Page } from "@playwright/test";
import { branchSql, signIn, USERS } from "./helpers";

/**
 * Slice 9a of the 2026-09-02 review: Sales Records at scale.
 *
 * The page loaded at most 500 sales and did everything in the browser. With
 * 1,105 live sales seeded on the branch, the old code says "of 500 records",
 * asks the server for a thousand rows in one request, shows no totals, and
 * its due chips count the first five hundred. The new code pages on the
 * server two hundred rows at most per request, counts every sale, shows the
 * three money cards from SQL, and a due chip is a server filter whose total
 * matches its badge.
 */

const ORG = "a0000000-0000-4000-8000-000000000001";
const AGENT = "b0000000-0000-4000-8000-000000000005";
const TAG = "E2ESCL";
const SEED_ROWS = 1100;

test.describe.configure({ mode: "serial", timeout: 240_000 });

type Truth = { n: number; amount: number; paid: number };
async function truth(): Promise<Truth> {
  const [r] = await branchSql<{ n: number; amount: string | number; paid: string | number }>(
    `select count(*)::int as n, coalesce(sum(amount), 0) as amount, coalesce(sum(total_paid), 0) as paid
       from public.sales where is_archived is not true`,
  );
  return { n: Number(r.n), amount: Number(r.amount), paid: Number(r.paid) };
}

function trackSales(page: Page) {
  const bodies: Record<string, unknown>[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/functions/v1/get-sales-advanced") && r.method() === "POST") {
      try {
        bodies.push(JSON.parse(r.postData() ?? "{}"));
      } catch {
        bodies.push({});
      }
    }
  });
  return bodies;
}

async function openSales(page: Page) {
  await page.goto("/sales");
  await expect(page.getByText("CONTROL PANEL")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("tbody tr").first()).toBeVisible({ timeout: 45_000 });
}

test.beforeAll(async () => {
  await branchSql(`delete from public.sales where transaction_id like '${TAG}%'`);
  await branchSql(
    `insert into public.sales (
       transaction_id, stove_serial_no, sales_date, end_user_name, phone,
       contact_person, contact_phone, partner_name, retailer_branch, state_backup,
       lga_backup, amount, total_paid, is_installment, payment_status,
       organization_id, created_by, platform)
     select '${TAG}' || lpad(g::text, 5, '0'),
            '${TAG}' || lpad(g::text, 6, '0'),
            current_date - (g % 120),
            'E2E Scale Buyer ' || g,
            '0801' || lpad(g::text, 7, '0'),
            'E2E Scale Contact',
            '0801' || lpad(g::text, 7, '0'),
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

test("the page counts every sale, asks for a page at a time, and its totals come from SQL", async ({ page }) => {
  const t = await truth();
  expect(t.n, "the seed did not land").toBeGreaterThan(1000);
  const bodies = trackSales(page);

  await signIn(page, USERS.admin);
  await openSales(page);

  const shown = t.n.toLocaleString("en-US");
  await expect(
    page.getByText(new RegExp(`of\\s+(${shown}|${t.n})\\s+records`)),
    "the footer should count every sale, not the first five hundred",
  ).toBeVisible({ timeout: 30_000 });

  await expect(
    page.getByText("Total Receivable", { exact: true }),
    "the money cards should be on the page",
  ).toBeVisible();
  await expect(
    page.getByText(`₦${Math.round(t.amount).toLocaleString("en-US")}`, { exact: true }).first(),
    "and Total Receivable should be the SQL sum over every sale",
  ).toBeVisible();
  await expect(
    page.getByText(`₦${Math.round(t.paid).toLocaleString("en-US")}`, { exact: true }).first(),
    "and Total Collected the SQL sum of what was collected",
  ).toBeVisible();

  const tooBig = bodies.filter((b) => Number(b.limit ?? 0) > 200);
  expect(tooBig, "no request may ask for more than 200 rows").toHaveLength(0);
  expect(bodies.length, "the page should have asked the server at least once").toBeGreaterThan(0);
});

test("paging is the server's: page two is a second request for the next two hundred", async ({ page }) => {
  const t = await truth();
  const bodies = trackSales(page);

  await signIn(page, USERS.admin);
  await openSales(page);

  await page.getByRole("combobox").filter({ hasText: /^(25|50|100|200)$/ }).first().click();
  await page.getByRole("option", { name: "200", exact: true }).click();
  await expect(page.getByText(/1–200 of/)).toBeVisible({ timeout: 30_000 });
  const firstOfPageOne = await page.locator("tbody tr").first().innerText();

  await page.getByRole("button", { name: /^Next/ }).click();
  await expect(page.getByText(/201–400 of/)).toBeVisible({ timeout: 30_000 });
  const firstOfPageTwo = await page.locator("tbody tr").first().innerText();
  expect(firstOfPageTwo, "page two should show different sales").not.toBe(firstOfPageOne);

  const pageTwo = bodies.find((b) => Number(b.page) === 2 && Number(b.limit) === 200);
  expect(pageTwo, "page two should be a request for page 2 with a limit of 200").toBeTruthy();
  expect(t.n).toBeGreaterThan(400);
});

test("a due chip is a server filter, and the list agrees with the badge", async ({ page }) => {
  const bodies = trackSales(page);
  await signIn(page, USERS.admin);
  await openSales(page);

  const chip = page.getByRole("button", { name: /^Due in 30 days/ });
  await expect(chip).toBeVisible({ timeout: 30_000 });
  const badge = Number((await chip.innerText()).replace(/\D/g, ""));
  expect(badge, "the seed's instalment sales fall due inside thirty days").toBeGreaterThan(0);

  await chip.click();
  await expect
    .poll(() => bodies.some((b) => b.dueBucket === "due30"), {
      timeout: 15_000,
      message: "the chip should ask the server for its window",
    })
    .toBe(true);
  await expect(
    page.getByText(new RegExp(`of\\s+(${badge.toLocaleString("en-US")}|${badge})\\s+records`)),
    "the footer should count what the chip counts",
  ).toBeVisible({ timeout: 30_000 });
});
