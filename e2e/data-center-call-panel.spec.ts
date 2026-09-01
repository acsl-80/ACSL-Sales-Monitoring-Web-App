import { test, expect, type Page } from "@playwright/test";
import { signIn, USERS, callEdgeFunction } from "./helpers";

/**
 * A call sheet, once uploaded, stays findable.
 *
 * WHAT THIS IS FOR
 *
 * The call sheet held its batch in component state and nothing else. Close the
 * tab after uploading and the rows were still in the database with no screen
 * that would show them - not on this tab, because there was no list, and not
 * on the receipt tab either once that started filtering by source. The work
 * did not break; it became invisible, which on a 359-row weekly backlog is the
 * same thing.
 *
 * The second claim is the one the receipt panel has always made and this side
 * never did: what is wrong with a row is readable BEFORE anything is written,
 * not after.
 *
 * UI-level on purpose, unlike the two server-level call specs beside it. Every
 * claim here is about what somebody can see and reach, which is exactly what a
 * server assertion cannot answer.
 */

test.describe.configure({ timeout: 180_000 });

async function freeStove(page: Page): Promise<string | null> {
  const q = await callEdgeFunction(page, "data-center-read", {
    action: "call_queue",
    limit: 50,
    filters: { hasCallRecord: false },
  });
  const rows = (q.body as { data?: { rows?: { stove_serial_no: string }[] } })?.data?.rows ?? [];
  return rows[0]?.stove_serial_no ?? null;
}

/** Stage and check a one-row call batch through the API, then look at it. */
async function stagedBatch(page: Page, stove: string): Promise<string> {
  const staged = await callEdgeFunction(page, "data-center-import", {
    action: "call_stage",
    rows: [{ "Stove ID": stove, Verification: "Fully verified" }],
    filename: `e2e-panel-${Date.now()}.csv`,
    confirmDuplicate: true,
  });
  expect(staged.status, "the sheet should stage").toBe(200);
  const batchId = (staged.body as { data: { batchId: string } }).data.batchId;
  const checked = await callEdgeFunction(page, "data-center-import", {
    action: "call_validate",
    batchId,
  });
  expect(checked.status, "the sheet should check").toBe(200);
  return batchId;
}

async function openCallsTab(page: Page) {
  await page.goto("/data-center/import");
  await expect(page.getByRole("heading", { name: "Bulk Import" })).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole("button", { name: "Calls already made" }).click();
}

test.describe("an uploaded sheet stays findable", () => {
  test("a staged batch is in the list after a full reload", async ({ page }) => {
    await signIn(page, USERS.dataManager);
    const stove = await freeStove(page);
    expect(stove, "the preview has no uncalled sale to work with").toBeTruthy();

    const batchId = await stagedBatch(page, stove as string);

    /*
     * A fresh navigation, not a re-render. The defect was that the batch lived
     * in component state, so anything that unmounted the component lost it -
     * and a reload is the cheapest way to prove the list reads the server
     * rather than remembering.
     */
    await openCallsTab(page);

    const list = page.getByRole("heading", { name: "Sheets uploaded" });
    await expect(list, "the call tab should carry its own list of sheets").toBeVisible({
      timeout: 20_000,
    });

    // The batch is on it, and it says what it still needs.
    await expect(
      page.getByText(/row is ready to attach|rows are ready to attach/).first(),
    ).toBeVisible();

    await callEdgeFunction(page, "data-center-import", { action: "call_discard", batchId });
  });

  test("a call batch never appears on the receipt tab", async ({ page }) => {
    await signIn(page, USERS.dataManager);
    const stove = await freeStove(page);
    expect(stove, "the preview has no uncalled sale to work with").toBeTruthy();

    const batchId = await stagedBatch(page, stove as string);
    const shortId = batchId.slice(0, 8);

    await page.goto("/data-center/import");
    await expect(page.getByRole("heading", { name: "Bulk Import" })).toBeVisible({
      timeout: 20_000,
    });

    /*
     * The receipt panel used to render this batch identically to one of its
     * own, with next-step buttons wired to the RECEIPT validate and commit.
     * Those read a row's `normalized` as a sale payload, and a call row's
     * normalized is `{values, attempts}`.
     */
    await expect(
      page.getByText(new RegExp(shortId)),
      "a call batch must not be listed among the receipt batches",
    ).toHaveCount(0);

    await callEdgeFunction(page, "data-center-import", { action: "call_discard", batchId });
  });

  test("a validated call batch is not offered in the confirmation queue", async ({ page }) => {
    await signIn(page, USERS.dataManager);
    const stove = await freeStove(page);
    expect(stove, "the preview has no uncalled sale to work with").toBeTruthy();

    const batchId = await stagedBatch(page, stove as string);

    /*
     * This one was reachable and destructive. A validated call batch has
     * `valid` rows with confirmed_at null, which is exactly what the view
     * counted, so it appeared under "Uploaded in bulk" - and that tab's
     * Confirm button calls the RECEIPT commit. Every row in the batch would
     * have come back an exception.
     */
    const awaiting = await callEdgeFunction(page, "data-center-import", {
      action: "awaiting_confirmation",
    });
    const said = JSON.stringify(awaiting.body);
    expect(
      said.includes(batchId),
      "a call batch must not be offered to the receipt commit through the confirmation queue",
    ).toBe(false);

    await callEdgeFunction(page, "data-center-import", { action: "call_discard", batchId });
  });
});

