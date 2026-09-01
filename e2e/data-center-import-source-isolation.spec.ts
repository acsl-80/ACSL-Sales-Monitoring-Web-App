import { test, expect, type Page } from "@playwright/test";
import { signIn, USERS, callEdgeFunction } from "./helpers";

/**
 * A call batch is not a receipt batch, and the receipt actions now say so.
 *
 * `import_batches.source` has permitted 'call_center' since the first
 * migration, and nothing on the receipt side ever read it. A call batch was
 * therefore reachable from the receipt history, from its next-step buttons and
 * from the confirmation queue, each of which routes into `validate`, `commit`,
 * `rollback`, `discard` or `resolve_exception`. Those read a row's
 * `normalized` as a sale payload; a call row's normalized is
 * `{values, attempts}`.
 *
 * These assertions are at the server, deliberately. The panel filters as well,
 * but a filtered list is presentation and this is the authority.
 *
 * `resolve_exception` gets the closest look. Pointed at a call row it used to
 * set status 'valid' and leave sale_id null, and `commitCallRows` selects
 * `status = 'valid' and sale_id is not null` - so the row was neither
 * committed nor listed as an exception anywhere. It stopped existing. That is
 * the one this file exists for.
 */

type Json = Record<string, unknown>;

/** A sale nobody has called yet, discovered rather than hard-coded. */
async function freeStove(page: Page): Promise<string | null> {
  const q = await callEdgeFunction(page, "data-center-read", {
    action: "call_queue",
    limit: 25,
  });
  const rows =
    (q.body as { data?: { rows?: { stove_serial_no: string; has_call_record?: boolean }[] } })?.data
      ?.rows ?? [];
  return rows.find((r) => !r.has_call_record)?.stove_serial_no ?? null;
}

/** Stage a one-row call batch and check it, returning the batch id. */
async function callBatch(page: Page, serial: string): Promise<string> {
  const staged = await callEdgeFunction(page, "data-center-import", {
    action: "call_stage",
    rows: [{ "Stove ID": serial, Verification: "Fully verified" }],
    filename: "e2e-source-isolation.csv",
  });
  expect(staged.status, "the call sheet should stage").toBe(200);
  const batchId = (staged.body as { data: { batchId: string } }).data.batchId;

  const checked = await callEdgeFunction(page, "data-center-import", {
    action: "call_validate",
    batchId,
  });
  expect(checked.status, "the call sheet should check").toBe(200);
  return batchId;
}

async function rowsOf(page: Page, batchId: string) {
  const r = await callEdgeFunction(page, "data-center-import", { action: "rows", batchId });
  return (r.body as { data?: Json[] })?.data ?? [];
}

test.describe("the receipt actions refuse a call batch", () => {
  test("validate, commit, rollback and discard all name the reason", async ({ page }) => {
    await signIn(page, USERS.dataManager);

    const serial = await freeStove(page);
    expect(serial, "the preview has no callable sale to build a call batch from").toBeTruthy();
    const batchId = await callBatch(page, serial as string);

    for (const action of ["validate", "commit", "rollback", "discard"]) {
      const r = await callEdgeFunction(page, "data-center-import", { action, batchId });
      expect(r.status, "receipt " + action + " should refuse a call batch").toBe(409);
      expect(
        JSON.stringify(r.body),
        "receipt " + action + " should say WHY, not just refuse",
      ).toMatch(/wrong_source/);
    }
  });

  test("a Fix on a call row is refused, and the row is not left unlandable", async ({ page }) => {
    await signIn(page, USERS.dataManager);

    const serial = await freeStove(page);
    expect(serial, "the preview has no callable sale to build a call batch from").toBeTruthy();
    const batchId = await callBatch(page, serial as string);

    const before = await rowsOf(page, batchId);
    expect(before.length, "the batch should hold its row").toBe(1);
    const rowId = before[0].id as string;
    const statusBefore = before[0].status;

    const fixed = await callEdgeFunction(page, "data-center-import", {
      action: "resolve_exception",
      rowId,
      correctedSerial: "ZZZ999999",
    });
    expect(fixed.status, "a Fix on a call row should be refused").toBe(409);
    expect(JSON.stringify(fixed.body)).toMatch(/wrong_source/);

    /*
     * The assertion that matters. Before the guard this row came back
     * status 'valid' with sale_id null, which commitCallRows filters out and
     * no list renders. Asserting the refusal alone would not have caught it.
     */
    const after = await rowsOf(page, batchId);
    expect(after[0].status, "the row status must not have moved").toBe(statusBefore);
    if (after[0].status === "valid") {
      expect(
        after[0].sale_id,
        "a valid call row with a null sale_id can never be committed or listed",
      ).toBeTruthy();
    }
    expect(after[0].stove_serial_no, "the serial must not have been overwritten").not.toBe(
      "ZZZ999999",
    );
  });

  test("the history says which import each batch came from", async ({ page }) => {
    await signIn(page, USERS.dataManager);

    const serial = await freeStove(page);
    expect(serial, "the preview has no callable sale to build a call batch from").toBeTruthy();
    const batchId = await callBatch(page, serial as string);

    const list = await callEdgeFunction(page, "data-center-import", {
      action: "batches",
      batchId,
    });
    expect(list.status).toBe(200);
    const batches = (list.body as { data?: Json[] })?.data ?? [];
    expect(batches.length, "the batch should be findable by id").toBe(1);
    expect(batches[0].source, "without source the panel cannot tell the two imports apart").toBe(
      "call_center",
    );
  });
});

test.describe("the guard does not over-refuse", () => {
  test("a receipt batch still stages, validates and discards", async ({ page }) => {
    await signIn(page, USERS.dataManager);

    const stock = await callEdgeFunction(page, "data-center-read", {
      action: "stock",
      limit: 5,
    });
    const free = ((stock.body as { data?: { rows?: { stove_id: string }[] } })?.data?.rows ??
      [])[0];
    expect(free, "the preview has no free stock to build a receipt batch from").toBeTruthy();

    const staged = await callEdgeFunction(page, "data-center-import", {
      action: "stage",
      filename: "e2e-source-isolation-receipt.csv",
      rows: [
        {
          "Stove ID": free.stove_id,
          "User First Name": "Isolation",
          "User Last Name": "Check",
          "Primary Phone Number": "08051234567",
          "Sales Date": "2026-06-10",
          State: "Kano",
        },
      ],
    });
    expect(staged.status, "a receipt batch must still stage").toBe(200);
    const batchId = (staged.body as { data: { batchId: string } }).data.batchId;

    const checked = await callEdgeFunction(page, "data-center-import", {
      action: "validate",
      batchId,
    });
    expect(checked.status, "a receipt batch must still validate").toBe(200);

    // Cleaned up rather than left behind: a staged batch this spec created
    // would otherwise sit in the history of every later run.
    const gone = await callEdgeFunction(page, "data-center-import", {
      action: "discard",
      batchId,
    });
    expect(gone.status, "a receipt batch must still discard").toBe(200);
  });
});
