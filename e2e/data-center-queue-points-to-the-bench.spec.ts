import { test, expect, type Page } from "@playwright/test";
import { callEdgeFunction, signIn, USERS } from "./helpers";

/**
 * A bench batch with nothing waiting offers the bench, not a greyed button.
 *
 * On 2026-09-02 the confirmation queue showed "0 records waiting, 27 still
 * being typed" and six rows each ending in a disabled "Confirm 0". The person
 * looking at it could not tell what to press next, because there was nothing
 * to press: a draft is finished at the bench, and the queue did not say so or
 * take them there. Against the old queue the "Open the bench" button does not
 * exist, which is where this fails.
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

async function mine(page: Page): Promise<{ status: string }[]> {
  const r = await callEdgeFunction(page, "data-center-import", { action: "workbench_queue" });
  return (r.body as { data?: { mine?: { status: string }[] } })?.data?.mine ?? [];
}

async function discardMyBenchBatch(page: Page) {
  const r = await callEdgeFunction(page, "data-center-import", { action: "batches" });
  const batches = (r.body as { data?: Record<string, unknown>[] })?.data ?? [];
  for (const b of batches) {
    if (b.source === "workbench" && b.state !== "committed" && b.state !== "rolled_back") {
      await callEdgeFunction(page, "data-center-import", { action: "discard", batchId: b.id });
    }
  }
}

test("a drafts-only bench batch offers 'Open the bench' and the button lands there", async ({
  page,
}, testInfo) => {
  const opened = await openFirstStove(page);
  expect(opened, "the twin partner is not in the funnel on this database").toBe(true);
  const marker = `Queue${testInfo.workerIndex}${Date.now() % 100000}`;
  try {
    // One draft, saved on purpose.
    await page.locator("#wb-endUserSurname").fill(marker);
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect
      .poll(async () => (await mine(page)).some((m) => m.status === "draft"), {
        timeout: 30_000,
        message: "the draft should be on the server",
      })
      .toBe(true);

    // The queue, as the operator sees it.
    await page.getByRole("button", { name: /Waiting to confirm/ }).click();
    const bench = page.locator("section", { hasText: "Typed at the bench" });
    await expect(bench).toBeVisible({ timeout: 30_000 });
    const row = bench.locator("tbody tr", { hasText: PARTNER_NAME }).first();
    await expect(row, "the admin's bench batch should be listed").toBeVisible({ timeout: 30_000 });

    // The whole point: a way forward instead of a greyed button.
    await expect(
      row.getByRole("button", { name: /Confirm/ }),
      "nothing is waiting, so no Confirm should be offered on this row",
    ).toHaveCount(0);
    const open = row.getByRole("button", { name: "Open the bench" });
    await expect(open, "a drafts-only row should offer the bench").toBeVisible();
    await expect(
      bench.getByText(/finished at the bench, by the person typing/),
      "the table should say where drafts are finished",
    ).toBeVisible();

    await open.click();
    await expect(
      page.getByPlaceholder("Search by name"),
      "the button should land on the bench",
    ).toBeVisible({ timeout: 30_000 });
  } finally {
    await discardMyBenchBatch(page);
  }
});
