import { test, expect, type Page } from "@playwright/test";
import { callEdgeFunction, signIn, USERS } from "./helpers";

/**
 * The import page, made workable.
 *
 * Three things an operator reported from production on the same afternoon,
 * all of them the screen refusing to be used:
 *
 *   1. Batches accumulate with no way out. A file staged and abandoned, a dry
 *      run reconsidered, a bench batch a typist opened and closed - five of
 *      them inside two days, and Roll back does not appear for any because it
 *      exists to undo sales and these wrote none.
 *
 *   2. The "Fix" button did nothing at all. The input showed
 *      `drafts[id] ?? row.stove_serial_no` while the handler read only
 *      `drafts[id]`, so pressing Fix without first retyping sent an empty
 *      string into a silent `return`. The field looked filled; the button was
 *      inert.
 *
 *   3. 304 exceptions in one flat list, every row offering a serial-correction
 *      box - including the 122 rows where correcting the serial cannot
 *      possibly help, because the fix is an ERP model assignment. Those 122
 *      rows were really 14 assignments; Solar Sister alone appeared under five
 *      spellings.
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

const row = (serial: string, marker: string, phone: string) => ({
  stove_serial_no: serial,
  sales_model: "Amina Model",
  first_name: "Panel",
  last_name: "Spec",
  aka: marker,
  phone,
  sales_date: "2026-01-08",
  state: "Kogi",
});

async function batchOf(page: Page, batchId: string) {
  const r = await callEdgeFunction(page, "data-center-import", { action: "batches", batchId });
  return ((r.body as { data?: Record<string, unknown>[] })?.data ?? []).find(
    (b) => b.id === batchId,
  );
}

test.describe("a batch that wrote nothing can be cleared away", () => {
  test("discard removes a staged batch, and refuses one holding sales", async ({
    page,
  }, testInfo) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/import");

    const stoves = await freeStoves(page, 1);
    test.skip(stoves.length < 1, "no free stove");
    const marker = `disc${testInfo.workerIndex}-${Date.now()}`;

    const staged = await callEdgeFunction(page, "data-center-import", {
      action: "stage",
      filename: `${marker}.csv`,
      rows: [row(stoves[0], marker, "08017770001")],
    });
    const batchId = (staged.body as { data: { batchId: string } }).data.batchId;
    expect(await batchOf(page, batchId), "the batch exists").toBeTruthy();

    const out = await callEdgeFunction(page, "data-center-import", {
      action: "discard",
      batchId,
    });
    expect(out.status).toBe(200);
    expect((out.body as { data: { discarded: boolean } }).data.discarded).toBe(true);
    expect(await batchOf(page, batchId), "and is gone from the list").toBeFalsy();
  });

  test("a batch that has written sales is sent to rollback instead", async ({
    page,
  }, testInfo) => {
    /*
     * The guard is the sale_id column, not the status label - a crash-window
     * row can hold a sale while reading as something other than committed, and
     * discarding it would strand the sale with nothing pointing at it.
     */
    await signIn(page, USERS.admin);
    await page.goto("/data-center/import");

    const stoves = await freeStoves(page, 1);
    test.skip(stoves.length < 1, "no free stove");
    const marker = `guard${testInfo.workerIndex}-${Date.now()}`;

    const staged = await callEdgeFunction(page, "data-center-import", {
      action: "stage",
      filename: `${marker}.csv`,
      rows: [row(stoves[0], marker, "08017770002")],
    });
    const batchId = (staged.body as { data: { batchId: string } }).data.batchId;
    await callEdgeFunction(page, "data-center-import", { action: "validate", batchId });
    await callEdgeFunction(page, "data-center-import", { action: "commit", batchId });

    // Wait for the chain to write the one sale.
    for (let i = 0; i < 30; i++) {
      await page.waitForTimeout(3000);
      const b = await batchOf(page, batchId);
      if (b && Number(b.committed_rows) > 0) break;
    }

    const refused = await callEdgeFunction(page, "data-center-import", {
      action: "discard",
      batchId,
    });
    expect(refused.status, "discard must not touch a batch holding sales").toBe(409);
    expect((refused.body as { code?: string }).code).toBe("has_sales");
    expect((refused.body as { error?: string }).error ?? "").toMatch(/roll it back first/i);

    for (let i = 0; i < 20; i++) {
      const rb = await callEdgeFunction(page, "data-center-import", {
        action: "rollback",
        batchId,
      });
      if ((rb.body as { data?: { done?: boolean } })?.data?.done) break;
    }
    const after = await callEdgeFunction(page, "data-center-import", {
      action: "discard",
      batchId,
    });
    expect(after.status, "and works once the sales are reversed").toBe(200);
  });
});