test.describe("what is wrong is readable before anything is written", () => {
  test("exceptions are grouped on the batch, with the reason against each row", async ({
    page,
  }) => {
    await signIn(page, USERS.dataManager);

    // One row that cannot possibly match, so the batch has an exception to show.
    const staged = await callEdgeFunction(page, "data-center-import", {
      action: "call_stage",
      rows: [{ "Stove ID": "ZZZ999999", Verification: "Fully verified" }],
      filename: `e2e-panel-exc-${Date.now()}.csv`,
      confirmDuplicate: true,
    });
    const batchId = (staged.body as { data: { batchId: string } }).data.batchId;
    await callEdgeFunction(page, "data-center-import", { action: "call_validate", batchId });

    await openCallsTab(page);
    await expect(page.getByRole("heading", { name: "Sheets uploaded" })).toBeVisible({
      timeout: 20_000,
    });

    // Open the batch. Its row is the one carrying this batch's filename.
    await page.getByRole("row").filter({ hasText: "e2e-panel-exc" }).first().click();

    /*
     * The group title, not the raw reason. A flat list of reasons is not a
     * worklist; the grouping is what turned 331 rows on the real file into
     * five decisions.
     */
    await expect(
      page.getByText("The receipt has not been digitalised yet"),
      "the exception should be grouped by what is actually wrong",
    ).toBeVisible({ timeout: 15_000 });

    // And it is marked as the kind nobody should work row by row.
    await expect(
      page.getByText("clears itself").first(),
      "this group resolves elsewhere, and saying so is what stops 122 rows being typed one at a time",
    ).toBeVisible();

    // The correction file is offered from here.
    await expect(
      page.getByRole("button", { name: /Download the rows to fix/ }),
      "what did not land has to be able to leave as a file",
    ).toBeVisible();

    await callEdgeFunction(page, "data-center-import", { action: "call_discard", batchId });
  });

  test("the correction file carries the original columns, the reason and the fix", async ({
    page,
  }) => {
    await signIn(page, USERS.dataManager);

    const staged = await callEdgeFunction(page, "data-center-import", {
      action: "call_stage",
      // No stove ID at all: unreadable rather than an exception, which is the
      // class that carries a hint.
      rows: [{ "Stove ID": "", Verification: "Fully verified", "Other Comments": "keep me" }],
      filename: `e2e-panel-rework-${Date.now()}.csv`,
      confirmDuplicate: true,
    });
    const batchId = (staged.body as { data: { batchId: string } }).data.batchId;
    await callEdgeFunction(page, "data-center-import", { action: "call_validate", batchId });

    await openCallsTab(page);
    await page.getByRole("row").filter({ hasText: "e2e-panel-rework" }).first().click();

    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: /Download the rows to fix/ }).click();
    const file = await download;

    const body = await file.createReadStream().then(async (s) => {
      const chunks: Buffer[] = [];
      for await (const c of s!) chunks.push(c as Buffer);
      return Buffer.concat(chunks).toString("utf8");
    });

    expect(body, "the file keeps the columns the person typed").toContain("Other Comments");
    expect(body, "and what they typed in them").toContain("keep me");
    expect(body, "and why the row did not land").toContain("Why it did not land");
    expect(
      body,
      "and what to do about it - the column that was empty for every call refusal before hints existed",
    ).toContain("How to fix it");

    await callEdgeFunction(page, "data-center-import", { action: "call_discard", batchId });
  });
});
