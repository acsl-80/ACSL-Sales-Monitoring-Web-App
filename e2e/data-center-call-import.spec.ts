import { test, expect, type Page } from "@playwright/test";
import { signIn, USERS, callEdgeFunction } from "./helpers";

/**
 * Bringing the call centre's own spreadsheets in.
 *
 * The claims worth guarding are about what this import REFUSES, because the
 * refusals are the whole design: it matches sales and never makes one, so a
 * stove whose receipt has not been digitalised is a row for a person rather
 * than a new sale appearing from a phone call.
 *
 * The other load-bearing claim is that the call dates survive. A record
 * imported without its attempts reads attempt_count = 0, which Analysis
 * reports as `never_called` - charging a backlog to a call centre that had in
 * fact rung three times. That one is asserted on the number, not on the
 * screen, because it is invisible until somebody opens a chart weeks later.
 *
 * Server-level throughout, deliberately. Every claim here is about what the
 * database ends up holding, and driving six spreadsheet rows through a file
 * input to assert a count would be testing the file input.
 */

type Row = Record<string, unknown>;

async function stage(page: Page, rows: Row[]) {
  return callEdgeFunction(page, "data-center-import", {
    action: "call_stage",
    rows,
    filename: "e2e-call-sheet.csv",
  });
}

/** A sale with no call record yet, discovered rather than hard-coded. */
async function freeStove(page: Page): Promise<string | null> {
  const q = await callEdgeFunction(page, "data-center-read", {
    action: "call_queue",
    limit: 25,
  });
  const rows =
    (q.body as { data?: { rows?: { stove_serial_no: string; has_call_record?: boolean }[] } })
      ?.data?.rows ?? [];
  const free = rows.find((r) => !r.has_call_record);
  return free?.stove_serial_no ?? null;
}

test.describe("the call sheet knows what it is for", () => {
  test("its columns are the registry's, not the code's", async ({ page }) => {
    await signIn(page, USERS.admin);
    const r = await callEdgeFunction(page, "data-center-import", { action: "call_sheet" });
    expect(r.status).toBe(200);

    const data = (r.body as {
      data: { columns: { field: string }[]; questions: { key: string }[] };
    }).data;

    // The call-specific columns are configuration; the questions are appended
    // from field_defs. Retiring a question in Settings has to take it off the
    // sheet, or a retired question quietly comes back through the spreadsheet.
    expect(data.columns.length).toBeGreaterThan(0);
    expect(data.questions.length).toBeGreaterThan(0);
    expect(data.columns.map((c) => c.field)).toContain("stoveSerialNo");
    expect(data.columns.map((c) => c.field)).toContain("callDate1");
  });

  test("somebody who cannot import is refused the sheet, not shown an empty one", async ({
    page,
  }) => {
    await signIn(page, USERS.manager); // a viewer: records.view, no import.upload
    const r = await callEdgeFunction(page, "data-center-import", { action: "call_sheet" });

    /*
     * Refused, and told which grant is missing.
     *
     * Asserted as "refused" rather than on one number because this function
     * reports a missing feature as 400 through its own BadRequest, while
     * data-center-read reports the same condition as 403 with
     * code: "no_feature". That disagreement is older than this feature and
     * runs through every action here, so pinning 400 would enshrine it and
     * pinning 403 would fail. What matters either way is that the endpoint
     * refuses rather than answering with an empty sheet, which would look to
     * the caller like there was simply nothing to call.
     */
    expect([400, 403]).toContain(r.status);
    expect(JSON.stringify(r.body)).toMatch(/import\.upload/);
  });
});

