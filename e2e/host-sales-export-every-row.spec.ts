import fs from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { branchSql, signIn, USERS } from "./helpers";

/**
 * Slice 9b of the 2026-09-02 review: the export holds every matching row.
 *
 * The export asked the server for two thousand rows in one request, the
 * server clamped that to five hundred, and the file a partner downloaded held
 * the first five hundred of whatever matched with no word that anything was
 * missing. It now sends the same request the screen sends, page after page,
 * until the server's total is reached. Against the old code the file holds
 * 500 of 1,105 seeded sales and one request asked for two thousand; against
 * the new one it holds every sale, in pages of five hundred, and a filtered
 * export holds exactly what the filter allows.
 */

const ORG = "a0000000-0000-4000-8000-000000000001";
const AGENT = "b0000000-0000-4000-8000-000000000005";
const TAG = "E2EEXP";
const SEED_ROWS = 1100;

test.describe.configure({ timeout: 300_000 });

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

/** The seeded rows in a CSV: a transaction id is the tag and five digits. */
const seededRowsIn = (csv: string) => (csv.match(new RegExp(`${TAG}\\d{5}(?!\\d)`, "g")) ?? []).length;

async function exportFrom(page: Page) {
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 240_000 }),
    page.getByRole("button", { name: /^Export/ }).click(),
  ]);
  const path = await download.path();
  expect(path, "the browser should have received a file").toBeTruthy();
  return fs.readFileSync(path as string, "utf8");
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
            'E2E Export Buyer ' || g,
            '0802' || lpad(g::text, 7, '0'),
            'E2E Export Contact',
            '0802' || lpad(g::text, 7, '0'),
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

test("the export holds every matching sale, fetched in pages of five hundred", async ({ page }) => {
  const [t] = await branchSql<{ n: number }>(
    `select count(*)::int as n from public.sales where is_archived is not true and transaction_id like '${TAG}%'`,
  );
  expect(Number(t.n)).toBe(SEED_ROWS);
  const bodies = trackSales(page);

  await signIn(page, USERS.admin);
  await page.goto("/sales");
  await expect(page.locator("tbody tr").first()).toBeVisible({ timeout: 45_000 });

  const csv = await exportFrom(page);
  expect(seededRowsIn(csv), "every seeded sale should be in the file").toBe(SEED_ROWS);

  const exportRequests = bodies.filter((b) => Number(b.limit ?? 0) >= 500 || b.includeAddress === true);
  expect(
    exportRequests.some((b) => Number(b.limit) > 500),
    "no export request may ask for more than the server gives",
  ).toBe(false);
  expect(exportRequests.length, "the export should have paged, five hundred at a time").toBeGreaterThanOrEqual(3);
});

test("a filtered export holds exactly what the filter allows", async ({ page }) => {
  const [t] = await branchSql<{ n: number }>(
    `select count(*)::int as n from public.sales
      where is_archived is not true and transaction_id like '${TAG}%'
        and (is_installment is not true or payment_status = 'fully_paid')`,
  );
  const paid = Number(t.n);
  expect(paid, "the seed should hold more than five hundred paid sales").toBeGreaterThan(500);

  await signIn(page, USERS.admin);
  await page.goto("/sales");
  await expect(page.locator("tbody tr").first()).toBeVisible({ timeout: 45_000 });

  await page.getByRole("combobox").filter({ hasText: "All Status" }).click();
  await page.getByRole("option", { name: "Paid", exact: true }).click();
  await expect(page.getByText(/of\s+[\d,]+\s+records/)).toBeVisible({ timeout: 30_000 });

  const csv = await exportFrom(page);
  expect(seededRowsIn(csv), "the file should hold the paid seeded sales and no others").toBe(paid);
});
