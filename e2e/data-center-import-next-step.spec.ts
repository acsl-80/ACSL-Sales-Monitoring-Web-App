import { test, expect, type Page } from "@playwright/test";
import { callEdgeFunction, signIn, USERS } from "./helpers";

/**
 * A batch says what to do with it next, on the row.
 *
 * A real 983-row file staged and then sat there: "staged", "Rows 983",
 * "Ready 0", "Exceptions 0", and no next step anywhere. The actions lived
 * behind a chevron nobody had reason to click, and the one that batch needed -
 * checking the rows - did not exist as a button at all, because checking only
 * ever happened as the second half of an upload. A batch whose upload staged
 * and whose check did not could not be checked again short of re-uploading the
 * same file into the duplicate guard.
 *
 * These assert the two sentences a person actually meets, and that the second
 * only appears once the first has been acted on.
 */

const PARTNER = "a0000000-0000-4000-8000-00000000000a";

async function freeStoves(page: Page, n: number): Promise<string[]> {
  const r = await callEdgeFunction(page, "data-center-read", {
    action: "partner_stoves",
    organizationId: PARTNER,
    limit: 200,
  });
  const stoves =
    (r.body as { data?: { stoves?: { stove_id: string; sale_id: string | null }[] } })?.data
      ?.stoves ?? [];
  return stoves.filter((s) => !s.sale_id).slice(0, n).map((s) => s.stove_id);
}

/** Stage a batch WITHOUT checking it, which is the state that had no way out. */
async function stageOnly(page: Page, marker: string, serials: string[]): Promise<string> {
  const r = await callEdgeFunction(page, "data-center-import", {
    action: "stage",
    filename: `${marker}.csv`,
    rows: serials.map((s, i) => ({
      stove_serial_no: s,
      sales_model: "Amina Model",
      first_name: "Next",
      last_name: "Step",
      aka: marker,
      phone: `0801555${String(i).padStart(4, "0")}`,
      sales_date: "2026-01-04",
      state: "Kogi",
    })),
  });
  expect(r.status).toBe(200);
  return (r.body as { data: { batchId: string } }).data.batchId;
}

test.describe("a staged batch says what to do next", () => {
  test("an unchecked batch offers the check, and checking it offers the commit", async ({
    page,
  }, testInfo) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/import");
    await expect(page.getByRole("heading", { name: "Bulk Import" })).toBeVisible({
      timeout: 30_000,
    });

    const stoves = await freeStoves(page, 2);
    test.skip(stoves.length < 2, "not enough free stoves on this database");

    const marker = `next${testInfo.workerIndex}-${Date.now()}`;
    await stageOnly(page, marker, stoves);
    await page.reload();

    // The sentence a person meets, without opening anything.
    const check = page.getByRole("button", { name: "Check the rows" });
    await expect(page.getByText(/none has been checked yet/)).toBeVisible({ timeout: 30_000 });
    await expect(check).toBeVisible();

    // And the check runs from here. This is the door that did not exist.
    await check.click();

    /*
     * Now it offers the commit, and says what committing would do. The count is
     * not asserted: the seeded stoves may already be sold by an earlier spec in
     * the same run, and this is about the sentence, not the arithmetic.
     */
    await expect(page.getByText(/Nothing is written until you commit/)).toBeVisible({
      timeout: 40_000,
    });
    await expect(page.getByRole("button", { name: /^Commit \d+$/ })).toBeVisible();
  });

  test("the three-step explainer is folded away, and opens on its heading", async ({ page }) => {
    /*
     * Read on the way in it is help. Read by somebody whose file is already
     * staged it is three panels of instructions for work they have finished,
     * above the thing they need.
     */
    await signIn(page, USERS.admin);
    await page.goto("/data-center/import");
    await expect(page.getByRole("heading", { name: "Bulk Import" })).toBeVisible({
      timeout: 30_000,
    });

    const how = page.getByRole("button", { name: /How a bulk import works/ });
    await expect(how).toBeVisible();
    await expect(how).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByText("Download the sheet for a partner")).toHaveCount(0);

    await how.click();
    await expect(how).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByText("Download the sheet for a partner")).toBeVisible();
  });

  test("the dry run is offered in the words of what it does", async ({ page }, testInfo) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/import");
    await expect(page.getByRole("heading", { name: "Bulk Import" })).toBeVisible({
      timeout: 30_000,
    });

    const stoves = await freeStoves(page, 1);
    test.skip(stoves.length < 1, "no free stove");
    const marker = `dry${testInfo.workerIndex}-${Date.now()}`;
    await stageOnly(page, marker, stoves);
    await page.reload();

    // Behind the chevron is fine for this one: it is a thing you go looking for,
    // not a thing waiting on you. What matters is that it is not called "Dry run".
    await page.getByText(`${marker}.csv`).click();
    await expect(
      page.getByRole("button", { name: "Show what a commit would do" }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: /^Dry run$/ })).toHaveCount(0);
  });
});
