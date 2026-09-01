import { test, expect, type Page } from "@playwright/test";
import { signIn, USERS } from "./helpers";

/**
 * The bench, timed the way a typist experiences it.
 *
 * Not "does the form work" - other specs cover that. This one is about the
 * distance between two records, because the job is the same eleven fields
 * forty times over and everything between them is waste. What used to sit
 * between two receipts was: back to the list, find your place in a paginated
 * table, click, wait.
 */

/**
 * Open the bench on a partner that still has something to type.
 *
 * Two tables in a row - partners, then the partner's stoves - and each click
 * replaces the one before it. `tbody tr` is the same selector at both depths,
 * so clicking it twice races the render and lands on whichever table happens
 * to be mounted. An earlier version of a helper like this did exactly that,
 * returned false, and skipped every test over a feature nobody had checked.
 *
 * Waiting on something that exists at exactly one depth - the sweep's scope
 * line, the rail's title - is what makes each step unambiguous.
 */
async function openTheBench(page: Page): Promise<boolean> {
  await signIn(page, USERS.admin);
  await page.goto("/data-center/import");
  await expect(page.getByRole("heading", { name: "Bulk Import" })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("button", { name: /One receipt at a time/ }).click();

  // A partner with something left to type. The list sorts by what is left,
  // so the first row is the deterministic choice.
  const partners = page.locator("tbody tr");
  await expect(partners.first()).toBeVisible({ timeout: 30_000 });
  const partnerName = (await partners.first().locator("td").first().innerText()).trim();
  await partners.first().click();

  // Straight into everything they hold - no chooser in between. The scope
  // line only exists at this depth, so waiting on it proves the partner
  // table has been replaced.
  await expect(page.getByText(/all consignments/).first()).toBeVisible({ timeout: 30_000 });
  const stoves = page.locator("tbody tr");
  if ((await stoves.count()) === 0) return false;
  await stoves.first().click();

  // And the form is open with the rail beside it, named after the partner.
  const rail = page.locator("aside");
  await expect(rail.getByText(partnerName).first()).toBeVisible({ timeout: 30_000 });
  return true;
}

test.describe("moving between receipts costs nothing", () => {
  test("the partner sits beside the form, scannable and searchable", async ({
    page,
  }) => {
    const opened = await openTheBench(page);
    test.skip(!opened, "no partner with stoves on the preview");
    const rail = page.locator("aside");

    /*
     * The rail is the whole point: the partner's stoves, visible while a form
     * is open, so picking the next one is a click rather than a journey.
     */
    // A run that visibly shrinks. Typing forty receipts with no sense of how
    // many are left is the part people call endless.
    await expect(rail.getByText(/\d+ of [\d,]+ recorded/)).toBeVisible({ timeout: 30_000 });

    // The stack of paper is not in the system's order, so the receipt in hand
    // is found by typing its last digits rather than by reading down a column.
    await expect(rail.getByLabel("Find a stove this partner holds")).toBeVisible();

    for (const chip of ["To type", "Done", "All"]) {
      await expect(
        rail.getByRole("button", { name: new RegExp(`^${chip} [\\d,]+$`) }),
      ).toBeVisible();
    }

    // And the rail pages: a partner holds thousands, the rail holds a page,
    // and the way to the next one is right here rather than back in the list.
    await expect(rail.getByText(/Page 1 of \d+ · [\d,]+ stoves?/)).toBeVisible();
    await expect(rail.getByRole("button", { name: "Next page" })).toBeVisible();
    await expect(rail.getByRole("button", { name: "Previous page" })).toBeDisabled();
  });

  test("the search narrows the rail without leaving the form, and keeps focus", async ({
    page,
  }) => {
    const opened = await openTheBench(page);
    test.skip(!opened, "no partner with stoves on the preview");
    const rail = page.locator("aside");

    const find = rail.getByLabel("Find a stove this partner holds");
    await find.fill("ZZZZZZ");
    // The term goes to the server now, so the empty answer takes a round
    // trip - but the rail must stay mounted the whole way through it.
    await expect(rail.getByText(/No stove ID here contains/)).toBeVisible({ timeout: 20_000 });

    /*
     * The three things the old rail lost on every search, asserted in one
     * place: the term is still in the box, the box still has focus, and the
     * form is still open behind it. Searching is not navigation.
     */
    await expect(find).toHaveValue("ZZZZZZ");
    await expect(find).toBeFocused();
    await expect(page.getByRole("button", { name: /Save draft/ })).toBeVisible();

    await find.fill("");
    await expect(rail.getByText(/No stove ID here contains/)).toHaveCount(0, {
      timeout: 20_000,
    });
  });

  test("save and next is offered with what is left in it", async ({ page }) => {
    const opened = await openTheBench(page);
    test.skip(!opened, "no partner with stoves on the preview");

    /*
     * The label carries the count because it is the answer to the only
     * question a typist has mid-run - and the count is the PARTNER'S todo
     * now, not the loaded page's, so it no longer disagrees with the number
     * at the base of the list. "Save and finish the run" is the same button
     * when this is the last one, so the end of a stack is never a button
     * that silently does nothing.
     */
    await expect(
      page.getByRole("button", { name: /Save and (next \([\d,]+ left\)|finish the run)/ }),
    ).toBeVisible({ timeout: 30_000 });

    // The shortcuts are written where somebody will read them rather than
    // being folklore.
    await expect(
      page.getByText(/Ctrl\+S saves a draft, Ctrl\+Enter finishes and opens the next/),
    ).toBeVisible();
  });

  test("clicking a stove in the rail swaps the form, not the page", async ({ page }) => {
    const opened = await openTheBench(page);
    test.skip(!opened, "no partner with stoves on the preview");
    const rail = page.locator("aside");

    const entries = rail.locator("li button");
    const count = await entries.count();
    test.skip(count < 2, "this partner holds one todo stove");

    const firstId = (await entries.nth(0).innerText()).split("\n")[0].trim();
    await entries.nth(1).click();

    // The rail is still there and the form is still there: nothing navigated.
    await expect(rail.getByLabel("Find a stove this partner holds")).toBeVisible();
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
