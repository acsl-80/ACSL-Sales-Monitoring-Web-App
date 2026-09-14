import { test, expect, type Page } from "@playwright/test";
import { signIn, USERS, callEdgeFunction } from "./helpers";

/**
 * The call import finishes itself, and the sheet can correct.
 *
 * Every claim here failed against the code this replaces, which is the only
 * reason to trust any of them. The old commit was a client loop of up to 200
 * blocking requests in one `try`: each row is a save plus up to three attempt
 * writes, every one its own edge-function invocation paying ~650ms of
 * connection setup, so a 25-row slice ran 16 to 65 seconds against a
 * 20-second client abort. One week of the real workbook is 359 rows. It had
 * only ever been proved on six.
 *
 * Server-level throughout, like the call-import spec beside it: every claim is
 * about what the database ends up holding, and driving a spreadsheet through a
 * file input to assert a count would be testing the file input.
 *
 * NO `test.skip` ANYWHERE. Where a fixture is missing this fails with a
 * sentence saying what the preview lacked. 30 of the 59 receipt-side import
 * tests carry skip guards and the chain spec is 4 tests with 4 of them, so
 * that file can report green having executed nothing. This one cannot.
 */

// A real chain across several links. The default 60s passes on a fast
// afternoon and fails on a slow one, which is the worst kind of green.
test.describe.configure({ timeout: 240_000 });

type Json = Record<string, unknown>;

async function freeStoves(page: Page, want: number): Promise<string[]> {
  const q = await callEdgeFunction(page, "data-center-read", {
    action: "call_queue",
    limit: 100,
    filters: { hasCallRecord: false },
  });
  const rows = (q.body as { data?: { rows?: { stove_serial_no: string }[] } })?.data?.rows ?? [];
  return rows
    .map((r) => r.stove_serial_no)
    .filter(Boolean)
    .slice(0, want);
}

async function stage(page: Page, rows: Json[], filename = "e2e-chain.csv") {
  return callEdgeFunction(page, "data-center-import", {
    action: "call_stage",
    rows,
    filename,
    // These fixtures repeat by design; the duplicate warning is not what is
    // under test here and is asserted on its own below.
    confirmDuplicate: true,
  });
}

async function check(page: Page, batchId: string) {
  const r = await callEdgeFunction(page, "data-center-import", {
    action: "call_validate",
    batchId,
  });
  expect(r.status, "call_validate should answer 200").toBe(200);
  return (r.body as { data: Json }).data;
}

async function batchOf(page: Page, batchId: string) {
  const r = await callEdgeFunction(page, "data-center-import", { action: "batches", batchId });
  return ((r.body as { data?: Json[] })?.data ?? [])[0];
}

