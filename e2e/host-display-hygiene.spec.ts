import { test, expect } from "@playwright/test";
import { branchSql, signIn, USERS } from "./helpers";

/**
 * Slice 8a of the 2026-09-02 review: the host's display hygiene.
 *
 * Titles. Every page passed a title to its layout and the shell discarded it,
 * so the top bar never said where the reader was. It does now.
 *
 * The Settings submenu. Its entries never highlighted, because the shell
 * derived "credentials" from /settings/credentials and the entry's key was
 * "settings-credentials". The path now yields the entry's own key, and the
 * active link says so to assistive technology as well as in colour.
 *
 * Dates. Thirty-six copies of formatDate said a date thirty-six ways, en-GB
 * here and en-US there and the browser's own locale on the receipt. One
 * helper now: en-GB, Lagos, "31 Aug 2026".
 *
 * Money. A missing amount printed ₦NaN on some screens and threw on others,
 * taking the Sales Records table down with it. One helper now: ₦43,000, and
 * a plain N/A for an amount that is not there.
 */

const SAFE_ID = /^[0-9a-f-]{36}$/;
const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "Africa/Lagos",
});

test.describe.configure({ timeout: 180_000 });

test("the top bar says where the reader is, and the Settings entry they are on is lit", async ({ page }) => {
  await signIn(page, USERS.admin);

  await page.goto("/settings/tools");
  await expect(page.getByText("CONTROL PANEL")).toBeVisible({ timeout: 30_000 });
  await expect(
    page.locator("header").getByRole("heading", { name: "Tools" }),
    "the top bar should carry the page's title",
  ).toBeVisible({ timeout: 15_000 });
  const tools = page.getByRole("link", { name: "Tools", exact: true });
  await expect(tools, "the Settings entry for this page should be marked current").toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByRole("button", { name: /^Settings/ }), "and its parent should show as active").toHaveClass(
    /bg-\[#4a5d0f\]/,
  );

  await page.goto("/payment-models");
  await expect(page.getByText("CONTROL PANEL")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("link", { name: "Payment Models", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
    { timeout: 15_000 },
  );
});

test("a date is said one way, en-GB in Lagos", async ({ page }) => {
  const [sale] = await branchSql<{ sales_date: string; end_user_name: string }>(
    `select sales_date::text, end_user_name from public.sales
      where is_archived is not true and sales_date is not null order by sales_date desc, id limit 1`,
  );
  expect(sale?.sales_date).toBeTruthy();
  const expected = DATE.format(new Date(sale.sales_date));
  expect(expected).toMatch(/^\d{2} [A-Z][a-z]{2} \d{4}$/);

  await signIn(page, USERS.admin);
  await page.goto("/sales/financial-reports");
  await expect(page.getByText("CONTROL PANEL")).toBeVisible({ timeout: 30_000 });
  await expect(
    page.getByText(expected).first(),
    `the sale dated ${sale.sales_date} should read ${expected}`,
  ).toBeVisible({ timeout: 30_000 });
});

test("an amount that is not there reads N/A, and does not take the table down", async ({ page }) => {
  const [sale] = await branchSql<{ id: string; end_user_name: string; amount: number | null }>(
    `select id::text, end_user_name, amount from public.sales
      where is_archived is not true and end_user_name is not null and amount is not null
      order by created_at desc limit 1`,
  );
  expect(sale).toBeTruthy();
  expect(SAFE_ID.test(sale.id)).toBe(true);
  await branchSql(`update public.sales set amount = null where id = '${sale.id}'`);
  try {
    await signIn(page, USERS.admin);
    await page.goto("/sales");
    await page.getByPlaceholder("Search customer, transaction ID, phone…").fill(sale.end_user_name);
    const row = page.locator("tbody tr", { hasText: sale.end_user_name }).first();
    await expect(row, "the table should still render with an amount missing").toBeVisible({ timeout: 30_000 });
    await expect(row, "and say the amount is not there").toContainText("N/A");
    await expect(page.getByText("Something went wrong")).toHaveCount(0);
  } finally {
    await branchSql(`update public.sales set amount = ${Number(sale.amount)} where id = '${sale.id}'`);
  }
});
