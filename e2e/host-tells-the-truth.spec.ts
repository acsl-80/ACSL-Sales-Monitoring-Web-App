import { test, expect } from "@playwright/test";
import { branchSql, signIn, USERS } from "./helpers";

/**
 * Slice 2 of the 2026-09-02 review: the host tells the truth about money and
 * about saves.
 *
 * Two of the eight items in the slice are asserted here, chosen because each
 * one stands for a class.
 *
 * The badge. AdminSalesDetailModal called any non-instalment sale "Paid"
 * whatever total_paid held, so an outright sale with nothing collected wore a
 * green badge. Against the old code the badge reads Paid; against the new one
 * it reads Unpaid, because the rule FinancialReportsTable states applies
 * everywhere: total_paid is what was collected, for outright sales too.
 *
 * The toast. Eight screens called a toast hook that kept a private list and
 * never rendered it, so every save and every failure on them was silent.
 * Creating a payment model is one of those screens. Against the old code no
 * toast appears; against the new one the provider's container shows it.
 */

const SAFE_ID = /^[0-9a-f-]{36}$/;

test.describe.configure({ timeout: 240_000 });

test.describe("slice 2: the host tells the truth", () => {
  test("an outright sale with nothing collected is not badged Paid", async ({ page }) => {
    // A live, non-instalment sale from the seed, made unpaid in the branch
    // database only. Restored afterwards.
    const [sale] = await branchSql<{
      id: string;
      end_user_name: string;
      total_paid: number | null;
      payment_status: string | null;
    }>(
      `select id::text, end_user_name, total_paid, payment_status
         from public.sales
        where is_archived is not true and is_installment is not true
          and amount > 0 and end_user_name is not null
        order by created_at desc limit 1`,
    );
    expect(sale, "the preview has no outright sale to test with").toBeTruthy();
    expect(SAFE_ID.test(sale.id)).toBe(true);
    // Only what was collected changes. payment_status is left alone: the badge
    // must read the money, and the column's check constraint does not admit
    // an "unpaid" value for an outright sale, which is itself the point.
    await branchSql(`update public.sales set total_paid = 0 where id = '${sale.id}'`);
    try {
      await signIn(page, USERS.admin);
      await page.goto("/sales");
      await page
        .getByPlaceholder("Search customer, transaction ID, phone…")
        .fill(sale.end_user_name);
      const row = page.locator("tbody tr", { hasText: sale.end_user_name }).first();
      await expect(row, "the sale should be listed").toBeVisible({ timeout: 30_000 });
      await row.getByRole("button").last().click();
      await page.getByRole("menuitem", { name: "View Transaction Details" }).click();

      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible({ timeout: 15_000 });
      await expect(
        dialog.getByText("Unpaid", { exact: true }),
        "nothing was collected, so the badge should say Unpaid",
      ).toBeVisible();
      await expect(
        dialog.getByText("Paid", { exact: true }),
        "a green Paid on a sale with nothing collected is the defect",
      ).toHaveCount(0);
    } finally {
      await branchSql(
        `update public.sales
            set total_paid = ${sale.total_paid ?? "null"},
                payment_status = ${sale.payment_status ? `'${sale.payment_status}'` : "null"}
          where id = '${sale.id}'`,
      );
    }
  });

  test("saving a payment model shows a toast", async ({ page }, testInfo) => {
    const name = `Toast Proof ${testInfo.workerIndex}-${Date.now() % 100000}`;
    try {
      await signIn(page, USERS.admin);
      await page.goto("/settings/payment-models");
      await page.getByRole("button", { name: /Create Model/ }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible({ timeout: 15_000 });
      await dialog.locator("#model-name").fill(name);
      await dialog.locator("#model-price").fill("1000");
      await dialog.locator("#model-duration").fill("1");
      await dialog.getByRole("button", { name: /^(Create|Save)/ }).click();

      // The whole point: the provider's container shows the message. The old
      // hook wrote it to a list nothing rendered.
      await expect(
        page.getByText("Payment model created successfully"),
        "a successful save should say so on screen",
      ).toBeVisible({ timeout: 15_000 });
    } finally {
      await branchSql(
        `delete from public.payment_models where name = '${name.replace(/'/g, "''")}'`,
      );
    }
  });
});