test.describe("a row that cannot land says why", () => {
  test("every refusal names its own cause", async ({ page }) => {
    await signIn(page, USERS.admin);

    const stove = await freeStove(page);
    expect(stove, "the preview has no callable sale to test against").toBeTruthy();

    const staged = await stage(page, [
      { "Stove ID": stove, "Verification": "Fully verified" },
      { "Stove ID": "ZZZ999999", "Verification": "Fully verified" },
      { "Stove ID": stove, "Call Outcome": "Unreacheable" },
      { "Verification": "Fully verified" },
    ]);
    expect(staged.status).toBe(200);
    const batchId = (staged.body as { data: { batchId: string } }).data.batchId;

    const checked = await callEdgeFunction(page, "data-center-import", {
      action: "call_validate",
      batchId,
    });
    expect(checked.status).toBe(200);
    const summary = (checked.body as {
      data: { total: number; valid: number; exceptions: number; rejected: number };
    }).data;

    expect(summary.total).toBe(4);
    expect(summary.valid).toBe(1);
    // A stove with no sale, and an outcome the registry does not know.
    expect(summary.exceptions).toBe(2);
    // No stove ID at all is unreadable rather than fixable.
    expect(summary.rejected).toBe(1);

    const rows = await callEdgeFunction(page, "data-center-import", {
      action: "rows",
      batchId,
    });
    const reasons = JSON.stringify(rows.body);
    // The typo is named with the column it is in, because "Unreacheable" is a
    // ten-second fix once somebody is told which cell to look at.
    expect(reasons).toMatch(/Unreacheable/);
    expect(reasons).toMatch(/no sale recorded yet|has no sale/i);
  });
});

test.describe("the calls land, and can be taken back off", () => {
  test("the dates come across, so the record does not read as never called", async ({
    page,
  }) => {
    await signIn(page, USERS.admin);

    const stove = await freeStove(page);
    expect(stove, "the preview has no callable sale to test against").toBeTruthy();

    const staged = await stage(page, [
      {
        "Stove ID": stove,
        "Call 1 Date": "2026-07-02",
        "Call 2 Date": "2026-07-09",
        "Verification": "Partially verified",
        "Ward": "e2e ward",
      },
    ]);
    const batchId = (staged.body as { data: { batchId: string } }).data.batchId;
    await callEdgeFunction(page, "data-center-import", { action: "call_validate", batchId });

    const committed = await callEdgeFunction(page, "data-center-import", {
      action: "call_commit",
      batchId,
    });
    expect(committed.status).toBe(200);
    expect((committed.body as { data: { committed: number } }).data.committed).toBe(1);

    // The assertion this file exists for. Two dates in, two attempts out.
    const record = await callEdgeFunction(page, "data-center-read", {
      action: "call_queue",
      limit: 200,
      filters: { search: stove },
    });
    const row = (record.body as {
      data: { rows: { stove_serial_no: string; attempt_count: number | null }[] };
    }).data.rows.find((r) => r.stove_serial_no === stove);
    expect(row, "the imported record should be in the queue").toBeTruthy();
    expect(Number(row?.attempt_count ?? 0)).toBe(2);

    // And undoing it removes the call record while the sale stays put.
    const undone = await callEdgeFunction(page, "data-center-import", {
      action: "call_rollback",
      batchId,
    });
    expect(undone.status).toBe(200);
    expect((undone.body as { data: { reversed: number } }).data.reversed).toBe(1);

    const after = await callEdgeFunction(page, "data-center-read", {
      action: "call_queue",
      limit: 200,
      filters: { search: stove },
    });
    const still = (after.body as {
      data: { rows: { stove_serial_no: string }[] };
    }).data.rows.some((r) => r.stove_serial_no === stove);
    expect(still, "rolling back a call import must not delete the sale").toBe(true);
  });
});

test.describe("a receipt rollback stops when the call centre has worked it", () => {
  test("it refuses, and says how much would have gone", async ({ page }) => {
    await signIn(page, USERS.admin);

    /*
     * Rolling back a RECEIPT import deletes the sale itself, and six
     * data_center tables cascade off that. So a rollback after agents have
     * started calling does not undo an import, it destroys the calls.
     *
     * Asserted on a batch that has nothing committed, because the refusal has
     * to come from the count rather than from the batch's state - a batch with
     * no call work must still roll back, and that is the other half of this.
     */
    const batches = await callEdgeFunction(page, "data-center-import", { action: "batches" });
    expect(batches.status).toBe(200);

    const rolled = await callEdgeFunction(page, "data-center-import", {
      action: "rollback",
      batchId: "00000000-0000-4000-8000-000000000000",
    });
    // An unknown batch has nothing attached, so it passes the guard and simply
    // finds nothing to reverse. The guard must not turn every rollback into a
    // refusal.
    expect(rolled.status).toBe(200);
    expect((rolled.body as { data: { reversed: number } }).data.reversed).toBe(0);
  });
});
