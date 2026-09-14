import { test, expect, type Page } from "@playwright/test";
import { callEdgeFunction, signIn, USERS } from "./helpers";

/**
 * A refused finish names the fields and takes the typist to the first one.
 *
 * The bench used to answer "2 fields still to sort out" and leave the typist
 * to hunt down a long form for two red lines. Now the error box names them in
 * the order they sit on the page, the first one is scrolled into view and
 * focused, and each is ringed in red. Against the old code the box carries a
 * count and nothing has focus.
 */

const PARTNER_NAME = "Twin Name Partner";

test.describe.configure({ timeout: 240_000 });

async function openFirstStove(page: Page): Promise<boolean> {
  await signIn(page, USERS.admin);
  await page.goto("/data-center/import");
  await expect(page.getByRole("heading", { name: "Bulk Import" })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("button", { name: /One receipt at a time/ }).click();
  await expect(page.locator("tbody tr").first()).toBeVisible({ timeout: 30_000 });
  await page.getByPlaceholder("Search by name").fill(PARTNER_NAME);
  const row = page
    .locator("tbody tr", { hasText: PARTNER_NAME })
    .filter({ hasText: "Kogi" })
    .first();
  if ((await row.count()) === 0) return false;
  await row.click();
  await expect(page.getByText(/all consignments/).first()).toBeVisible({ timeout: 30_000 });
  await page.locator("tbody tr").first().click();
  await expect(page.locator("#wb-endUserName")).toBeVisible({ timeout: 30_000 });
  return true;
}

/** The autosave or the unmount save will keep the one typed field as a draft; clear it. */
async function discardMyBenchBatch(page: Page) {
  const r = await callEdgeFunction(page, "data-center-import", { action: "batches" });
  const batches = (r.body as { data?: Record<string, unknown>[] })?.data ?? [];
  for (const b of batches) {
    if (b.source === "workbench" && b.state !== "committed" && b.state !== "rolled_back") {
      await callEdgeFunction(page, "data-center-import", { action: "discard", batchId: b.id });
    }
  }
}

test("a refused finish names the fields, in page order, and focuses the first", async ({
  page,
}) => {
  const opened = await openFirstStove(page);
  expect(opened, "the twin partner is not in the funnel on this database").toBe(true);
  try {
    // A first name and nothing else, then finish. Nothing is written for this:
    // the refusal happens in the browser before any request.
    await page.locator("#wb-endUserName").fill("Named");
    await page.getByRole("button", { name: "Save as finished" }).click();

    // Named, not counted. Surname is the first missing thing on the page.
    await expect(
      page.getByText(/^Still to sort out: Surname,/),
      "the box should name the fields in page order, beginning with Surname",
    ).toBeVisible();

    // The first problem has focus, which is the same as saying it was brought
    // into view.
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.id ?? ""), {
        message: "the first missing field should have been focused",
      })
      .toBe("wb-endUserSurname");

    // And it is ringed, so it can be seen from across the form.
    const ringed = page
      .locator("#wb-endUserSurname")
      .locator("xpath=ancestor::div[contains(@class,'ring-2')][1]");
    await expect(ringed, "the missing field should be ringed in red").toHaveCount(1);
  } finally {
    await discardMyBenchBatch(page);
  }
});
