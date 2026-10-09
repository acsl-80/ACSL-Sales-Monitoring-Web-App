import { test, expect, type Route } from "@playwright/test";
import { signIn, USERS } from "./helpers";

/**
 * End User Records shows the first batch while the rest load.
 *
 * On 2026-10-09 the page read 5,529 sales in batches of 500, one after
 * another, and showed nothing until the last landed. The server's answers
 * are held back here so the order is certain: the first batch answers at
 * once, the later ones only when the test lets them go.
 *
 * Red on main: the spinner stays up while batches 2 and 3 are held, so no
 * record count shows. Green: 500 records show with a "Loading the rest" note
 * and Export waits, then all 1,500 show and Export opens.
 */

test.describe.configure({ timeout: 180_000 });

const TOTAL = 1500;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
const LIMIT = 500;

function batch(page: number) {
  return Array.from({ length: LIMIT }, (_, i) => {
    const n = (page - 1) * LIMIT + i;
    return {
      id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
      end_user_name: `Batch${page} User${i}`,
      stove_serial_no: `TEST${n}`,
      sales_date: "2026-10-01",
      created_at: "2026-10-01T10:00:00Z",
      state_backup: "Kogi",
      lga_backup: "Lokoja",
    };
  });
}

test("the first batch shows while the rest load, and export waits for all of them", async ({
  page,
}) => {
  const held: Route[] = [];
  await page.route("**/functions/v1/get-sales-advanced**", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: CORS });
      return;
    }
    const body = route.request().postDataJSON?.() ?? {};
    const n = Number(body?.page ?? 1);
    if (n > 1) {
      held.push(route);
      return;
    }
    await route.fulfill({
      headers: CORS,
      json: {
        success: true,
        data: batch(1),
        pagination: { page: 1, limit: LIMIT, total: TOTAL, totalPages: TOTAL / LIMIT },
      },
    });
  });

  await signIn(page, USERS.admin);
  await page.goto("/end-user-records");

  const count = page.getByText(/of\s+500\s+records/).first();
  await expect(count, "the first batch should show before the rest arrive").toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText(/Loading the rest: 500 of 1500 so far/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Export" })).toBeDisabled();

  await expect.poll(() => held.length, { timeout: 30_000 }).toBe(2);
  for (const route of held) {
    const n = Number(route.request().postDataJSON()?.page);
    await route.fulfill({
      headers: CORS,
      json: {
        success: true,
        data: batch(n),
        pagination: { page: n, limit: LIMIT, total: TOTAL, totalPages: TOTAL / LIMIT },
      },
    });
  }

  await expect(page.getByText(/of\s+1500\s+records/).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Loading the rest/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Export" })).toBeEnabled();
});
