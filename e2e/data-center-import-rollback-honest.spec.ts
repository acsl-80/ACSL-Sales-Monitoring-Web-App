import { test, expect, type Page } from "@playwright/test";
import { branchSql, callEdgeFunction, commitAndDrain, signIn, USERS } from "./helpers";

/**
 * A rollback that removed nothing says so.
 *
 * The server has always been honest here. When delete-sale refuses a row,
 * `rollback` answers with `reversed: 0, done: false` and the reason in
 * `failures`, and it leaves the batch as `committed` rather than pretending.
 * The panel was the one lying: it broke out of its loop on `reversed === 0`
 * and then set the success notice unconditionally, so an operator without
 * delete rights was told "Rolled back. 0 sales reversed." over a batch that
 * had not changed at all. client.ts compounded it by typing the response
 * without `failures`, so the reason was dropped before it could be shown.
 *
 * Found because six fixture batches survived four green spec runs: the spec
 * had copied the panel's mistake and trusted the status code too.
 *
 * The data manager is the right account for this. It holds import.commit, so
 * it can create the batch, and it is not an admin, so delete-sale refuses it.
 * Against the old panel the notice appears and this fails; against the new
 * one the refusal is shown in the operator's own words from the server.
 */

const PARTNER = "a0000000-0000-4000-8000-00000000000a";
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,64}$/;

test.describe.configure({ timeout: 240_000 });

async function freeStove(page: Page): Promise<string | null> {
  const r = await callEdgeFunction(page, "data-center-read", {
    action: "partner_stoves",
    organizationId: PARTNER,
    limit: 200,
  });
  const stoves =
    (r.body as { data?: { stoves?: { stove_id: string; sale_id: string | null }[] } })?.data
      ?.stoves ?? [];
  return stoves.find((s) => !s.sale_id)?.stove_id ?? null;
}

test("the panel reports a refused rollback as a failure, not a success", async ({
  page,
}, testInfo) => {
  await signIn(page, USERS.dataManager);

  const serial = await freeStove(page);
  expect(serial, "the preview has no free stove for this partner").toBeTruthy();
  expect(SAFE_ID.test(serial as string), "stove id is not a shape this spec puts in SQL").toBe(
    true,
  );

  const filename = `rollback-honest${testInfo.workerIndex}-${Date.now()}.csv`;
  let batchId: string | null = null;
  try {
    const staged = await callEdgeFunction(page, "data-center-import", {
      action: "stage",
      filename,
      rows: [
        {
          stove_serial_no: serial,
          sales_model: "Amina Model",
          first_name: "Honest",
          last_name: "Rollback",
          phone: "08054449001",
          sales_date: "2026-01-06",
          state: "Kogi",
          lga: "Isanlu",
          address: `${filename} Road`,
        },
      ],
      confirmDuplicate: true,
    });
    expect(staged.status, "the receipt should stage").toBe(200);
    batchId = (staged.body as { data: { batchId: string } }).data.batchId;

    const validated = await callEdgeFunction(page, "data-center-import", {
      action: "validate",
      batchId,
    });
    expect(validated.status, "the receipt should check").toBe(200);

    const done = await commitAndDrain(page, batchId);
    expect(done.state, "the fixture batch should commit").toBe("committed");

    // Now press the button the way an operator would.
    await page.goto("/data-center/import");
    await expect(page.getByRole("heading", { name: "Bulk Import" })).toBeVisible({
      timeout: 30_000,
    });

    /*
     * The batch list is a table, and the actions live in the row's expanded
     * detail, which only renders after the row is opened. The FIRST cell is
     * clicked rather than the row's centre: this suite already learned that a
     * row's middle can land on a link with stopPropagation.
     */
    const row = page
      .getByRole("cell", { name: filename, exact: true })
      .locator("xpath=ancestor::tr[1]");
    await expect(row, "the committed batch should be listed").toBeVisible({ timeout: 30_000 });
    await row.getByRole("cell").first().click();

    const rollBack = page.getByRole("button", { name: /^Roll back / });
    await expect(rollBack, "opening the row should offer exactly one Roll back").toHaveCount(1, {
      timeout: 15_000,
    });
    await rollBack.click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: /^Roll back / })
      .click();

    /*
     * The whole point. Old panel: "Rolled back. 0 sales reversed." in the
     * success colour. New panel: the server's own reason, as an error.
     */
    await expect(
      page.getByText(/Rollback stopped\./),
      "a rollback that removed nothing must not be reported as done",
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByText(/Admin privileges required/i),
      "the reason delete-sale gave should reach the operator unchanged",
    ).toBeVisible();
    await expect(
      page.getByText(/^Rolled back\./),
      "the success notice must not appear",
    ).toHaveCount(0);

    // And the message is true: the sale is still there.
    const [live] = await branchSql<{ n: number }>(
      `select count(*)::int as n from public.sales
        where upper(btrim(stove_serial_no)) = upper(btrim('${serial}'))
          and is_archived is not true`,
    );
    expect(live.n, "the refused rollback should have left the sale standing").toBe(1);
  } finally {
    /*
     * This account cannot roll back, which is the premise, so the fixture is
     * cleared in SQL. Stock first, because the check constraint permits 'sold'
     * only while sale_id is set; then the sale; then the batch, whose rows and
     * claims cascade.
     */
    await branchSql(
      `update public.stove_ids_base set status = 'available', sale_id = null
        where upper(stove_id) = upper('${serial}')`,
    );
    await branchSql(
      `delete from public.sales
        where upper(btrim(stove_serial_no)) = upper(btrim('${serial}'))`,
    );
    if (batchId) {
      await branchSql(`delete from data_center.import_batches where id = '${batchId}'`);
    }
  }
});
