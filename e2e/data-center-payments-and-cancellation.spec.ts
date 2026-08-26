import { test, expect } from "@playwright/test";
import { signIn, USERS } from "./helpers";

/**
 * The money behind the total, and a cancellation that stays visible.
 *
 * The Data Center lives inside the sales app and must never tell a different
 * story about the same stove. Two places where it did.
 *
 * The stove record showed `total_paid`, a summary of something it never
 * showed - and 32 of the 45 rows on production are instalment sales whose
 * payments nothing in this module had ever read. Worse, the two sources
 * already disagree on four sales in thirty-three, so a list printed beside a
 * contradicting total would let the reader pick a number without knowing there
 * was a question.
 *
 * And cancelling a sale RELEASES the stove: the sale keeps its serial, the
 * stock row drops the link. Every other part of the page hangs off that link,
 * so a stove sold and then cancelled read as "not sold yet" with the whole
 * episode invisible.
 *
 * Fixtures, seeded per state, because reading the code is what let the
 * unreachable cancelled pill survive two phases:
 *
 *   PRV000021  instalment, payments add up
 *   PRV000028  instalment, part paid, no payments recorded
 *   PRV000035  instalment, payments do NOT add up
 *   PRV000042  released by a cancellation
 *   PRV000007  outright, no instalments at all
 */

const open = async (page: import("@playwright/test").Page, stove: string) => {
  await page.goto(`/data-center/stove/${stove}`);
  await expect(page.getByText(stove).first()).toBeVisible({ timeout: 30_000 });
};

test.describe("payments are shown, and reconciled out loud", () => {
  test("payments that add up say so quietly", async ({ page }) => {
    await signIn(page, USERS.admin);
    await open(page, "PRV000021");

    await expect(page.getByText("Payments")).toBeVisible();
    // Both instalments, by their amounts.
    await expect(page.getByText("₦21,000").first()).toBeVisible();
    await expect(page.getByText(/matches the total on the sale/i)).toBeVisible();
  });

  test("payments that disagree name both numbers and refuse to pick", async ({ page }) => {
    await signIn(page, USERS.admin);
    await open(page, "PRV000035");

    /*
     * The load-bearing assertion in this file. The payments come to 30,000 and
     * the sale records 25,000; production has a sale in exactly this state.
     * Showing either alone would be picking a winner between two sources the
     * sales app keeps apart, so both appear and the text says they disagree.
     */
    const line = page.getByText(/but the sale records/i);
    await expect(line).toBeVisible();
    await expect(line).toContainText("₦30,000");
    await expect(line).toContainText("₦25,000");
  });

  test("an instalment sale with nothing recorded says that, not nothing", async ({
    page,
  }) => {
    await signIn(page, USERS.admin);
    await open(page, "PRV000028");

    // An empty table would read as "nothing was paid". It means "nothing was
    // recorded", and production has two sales in this state.
    await expect(
      page.getByText(/no payment has been recorded against it/i),
    ).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Amount" })).toHaveCount(0);
  });

  test("an outright sale is not given a payments block at all", async ({ page }) => {
    await signIn(page, USERS.admin);
    await open(page, "PRV000007");

    await expect(page.getByText("Payments")).toHaveCount(0);
  });
});

test.describe("a cancelled sale stays visible on the stove", () => {
  test("the stove shows the cancelled sale rather than reading as never sold", async ({
    page,
  }) => {
    await signIn(page, USERS.admin);
    await open(page, "PRV000042");

    // The whole point: this stove IS available stock, and it got there by a
    // cancellation rather than by never having been sold.
    await expect(page.getByText(/Not sold yet/i)).toHaveCount(0);
    await expect(page.getByText(/Not sold at the moment/i)).toBeVisible();

    await expect(page.getByText(/Earlier sales of this stove/i)).toBeVisible();
    await expect(page.getByText("PRV006")).toBeVisible();
    await expect(page.getByText(/Buyer changed their mind/i)).toBeVisible();
  });

  test("the cancellation names when and why", async ({ page }) => {
    await signIn(page, USERS.admin);
    await open(page, "PRV000042");

    const entry = page.getByText(/Cancelled on /).first();
    await expect(entry).toBeVisible();
    await expect(entry).toContainText("Buyer changed their mind before collection");
  });
});