test.describe("an exception says what would change it", () => {
  test("the groups carry the counts, and only the fixable ones offer a serial", async ({
    page,
  }, testInfo) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/import");
    await expect(page.getByRole("heading", { name: "Bulk Import" })).toBeVisible({
      timeout: 30_000,
    });

    const real = await freeStoves(page, 1);
    test.skip(real.length < 1, "no free stove");
    const marker = `exc${testInfo.workerIndex}-${Date.now()}`;
    /*
     * One REAL serial, because staging refuses a file in which nothing
     * resolves - it cannot tell whose sheet it is. The bogus ones then become
     * the exceptions this spec is about.
     */
    const staged = await callEdgeFunction(page, "data-center-import", {
      action: "stage",
      filename: `${marker}.csv`,
      rows: [
        { ...row(real[0], marker, "08017770003") },
        { ...row("999000111222", marker, "08017770004") },
        { ...row("999000111333", marker, "08017770005") },
        { ...row("999000111333", marker, "08017770006") },
      ],
    });
    expect(staged.status, "the file stages because one serial resolves").toBe(200);
    const batchId = (staged.body as { data: { batchId: string } }).data.batchId;
    await callEdgeFunction(page, "data-center-import", { action: "validate", batchId });
    await page.reload();

    // Open the batch's own row, then its exceptions.
    await page.getByText(`${marker}.csv`).click();
    const notInStock = page.getByText("The serial number matches nothing in stock");
    await expect(notInStock).toBeVisible({ timeout: 30_000 });
    // The count travels with the group - the whole point of grouping.
    await expect(page.getByText(/\d+ rows?/).first()).toBeVisible();

    await notInStock.click();
    // A fixable group offers the correction, pre-filled with the serial as
    // staged - which is exactly the state the old button silently ignored.
    const fix = page.getByRole("button", { name: "Fix" }).first();
    await expect(fix).toBeVisible();

    await callEdgeFunction(page, "data-center-import", { action: "discard", batchId });
  });

  test("pressing Fix without retyping is answered, not ignored", async ({
    page,
  }, testInfo) => {
    /*
     * The exact production report: "you have the Fix button, but when clicked
     * nothing happens". The handler read a different value from the one the
     * input displayed, so an untouched field meant an empty string and a
     * silent return. Now it either resolves or says why.
     */
    await signIn(page, USERS.admin);
    await page.goto("/data-center/import");
    await expect(page.getByRole("heading", { name: "Bulk Import" })).toBeVisible({
      timeout: 30_000,
    });

    const real = await freeStoves(page, 2);
    test.skip(real.length < 2, "need two free stoves");
    const marker = `fix${testInfo.workerIndex}-${Date.now()}`;
    // real[0] anchors the file so it stages; real[1] is what the bogus row is
    // corrected TO.
    const staged = await callEdgeFunction(page, "data-center-import", {
      action: "stage",
      filename: `${marker}.csv`,
      rows: [
        { ...row(real[0], marker, "08017770007") },
        { ...row("999000444555", marker, "08017770008") },
      ],
    });
    expect(staged.status).toBe(200);
    const batchId = (staged.body as { data: { batchId: string } }).data.batchId;
    await callEdgeFunction(page, "data-center-import", { action: "validate", batchId });
    await page.reload();

    await page.getByText(`${marker}.csv`).click();
    await page.getByText("The serial number matches nothing in stock").click();

    // Press Fix with the field exactly as it came - the case that did nothing.
    const fix = page.getByRole("button", { name: "Fix" }).first();
    await fix.click();
    /*
     * Something must happen. The serial genuinely is not in stock, so the
     * honest answer is the server's refusal shown against the row - never
     * silence.
     */
    await expect(
      page.getByText(/not in stock|did not resolve|Type the correct/i).first(),
    ).toBeVisible({ timeout: 20_000 });

    // And a real correction resolves it.
    const box = page.getByRole("textbox", { name: /Corrected serial number/ }).first();
    await box.fill(real[1]);
    await page.getByRole("button", { name: "Fix" }).first().click();
    await expect
      .poll(async () => {
        const b = await batchOf(page, batchId);
        return Number(b?.valid_rows ?? 0);
      }, { timeout: 30_000 })
      .toBe(2);

    await callEdgeFunction(page, "data-center-import", { action: "discard", batchId });
  });
});
