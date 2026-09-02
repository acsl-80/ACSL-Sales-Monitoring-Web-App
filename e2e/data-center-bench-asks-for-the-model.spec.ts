import { test, expect, type Page } from "@playwright/test";
import { branchSql, callEdgeFunction, signIn, USERS } from "./helpers";

/**
 * The bench asks for the sales model, and a part payment cannot be finished
 * without one.
 *
 * On 2026-09-02 two typists digitised twenty-five receipts at the bench. Every
 * one was a part payment (3,500 received against 42,000) and the bench had no
 * sales model field, so no row carried one. create-sale's outright door
 * records the full amount as paid, so the commit rightly refused them all -
 * and stamped the four batches "committed" with nothing written.
 *
 * The bench now offers the partner's models, preselects a single assigned
 * one, and refuses a part payment with no model by name, on the field, before
 * any request is made. Against the old bench the picker does not exist, which
 * is where the first assertion fails.
 *
 * The Kogi twin has no models assigned, so every active model is offered and
 * nothing is preselected: the typist picks from the receipt. That is the host
 * form's own rule ("only an explicit list restricts").
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

/** Everything the paper receipt states, as a PART payment: 500 of 1000. */
async function fillPartPaidReceipt(page: Page, marker: string) {
  await page.locator("#wb-endUserName").fill("Model");
  await page.locator("#wb-endUserSurname").fill(marker);
  await page.locator("#wb-phone").fill("08015550333");
  await page.locator("#wb-address").fill(`${marker} Street`);
  await page.locator("#wb-amount").fill("1000");
  await page.locator("#wb-amountReceived").fill("500");
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

async function discardMyBenchBatch(page: Page) {
  const r = await callEdgeFunction(page, "data-center-import", { action: "batches" });
  const batches = (r.body as { data?: Record<string, unknown>[] })?.data ?? [];
  for (const b of batches) {
    if (b.source === "workbench" && b.state !== "committed" && b.state !== "rolled_back") {
      await callEdgeFunction(page, "data-center-import", { action: "discard", batchId: b.id });
    }
  }
}

test.describe("the bench and the sales model", () => {
  test("a part payment with no model is refused on the field, before any request", async ({
    page,
  }, testInfo) => {
    const opened = await openFirstStove(page);
    expect(opened, "the twin partner is not in the funnel on this database").toBe(true);
    const marker = `NoModel${testInfo.workerIndex}${Date.now() % 100000}`;
    try {
      // The picker exists, offers the active models, and has nothing chosen
      // for a partner with no list of its own.
      const picker = page.locator("#wb-salesModel");
      await expect(picker, "the bench should ask for the sales model").toBeVisible();
      await expect(picker).toHaveValue("");
      await expect(
        picker.locator("option", { hasText: "Amina Sales Model" }),
        "the active models should be offered",
      ).toHaveCount(1);

      await fillPartPaidReceipt(page, marker);
      await page.getByRole("button", { name: "Save as finished" }).click();

      // Named, ringed, and focused - the pointing from the previous fix, on
      // the new rule.
      await expect(page.getByText(/^Still to sort out: Sales model/)).toBeVisible();
      await expect
        .poll(() => page.evaluate(() => document.activeElement?.id ?? ""))
        .toBe("wb-salesModel");
      await expect(
        page.getByText(/balance is tracked against the sales model/),
        "the field should say why it is needed",
      ).toBeVisible();

      // And the server agrees: nothing valid was written for this stove.
      const q = await callEdgeFunction(page, "data-center-import", { action: "workbench_queue" });
      const mine =
        (q.body as { data?: { mine?: { status: string }[] } })?.data?.mine ?? [];
      expect(mine.some((m) => m.status === "valid"), "no finished row should exist").toBe(false);
    } finally {
      await discardMyBenchBatch(page);
    }
  });

  test("with the model picked, the part payment finishes and carries the model's id", async ({
    page,
  }, testInfo) => {
    const opened = await openFirstStove(page);
    expect(opened, "the twin partner is not in the funnel on this database").toBe(true);
    const marker = `WithModel${testInfo.workerIndex}${Date.now() % 100000}`;
    const stoveId = (await page.locator("#wb-endUserName").evaluate(() => {
      const el = document.querySelector("p.font-mono");
      return el?.textContent?.trim() ?? "";
    })) as string;
    expect(stoveId, "the bench should print the stove it opened").toMatch(/^TWN/);
    try {
      await fillPartPaidReceipt(page, marker);
      await page.locator("#wb-salesModel").selectOption({ value: "Amina Sales Model" });
      // The typed amount is kept: a picked model fills only an EMPTY amount.
      await expect(page.locator("#wb-amount")).toHaveValue("1000");
      await page.getByRole("button", { name: "Save as finished" }).click();
      await expect(page.getByText(/still to sort out/i)).toHaveCount(0);

      // Valid on the server, and the row carries the sales app's own model id,
      // which is what the commit's installment door reads.
      await expect
        .poll(
          async () => {
            const [r] = await branchSql<{ status: string; model: string | null }>(
              `select r.status, r.normalized->>'paymentModelId' as model
                 from data_center.import_rows r
                 join data_center.import_batches b on b.id = r.batch_id
                where b.source = 'workbench' and upper(r.stove_serial_no) = upper('${stoveId}')
                order by r.last_edited_at desc nulls last limit 1`,
            );
            return r ? `${r.status}:${r.model ? "model" : "no-model"}` : "none";
          },
          { timeout: 30_000, message: "the finished row should be valid and carry the model" },
        )
        .toBe("valid:model");
    } finally {
      await discardMyBenchBatch(page);
    }
  });
});