/** Press once, then watch the server work, exactly as the panel does. */
async function drain(page: Page, batchId: string, tries = 60) {
  const kick = await callEdgeFunction(page, "data-center-import", {
    action: "call_commit",
    batchId,
  });
  expect([200, 202], `call_commit should start or report done, got ${kick.status}`).toContain(
    kick.status,
  );

  for (let i = 0; i < tries; i++) {
    const b = await batchOf(page, batchId);
    if (!b) throw new Error("the batch disappeared mid-chain");
    if (b.state === "committed" || b.valid_rows === 0) return b;
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error("the call chain did not drain the batch in time");
}

async function undo(page: Page, batchId: string) {
  return callEdgeFunction(page, "data-center-import", { action: "call_rollback", batchId });
}

test.describe("one press, and the server finishes it", () => {
  test("a sheet bigger than one slice drains, and a racing press is told busy", async ({
    page,
  }) => {
    await signIn(page, USERS.dataManager);

    const stoves = await freeStoves(page, 6);
    expect(
      stoves.length,
      `the preview needs 6 uncalled sales to prove a chain; it has ${stoves.length}`,
    ).toBeGreaterThanOrEqual(6);

    const staged = await stage(
      page,
      stoves.map((s) => ({ "Stove ID": s, Verification: "Fully verified" })),
    );
    expect(staged.status).toBe(200);
    const batchId = (staged.body as { data: { batchId: string } }).data.batchId;

    const summary = await check(page, batchId);
    expect(summary.valid, "every fixture row should be ready").toBe(stoves.length);
    expect(summary.creating, "all six are new records").toBe(stoves.length);
    expect(summary.updating).toBe(0);

    // Press, then press again immediately. The second must be told the batch
    // is held rather than starting a second chain over the same rows.
    const first = await callEdgeFunction(page, "data-center-import", {
      action: "call_commit",
      batchId,
    });
    expect(first.status, "the first press starts the chain").toBe(202);

    const racer = await callEdgeFunction(page, "data-center-import", {
      action: "call_commit",
      batchId,
    });
    const racerSaid = JSON.stringify(racer.body);
    expect(racerSaid, "a second press must not start a second chain over the same rows").toMatch(
      /busy|started.{0,10}false/,
    );

    // Now let it finish.
    for (let i = 0; i < 60; i++) {
      const b = await batchOf(page, batchId);
      if (b?.state === "committed" || b?.valid_rows === 0) break;
      await new Promise((r) => setTimeout(r, 3000));
    }
    const done = await batchOf(page, batchId);
    expect(done.state, "the chain should have finished the batch").toBe("committed");
    expect(done.committed_rows, "every row should have landed").toBe(stoves.length);

    // Put the preview back: these are real call records on real sales.
    const back = await undo(page, batchId);
    expect(back.status, "undo should succeed").toBe(200);
    expect((back.body as { data: { reversed: number } }).data.reversed).toBe(stoves.length);
  });

  test("undo is refused while a chain holds the batch", async ({ page }) => {
    await signIn(page, USERS.dataManager);

    const stoves = await freeStoves(page, 4);
    expect(
      stoves.length,
      `the preview needs 4 uncalled sales; it has ${stoves.length}`,
    ).toBeGreaterThanOrEqual(4);

    const staged = await stage(
      page,
      stoves.map((s) => ({ "Stove ID": s, Verification: "Fully verified" })),
    );
    const batchId = (staged.body as { data: { batchId: string } }).data.batchId;
    await check(page, batchId);

    await callEdgeFunction(page, "data-center-import", { action: "call_commit", batchId });

    /*
     * Straight away, while the lease is live. Undo resets rows to valid under
     * the link's feet, and the link then writes outcomes for rows that have
     * moved. This guard did not exist before the chain did.
     */
    const early = await undo(page, batchId);
    expect(early.status, "undo under a live chain must be refused").toBe(409);
    expect(JSON.stringify(early.body)).toMatch(/commit_in_progress/);

    await drain(page, batchId);
    const late = await undo(page, batchId);
    expect(late.status, "undo should work once the chain is done").toBe(200);
  });
});

test.describe("the sheet can correct a record, and cannot overwrite blindly", () => {
  test("a matching version updates; a stale one is refused by name", async ({ page }) => {
    await signIn(page, USERS.dataManager);

    const [stove] = await freeStoves(page, 1);
    expect(stove, "the preview has no uncalled sale to work with").toBeTruthy();

    // 1. Attach a record the ordinary way.
    const first = await stage(page, [
      { "Stove ID": stove, Verification: "Fully verified", "Call 1 Date": "2026-06-10" },
    ]);
    const firstBatch = (first.body as { data: { batchId: string } }).data.batchId;
    const firstSummary = await check(page, firstBatch);
    expect(firstSummary.creating, "the first pass creates the record").toBe(1);
    await drain(page, firstBatch);

    // 2. Read back the version the record now carries.
    const q = await callEdgeFunction(page, "data-center-read", {
      action: "call_queue",
      limit: 100,
      filters: { search: stove },
    });
    const row = ((q.body as { data?: { rows?: Json[] } })?.data?.rows ?? []).find(
      (r) => r.stove_serial_no === stove,
    );
    expect(row, "the record should be findable in the queue after committing").toBeTruthy();
    const version = row!.call_record_version as number;
    expect(version, "a saved record carries a version").toBeTruthy();

    // 3. A row carrying that version updates rather than being refused.
    const second = await stage(page, [
      {
        "Stove ID": stove,
        Verification: "Partially verified",
        "Record Version": String(version),
      },
    ]);
    const secondBatch = (second.body as { data: { batchId: string } }).data.batchId;
    const secondSummary = await check(page, secondBatch);
    expect(
      secondSummary.updating,
      "a row whose version matches should be ready to update, not an exception",
    ).toBe(1);
    expect(secondSummary.exceptions).toBe(0);
    await drain(page, secondBatch);

    // 4. A row carrying a version that has moved on is refused, and says so.
    const third = await stage(page, [
      {
        "Stove ID": stove,
        Verification: "Unreachable",
        "Record Version": String(version), // now stale: step 3 bumped it
      },
    ]);
    const thirdBatch = (third.body as { data: { batchId: string } }).data.batchId;
    const thirdSummary = await check(page, thirdBatch);
    expect(
      thirdSummary.exceptions,
      "a sheet built before the record moved must not overwrite it",
    ).toBe(1);
    expect(thirdSummary.valid).toBe(0);

    const rows = await callEdgeFunction(page, "data-center-import", {
      action: "rows",
      batchId: thirdBatch,
    });
    expect(
      JSON.stringify(rows.body),
      "the refusal should name the version disagreement, not just refuse",
    ).toMatch(/changed in the app|Record Version/i);

    // Tidy up: remove what this test attached, and the two spent batches.
    await undo(page, secondBatch);
    await undo(page, firstBatch);
    for (const b of [thirdBatch]) {
      await callEdgeFunction(page, "data-center-import", { action: "call_discard", batchId: b });
    }
  });

  test("a row with no Record Version cannot update a record that exists", async ({ page }) => {
    await signIn(page, USERS.dataManager);

    const [stove] = await freeStoves(page, 1);
    expect(stove, "the preview has no uncalled sale to work with").toBeTruthy();

    const first = await stage(page, [{ "Stove ID": stove, Verification: "Fully verified" }]);
    const firstBatch = (first.body as { data: { batchId: string } }).data.batchId;
    await check(page, firstBatch);
    await drain(page, firstBatch);

    // A sheet downloaded before the version column existed looks exactly like
    // this. Refused rather than guessed at, which is the safe direction.
    const second = await stage(page, [{ "Stove ID": stove, Verification: "Unreachable" }]);
    const secondBatch = (second.body as { data: { batchId: string } }).data.batchId;
    const summary = await check(page, secondBatch);
    expect(summary.exceptions, "no version means no update").toBe(1);
    expect(summary.valid).toBe(0);

    await undo(page, firstBatch);
    await callEdgeFunction(page, "data-center-import", {
      action: "call_discard",
      batchId: secondBatch,
    });
  });
});

test.describe("what the file itself gets wrong", () => {
  test("the same stove twice names the row it repeats", async ({ page }) => {
    await signIn(page, USERS.dataManager);

    const [stove] = await freeStoves(page, 1);
    expect(stove, "the preview has no uncalled sale to work with").toBeTruthy();

    const staged = await stage(page, [
      { "Stove ID": stove, Verification: "Fully verified" },
      { "Stove ID": stove, Verification: "Unreachable" },
    ]);
    const batchId = (staged.body as { data: { batchId: string } }).data.batchId;
    const summary = await check(page, batchId);

    expect(summary.valid, "only the first row for a stove is used").toBe(1);
    expect(summary.exceptions, "the repeat is an exception, not a second write").toBe(1);

    const rows = await callEdgeFunction(page, "data-center-import", { action: "rows", batchId });
    expect(
      JSON.stringify(rows.body),
      "the repeat should name the row it repeats, so it can be found in the file",
    ).toMatch(/already appears on row 1/);

    await callEdgeFunction(page, "data-center-import", { action: "call_discard", batchId });
  });

  test("an unreadable cell is named before the duplicate, because it is the fixable one", async ({
    page,
  }) => {
    await signIn(page, USERS.dataManager);

    const [stove] = await freeStoves(page, 1);
    expect(stove, "the preview has no uncalled sale to work with").toBeTruthy();

    /*
     * The receipt path ranks duplicate-in-file first, because there a repeat
     * would create a second SALE. Here it would only be a second update to
     * one record, which the version check refuses anyway - so the typo wins,
     * because "Unreacheable" is a ten-second fix once somebody is told which
     * cell it is in.
     */
    const staged = await stage(page, [
      { "Stove ID": stove, Verification: "Fully verified" },
      { "Stove ID": stove, "Call Outcome": "Unreacheable" },
    ]);
    const batchId = (staged.body as { data: { batchId: string } }).data.batchId;
    await check(page, batchId);

    const rows = await callEdgeFunction(page, "data-center-import", { action: "rows", batchId });
    expect(
      JSON.stringify(rows.body),
      "the misspelled option must be named, not hidden behind the duplicate",
    ).toMatch(/Unreacheable/);

    await callEdgeFunction(page, "data-center-import", { action: "call_discard", batchId });
  });

  test("the same sheet twice warns, and goes through when confirmed", async ({ page }) => {
    await signIn(page, USERS.dataManager);

    const [stove] = await freeStoves(page, 1);
    expect(stove, "the preview has no uncalled sale to work with").toBeTruthy();
    /*
     * Unique per run.
     *
     * The hash is over the parsed rows, and it persists on the batch. A
     * previous run of this very test therefore makes the NEXT run's first
     * upload a genuine repeat, which is the importer being right and the
     * fixture being wrong. What is under test is detecting a repeat within a
     * run, so the payload carries a nonce and the two uploads share it.
     */
    const nonce = `e2e-duplicate-${Date.now()}`;
    const rows = [{ "Stove ID": stove, Verification: "Fully verified", "Other Comments": nonce }];

    const first = await callEdgeFunction(page, "data-center-import", {
      action: "call_stage",
      rows,
      filename: "e2e-duplicate.csv",
    });
    expect(first.status).toBe(200);
    const firstBatch = (first.body as { data: { batchId: string } }).data.batchId;

    const repeat = await callEdgeFunction(page, "data-center-import", {
      action: "call_stage",
      rows,
      filename: "e2e-duplicate.csv",
    });
    expect(repeat.status, "the same parsed rows should warn").toBe(409);
    expect(JSON.stringify(repeat.body)).toMatch(/duplicate_upload/);

    // Never a hard block: a corrected sheet legitimately carries the same
    // stove IDs as the one it corrects.
    const forced = await callEdgeFunction(page, "data-center-import", {
      action: "call_stage",
      rows,
      filename: "e2e-duplicate.csv",
      confirmDuplicate: true,
    });
    expect(forced.status, "confirming should let it through").toBe(200);
    const forcedBatch = (forced.body as { data: { batchId: string } }).data.batchId;

    for (const b of [firstBatch, forcedBatch]) {
      await callEdgeFunction(page, "data-center-import", { action: "call_discard", batchId: b });
    }
  });
});

test.describe("a call batch can be cleared away", () => {
  test("discard removes a staged batch and refuses one holding records", async ({ page }) => {
    await signIn(page, USERS.dataManager);

    const [stove] = await freeStoves(page, 1);
    expect(stove, "the preview has no uncalled sale to work with").toBeTruthy();

    // Staged and abandoned: the case this exists for.
    const staged = await stage(page, [{ "Stove ID": stove, Verification: "Fully verified" }]);
    const stagedBatch = (staged.body as { data: { batchId: string } }).data.batchId;
    const gone = await callEdgeFunction(page, "data-center-import", {
      action: "call_discard",
      batchId: stagedBatch,
    });
    expect(gone.status, "a staged batch should discard").toBe(200);
    expect(await batchOf(page, stagedBatch), "and should stop existing").toBeFalsy();

    // One that has attached records goes through undo instead, so the records
    // it created come off properly.
    const landed = await stage(page, [{ "Stove ID": stove, Verification: "Fully verified" }]);
    const landedBatch = (landed.body as { data: { batchId: string } }).data.batchId;
    await check(page, landedBatch);
    await drain(page, landedBatch);

    const refused = await callEdgeFunction(page, "data-center-import", {
      action: "call_discard",
      batchId: landedBatch,
    });
    expect(refused.status, "a batch holding records must not be discarded").toBe(409);
    expect(JSON.stringify(refused.body)).toMatch(/has_records/);

    await undo(page, landedBatch);
  });
});
