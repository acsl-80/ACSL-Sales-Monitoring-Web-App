import { test, expect, type Page } from "@playwright/test";
import { callEdgeFunction, signIn, USERS } from "./helpers";

/**
 * A receipt typed at the bench finishes without a drawn signature, and a bench
 * batch that is still being typed says so instead of offering a check that
 * does nothing.
 *
 * On 2026-09-02 two typists digitised ten receipts at the bench and not one
 * could be confirmed. Every row sat at status `draft` with `normalized` null:
 * the fingerprint of a finish that never reached the server. It never did,
 * because the bench's client-side gate is the sales app's own Sell Stove
 * validator, and that validator demands a customer signature drawn on a pad.
 * A digitised paper receipt was signed on paper weeks ago and has nothing to
 * draw. The Data Center's validator, the file import path and create-sale all
 * carry `signature` as optional. Eight of the ten rows passed the server's
 * validator as they stood; the browser refused all ten with "1 field still to
 * sort out".
 *
 * The second test covers what the operator then saw: the import history
 * offered "Check the rows" on those batches, and `validate` selects staged,
 * valid, rejected and exception rows and never a draft, so pressing it flipped
 * a batch to `validated` with zero valid rows and changed nothing else.
 *
 * Both are driven through the screen. Against the old code the first shows
 * the "still to sort out" refusal and the row stays a draft; the second finds
 * the button.
 */

const PARTNER = "a0000000-0000-4000-8000-00000000000a";
const PARTNER_NAME = "Twin Name Partner";

test.describe.configure({ timeout: 240_000 });

async function openTwinSweep(page: Page): Promise<boolean> {
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
  // The scope line only exists once the sweep has loaded its first page.
  await expect(page.getByText(/all consignments/).first()).toBeVisible({ timeout: 30_000 });
  /*
   * Choosing the partner opens the sweep, not a receipt. The first stove in
   * the sweep opens the bench; this is the click the first version of this
   * helper left out, so the form was expected on the wrong screen.
   */
  await page.locator("tbody tr").first().click();
  await expect(page.locator("#wb-endUserName")).toBeVisible({ timeout: 30_000 });
  return true;
}

/** Everything the paper receipt states. Deliberately NO stroke on the pad. */
async function fillReceiptWithoutSigning(page: Page, marker: string) {
  await page.locator("#wb-endUserName").fill("Unsigned");
  await page.locator("#wb-endUserSurname").fill(marker);
  await page.locator("#wb-phone").fill("08015550222");
  await page.locator("#wb-address").fill(`${marker} Street`);
  await page.locator("#wb-amount").fill("1000");
  /*
   * Paid in full. A receipt that names no sales model can only go through
   * create-sale's outright door, and that door is only honest when paid equals
   * the amount; the commit has always refused the alternative and the bench
   * now refuses it at the same moment. The signature is the point of this
   * spec, so the receipt is otherwise the plainest one there is.
   */
  await page.locator("#wb-amountReceived").fill("1000");
  const state = page.getByRole("combobox", { name: "State" });
  await state.click();
  await page.getByPlaceholder("Type part of the state").fill("Kogi");
  await page.getByRole("listbox").getByRole("option", { name: "Kogi", exact: true }).click();
  const lga = page.getByRole("combobox", { name: "Local government area" });
  await expect(lga).toBeEnabled();
  await lga.click();
  await page.getByRole("listbox").getByRole("option", { name: "Yagba West", exact: true }).click();
  const terms = page
    .locator('label:has-text("The buyer agreed to all six") input[type="checkbox"]')
    .first();
  await terms.check();
  await expect(terms).toBeChecked();
}

/** The typist's own bench rows, as the server holds them. */
async function mine(page: Page): Promise<{ stove_serial_no: string; status: string }[]> {
  const r = await callEdgeFunction(page, "data-center-import", { action: "workbench_queue" });
  return (
    (r.body as { data?: { mine?: { stove_serial_no: string; status: string }[] } })?.data?.mine ??
    []
  );
}

/** Clear the admin's bench batch for this partner, through the product. */
async function discardMyBenchBatch(page: Page) {
  const r = await callEdgeFunction(page, "data-center-import", { action: "batches" });
  const batches = (r.body as { data?: Record<string, unknown>[] })?.data ?? [];
  const bench = batches.filter(
    (b) => b.source === "workbench" && b.state !== "committed" && b.state !== "rolled_back",
  );
  for (const b of bench) {
    await callEdgeFunction(page, "data-center-import", { action: "discard", batchId: b.id });
  }
}

test.describe("the bench and a paper receipt", () => {
  test("a receipt with everything but a drawn signature finishes", async ({ page }, testInfo) => {
    const opened = await openTwinSweep(page);
    expect(opened, "the twin partner is not in the funnel on this database").toBe(true);

    const marker = `NoSig${testInfo.workerIndex}${Date.now() % 100000}`;
    try {
      await fillReceiptWithoutSigning(page, marker);
      await page.getByRole("button", { name: "Save as finished" }).click();

      /*
       * The whole point. Old gate: "1 field still to sort out" and the row
       * stays a draft the queue reports as "still being typed". New gate: the
       * finish reaches the server and the row is valid.
       */
      await expect(
        page.getByText(/still to sort out/),
        "a paper receipt must not be refused for the signature it carries on paper",
      ).toHaveCount(0);

      await expect
        .poll(async () => (await mine(page)).find((m) => m.status === "valid")?.status ?? null, {
          timeout: 30_000,
          message: "the finished receipt should be valid on the server",
        })
        .toBe("valid");
    } finally {
      await discardMyBenchBatch(page);
    }
  });

  test("a bench batch still being typed is not offered 'Check the rows'", async ({
    page,
  }, testInfo) => {
    const opened = await openTwinSweep(page);
    expect(opened, "the twin partner is not in the funnel on this database").toBe(true);

    const marker = `Draft${testInfo.workerIndex}${Date.now() % 100000}`;
    try {
      // A draft, and nothing more: one field, saved as a draft.
      await page.locator("#wb-endUserSurname").fill(marker);
      await page.getByRole("button", { name: "Save draft" }).click();
      await expect
        .poll(async () => (await mine(page)).some((m) => m.status === "draft"), {
          timeout: 30_000,
          message: "the draft should be on the server",
        })
        .toBe(true);

      // Back to the history, where the batch is listed as "(typed in, no file)".
      await page.goto("/data-center/import");
      await expect(page.getByRole("heading", { name: "Bulk Import" })).toBeVisible({
        timeout: 30_000,
      });
      const row = page
        .getByRole("cell", { name: "(typed in, no file)", exact: true })
        .first()
        .locator("xpath=ancestor::tr[1]");
      await expect(row, "the bench batch should be in the history").toBeVisible({
        timeout: 30_000,
      });
      // The step row follows the batch row.
      const step = row.locator("xpath=following-sibling::tr[1]");
      await expect(
        step.getByText(/still being typed at the bench/),
        "a draft-only bench batch should say it is being typed, not that it is unchecked",
      ).toBeVisible();
      await expect(
        step.getByRole("button", { name: "Check the rows" }),
        "validate skips drafts, so offering it here is a button that does nothing",
      ).toHaveCount(0);
    } finally {
      await discardMyBenchBatch(page);
    }
  });
});
