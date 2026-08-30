import { test, expect, type Page } from "@playwright/test";
import { callEdgeFunction, signIn, USERS } from "./helpers";

/**
 * An import says who did it, what it is doing, and what did not land.
 *
 * Three separate claims, and the third is the one that was not true. Both
 * imports had a reason for every failed row and neither showed it: the receipt
 * one reported "Commit finished." over any number that did not, and the call
 * one painted a green box reading "12 rows did not go through and kept its
 * reason", which says a reason exists without saying what it is.
 */

const TWIN_A = "a0000000-0000-4000-8000-00000000000a";

async function freeStove(page: Page, org: string): Promise<string | null> {
  const r = await callEdgeFunction(page, "data-center-read", {
    action: "partner_stoves",
    organizationId: org,
    limit: 100,
  });
  const stoves =
    (r.body as { data?: { stoves?: { stove_id: string; sale_id: string | null }[] } })?.data
      ?.stoves ?? [];
  return stoves.find((s) => !s.sale_id)?.stove_id ?? null;
}

const buyer = (serial: string, marker: string, phone: string) => ({
  stove_serial_no: serial,
  first_name: "Credited",
  last_name: "Buyer",
  phone,
  sales_date: "2026-01-04",
  amount: "25000",
  state: "Kogi",
  lga: "Isanlu",
  address: `${marker} Road`,
});

test.describe("an import is credited and accounted for", () => {
  test("the sale is credited to the account that imported it", async ({ page }, testInfo) => {
    /*
     * Not a formality. The import writes through create-sale with the caller's
     * own token rather than a service key, which is what makes the sale theirs
     * and what makes org scoping apply to them. If that ever became a service
     * call, every imported sale would belong to nobody and this is what would
     * notice.
     */
    await signIn(page, USERS.admin);
    await page.goto("/data-center/import");

    const serial = await freeStove(page, TWIN_A);
    test.skip(!serial, "no free stove left on this database");

    const marker = `credit${testInfo.workerIndex}-${Date.now()}`;
    const staged = await callEdgeFunction(page, "data-center-import", {
      action: "stage",
      filename: `${marker}.csv`,
      rows: [buyer(serial!, marker, "08012340001")],
    });
    expect(staged.status).toBe(200);
    const batchId = (staged.body as { data: { batchId: string } }).data.batchId;

    await callEdgeFunction(page, "data-center-import", { action: "validate", batchId });
    const committed = await callEdgeFunction(page, "data-center-import", {
      action: "commit",
      batchId,
    });
    expect(committed.status).toBe(200);

    const detail = await callEdgeFunction(page, "data-center-read", {
      action: "stove_detail",
      stoveId: serial,
    });
    const sale = (detail.body as { data?: { sale?: Record<string, unknown> | null } })?.data?.sale;
    expect(sale, "the import should have created a sale").toBeTruthy();
    expect(sale?.created_by_email).toBe(USERS.admin);
  });

  test("the batch records who uploaded it and who committed it", async ({ page }, testInfo) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/import");

    const serial = await freeStove(page, TWIN_A);
    test.skip(!serial, "no free stove left on this database");

    const marker = `who${testInfo.workerIndex}-${Date.now()}`;
    const staged = await callEdgeFunction(page, "data-center-import", {
      action: "stage",
      filename: `${marker}.csv`,
      rows: [buyer(serial!, marker, "08012340002")],
    });
    const batchId = (staged.body as { data: { batchId: string } }).data.batchId;

    // Both list actions answer with the array directly under `data`, not
    // wrapped in a named key.
    const list = await callEdgeFunction(page, "data-center-import", { action: "batches" });
    const rows =
      (list.body as { data?: { id: string; uploaded_by_name: string | null }[] })?.data ?? [];
    const mine = rows.find((b) => b.id === batchId);
    expect(mine, "the batch should be in the history").toBeTruthy();
    expect(mine?.uploaded_by_name).toBe("Preview Super Admin");
  });

  test("a row that cannot land is named, with its reason and its row number", async ({
    page,
  }, testInfo) => {
    /*
     * The reasons were always there. The panel reported a count and threw the
     * reasons away, so somebody with twelve refused rows out of four hundred
     * had no way to know which twelve or why without opening the batch.
     */
    await signIn(page, USERS.admin);
    await page.goto("/data-center/import");

    const serial = await freeStove(page, TWIN_A);
    test.skip(!serial, "no free stove left on this database");

    const marker = `why${testInfo.workerIndex}-${Date.now()}`;
    // The same serial twice: the second row cannot land, and the reason names
    // the row it duplicates.
    const staged = await callEdgeFunction(page, "data-center-import", {
      action: "stage",
      filename: `${marker}.csv`,
      rows: [
        buyer(serial!, marker, "08012340003"),
        buyer(serial!, marker, "08012340004"),
      ],
    });
    const batchId = (staged.body as { data: { batchId: string } }).data.batchId;
    await callEdgeFunction(page, "data-center-import", { action: "validate", batchId });

    const rows = await callEdgeFunction(page, "data-center-import", {
      action: "rows",
      batchId,
      status: "exception",
    });
    const bad =
      (rows.body as { data?: { row_number: number; exception_reason: string | null }[] })?.data ??
      [];

    // One row refused, carrying both what is wrong and where it is.
    expect(bad.length).toBe(1);
    expect(bad[0].row_number).toBe(2);
    expect(bad[0].exception_reason).toMatch(/already appears on row 1/);
  });

  test("the panel walks through named steps rather than one spinner", async ({
    page,
  }, testInfo) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/import");
    await expect(page.getByRole("heading", { name: "Bulk Import" })).toBeVisible({
      timeout: 30_000,
    });

    const serial = await freeStove(page, TWIN_A);
    test.skip(!serial, "no free stove left on this database");

    const marker = `steps${testInfo.workerIndex}-${Date.now()}`;
    await page.locator('input[type="file"]').setInputFiles({
      name: `${marker}.csv`,
      mimeType: "text/csv",
      buffer: Buffer.from(
        [
          "stove_serial_no,first_name,last_name,phone,sales_date,amount,state,lga,address",
          `${serial},Steps,Buyer,08012340005,2026-01-04,25000,Kogi,Isanlu,${marker} Road`,
          `${serial},Steps,Buyer,08012340006,2026-01-04,25000,Kogi,Isanlu,${marker} Road`,
        ].join("\n"),
      ),
    });

    // The steps say what is happening in the words of the job, not the code.
    await expect(page.getByText("Working out which partner each stove belongs to")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText("Checking every row against the stove register")).toBeVisible();

    /*
     * Named on screen BEFORE anybody commits, and worded for that moment:
     * nothing has gone in yet, so saying it had would be false.
     */
    // Phrased for the moment, and asserted on the half that does not change
    // with the count: one bad row reads "as it stands", two read "as they
    // stand", and the sentence after them is the same either way.
    await expect(page.getByText(/Everything else can still be committed/)).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText(/already appears on row 1/)).toBeVisible();
  });
});
