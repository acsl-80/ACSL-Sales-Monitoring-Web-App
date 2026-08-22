import { test, expect, type Page } from "@playwright/test";
import { signIn, USERS } from "./helpers";

/**
 * The bench, timed the way a typist experiences it.
 *
 * Not "does the form work" - other specs cover that. This one is about the
 * distance between two records, because the job is the same eleven fields
 * forty times over and everything between them is waste. What used to sit
 * between two receipts was: back to the consignment, find your place in a
 * paginated table, click, wait.
 */

/**
 * Open the bench on a consignment that still has something to type.
 *
 * Three tables in a row - partners, consignments, stoves - and each click
 * replaces the one before it. `tbody tr` is the same selector at all three
 * depths, so clicking it three times races the render and lands on whichever
 * table happens to be mounted. The first version of this helper did exactly
 * that, returned false, and skipped all four tests: four green skips that
 * proved nothing while the feature went unchecked.
 *
 * Waiting on a cell whose text belongs to one specific depth is what makes
 * each step unambiguous.
 */
async function openAConsignment(page: Page): Promise<boolean> {
  await signIn(page, USERS.admin);
  await page.goto("/data-center/import");
  await expect(page.getByRole("heading", { name: "Bulk Import" })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("button", { name: /One receipt at a time/ }).click();

  // A partner with something left to type. The column exists for people; here
  // it is what makes the choice deterministic.
  const partners = page.locator("tbody tr");
  await expect(partners.first()).toBeVisible({ timeout: 30_000 });
  const partnerName = (await partners.first().locator("td").first().innerText()).trim();
  await partners.first().click();

  // Its consignments. Waiting for the partner's name to appear as the trail's
  // heading is what proves the table underneath has been replaced.
  await expect(page.getByText(partnerName, { exact: true }).first()).toBeVisible({
    timeout: 30_000,
  });
  const consignments = page.locator("tbody tr");
  await expect(consignments.first()).toBeVisible({ timeout: 30_000 });
  const reference = (await consignments.first().locator("td").first().innerText()).trim();
  await consignments.first().click();

  // Its stoves. The "Still to type" chip only exists at this depth.
  const chip = page.getByRole("button", { name: /^Still to type \(\d+\)$/ });
  await expect(chip).toBeVisible({ timeout: 30_000 });
  const stoves = page.locator("tbody tr");
  if ((await stoves.count()) === 0) return false;
  await stoves.first().click();

  // And the form is open, with the consignment beside it.
  await expect(page.getByText(reference, { exact: true }).first()).toBeVisible({
    timeout: 30_000,
  });
  return true;
}

test.describe("moving between receipts costs nothing", () => {
  test("the consignment sits beside the form, scannable and searchable", async ({
    page,
  }) => {
    const opened = await openAConsignment(page);
    test.skip(!opened, "no consignment with stoves on the preview");

    /*
     * The rail is the whole point: every stove ID in the consignment, visible
     * while a form is open, so picking the next one is a click rather than a
     * journey.
     */
    await expect(page.getByText("This consignment")).toBeVisible({ timeout: 30_000 });

    // A run that visibly shrinks. Typing forty receipts with no sense of how
    // many are left is the part people call endless.
    await expect(page.getByText(/\d+ of \d+ recorded/)).toBeVisible();

    // The stack of paper is not in the system's order, so the receipt in hand
    // is found by typing its last digits rather than by reading down a column.
    await expect(
      page.getByLabel("Find a stove in this consignment"),
    ).toBeVisible();

    for (const chip of ["To type", "Done", "All"]) {
      await expect(page.getByRole("button", { name: new RegExp(`^${chip} \\d+$`) })).toBeVisible();
    }
  });

  test("the search narrows the rail without leaving the form", async ({ page }) => {
    const opened = await openAConsignment(page);
    test.skip(!opened, "no consignment with stoves on the preview");
    await expect(page.getByText("This consignment")).toBeVisible({ timeout: 30_000 });

    const find = page.getByLabel("Find a stove in this consignment");
    await find.fill("ZZZZZZ");
    await expect(page.getByText(/No stove ID here contains/)).toBeVisible();

    // And the form is still open behind it - searching the rail is not
    // navigation, which is the entire difference from the old flow.
    await expect(page.getByRole("button", { name: /Save draft/ })).toBeVisible();

    await find.fill("");
    await expect(page.getByText(/No stove ID here contains/)).toHaveCount(0);
  });

  test("save and next is offered with what is left in it", async ({ page }) => {
    const opened = await openAConsignment(page);
    test.skip(!opened, "no consignment with stoves on the preview");
    await expect(page.getByText("This consignment")).toBeVisible({ timeout: 30_000 });

    /*
     * The label carries the count because it is the answer to the only
     * question a typist has mid-run. "Save and finish the run" is the same
     * button when this is the last one, so the end of a stack is never a
     * button that silently does nothing.
     */
    await expect(
      page.getByRole("button", { name: /Save and (next \(\d+ left\)|finish the run)/ }),
    ).toBeVisible();

    // The shortcuts are written where somebody will read them rather than
    // being folklore.
    await expect(
      page.getByText(/Ctrl\+S saves a draft, Ctrl\+Enter finishes and opens the next/),
    ).toBeVisible();
  });

  test("clicking a stove in the rail swaps the form, not the page", async ({ page }) => {
    const opened = await openAConsignment(page);
    test.skip(!opened, "no consignment with stoves on the preview");
    await expect(page.getByText("This consignment")).toBeVisible({ timeout: 30_000 });

    const rail = page.locator("aside").filter({ hasText: "This consignment" });
    const entries = rail.locator("li button");
    const count = await entries.count();
    test.skip(count < 2, "this consignment holds one stove");

    const firstId = (await entries.nth(0).innerText()).split("\n")[0].trim();
    await entries.nth(1).click();

    // The rail is still there and the form is still there: nothing navigated.
    await expect(page.getByText("This consignment")).toBeVisible();
    await expect(page.getByRole("button", { name: /Save draft/ })).toBeVisible();

    // And the one that is open has moved.
    await expect
      .poll(async () => {
        const open = rail.locator('li button[aria-current="true"]');
        return (await open.count()) > 0
          ? (await open.first().innerText()).split("\n")[0].trim()
          : "";
      }, { timeout: 20_000 })
      .not.toBe(firstId);
  });
});
