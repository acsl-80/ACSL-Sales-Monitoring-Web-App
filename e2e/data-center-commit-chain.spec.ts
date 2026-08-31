import { test, expect, type Page } from "@playwright/test";
import { callEdgeFunction, signIn, USERS } from "./helpers";

/**
 * The commit that finishes itself.
 *
 * The old commit was a client-side loop: one HTTP call per slice, the whole
 * run inside one try, so the first slow slice aborted everything with "took
 * too long" while the server kept working. Measured per-sale latency on
 * production swings 4s to 30s within one day, so that abort was routine, and
 * a 655-row file needed a tab babysat for up to five hours.
 *
 * Now one press takes a lease on the batch, claims a slice, answers 202, and
 * works server-side inside EdgeRuntime.waitUntil - each link firing the next
 * with the caller's own JWT until nothing is left. These specs assert the
 * shape of that promise: the press is enough, the racing press is told busy,
 * rollback cannot run under a live chain, a stove sold from under a row
 * excepts with the TRUE reason, and the race that used to burn rows into
 * "Another import is already committing this stove" is gone.
 */

const PARTNER = "a0000000-0000-4000-8000-00000000000a";
const RACE_REASON = "Another import is already committing this stove";

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

async function stageAndValidate(page: Page, marker: string, serials: string[]): Promise<string> {
  const staged = await callEdgeFunction(page, "data-center-import", {
    action: "stage",
    filename: `${marker}.csv`,
    rows: serials.map((s, i) => ({
      stove_serial_no: s,
      sales_model: "Amina Model",
      first_name: "Chain",
      last_name: `Spec${i}`,
      phone: `0805333${String(1000 + i).slice(-4)}`,
      sales_date: "2026-01-06",
      state: "Kogi",
      lga: "Isanlu",
      address: `${marker} Road ${i}`,
    })),
  });
  expect(staged.status).toBe(200);
  const batchId = (staged.body as { data: { batchId: string } }).data.batchId;
  const validated = await callEdgeFunction(page, "data-center-import", {
    action: "validate",
    batchId,
  });
  expect(validated.status).toBe(200);
  return batchId;
}

const setCap = (page: Page, value: number) =>
  callEdgeFunction(page, "data-center-admin", {
    action: "config_set",
    config: { key: "import.slice_size", value },
  });

async function readBatch(page: Page, batchId: string) {
  const r = await callEdgeFunction(page, "data-center-import", { action: "batches", batchId });
  return ((r.body as { data?: Record<string, unknown>[] })?.data ?? []).find(
    (b) => b.id === batchId,
  );
}

async function waitDrained(page: Page, batchId: string, tries = 40) {
  for (let i = 0; i < tries; i++) {
    await page.waitForTimeout(3000);
    const b = await readBatch(page, batchId);
    if (b && (b.state === "committed" || b.valid_rows === 0)) return b;
  }
  throw new Error("the chain did not drain the batch in time");
}

test.describe("one press is the whole ask", () => {
  test("the chain drains the batch with the page CLOSED, and the racer is told busy", async ({
    browser,
  }, testInfo) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await signIn(page, USERS.admin);
    await page.goto("/data-center/import");

    const stoves = await freeStoves(page, 4);
    test.skip(stoves.length < 4, "not enough free stoves");
    await setCap(page, 2); // 4 rows at cap 2 = at least two links
    let batchId: string;
    try {
      const marker = `chain${testInfo.workerIndex}-${Date.now()}`;
      batchId = await stageAndValidate(page, marker, stoves);

      // The press, and a racing second press 300ms behind it.
      const [kick, racer] = await Promise.all([
        callEdgeFunction(page, "data-center-import", { action: "commit", batchId }),
        page
          .waitForTimeout(300)
          .then(() =>
            callEdgeFunction(page, "data-center-import", { action: "commit", batchId }),
          ),
      ]);
      expect(kick.status, "the press answers fast, the work happens behind it").toBe(202);
      expect((kick.body as { data: { started: boolean } }).data.started).toBe(true);
      expect(
        (racer.body as { data: { busy?: boolean } }).data.busy,
        "the second press is told the truth: a chain already holds the batch",
      ).toBe(true);

      /*
       * The whole point: CLOSE the page. The chain neither knows nor cares
       * that anybody is watching.
       */
      await ctx.close();

      const ctx2 = await browser.newContext();
      const page2 = await ctx2.newPage();
      await signIn(page2, USERS.admin);
      await page2.goto("/data-center/import");

      const done = await waitDrained(page2, batchId);
      expect(done.state, "drained with nobody watching").toBe("committed");
      expect(done.committed_rows).toBe(4);
      expect(done.committing, "the lease is gone when the work is done").toBe(false);

      // The burn that started all this must never appear again.
      const rows = await callEdgeFunction(page2, "data-center-import", {
        action: "rows",
        batchId,
        status: "exception",
      });
      const reasons = JSON.stringify((rows.body as { data?: unknown })?.data ?? []);
      expect(reasons.includes(RACE_REASON), "no row burned by the race").toBe(false);

      // Undo: this spec must not eat the seeded pool.
      for (let i = 0; i < 20; i++) {
        const rb = await callEdgeFunction(page2, "data-center-import", {
          action: "rollback",
          batchId,
        });
        if ((rb.body as { data?: { done?: boolean } })?.data?.done) break;
      }
      await ctx2.close();
    } finally {
      const p = await browser.newContext();
      const cleanup = await p.newPage();
      await signIn(cleanup, USERS.admin);
      await cleanup.goto("/data-center/import");
      await setCap(cleanup, 25);
      await p.close();
    }
  });

  test("a stove sold from under a row excepts with the true reason, and the chain finishes", async ({
    page,
  }, testInfo) => {
    /*
     * Two batches, one stove. A drains first and sells it. B's row then loses
     * its create-sale honestly - and the reason recorded must be create-sale's
     * own, never the old race message, because B's claim attempt SKIPS now
     * instead of burning.
     */
    await signIn(page, USERS.admin);
    await page.goto("/data-center/import");

    const stoves = await freeStoves(page, 2);
    test.skip(stoves.length < 2, "not enough free stoves");
    const shared = stoves[0];
    const marker = `dup${testInfo.workerIndex}-${Date.now()}`;

    const batchA = await stageAndValidate(page, `${marker}-a`, [shared, stoves[1]]);
    const batchB = await stageAndValidate(page, `${marker}-b`, [shared]);

    await callEdgeFunction(page, "data-center-import", { action: "commit", batchId: batchA });
    const doneA = await waitDrained(page, batchA);
    expect(doneA.committed_rows).toBe(2);

    await callEdgeFunction(page, "data-center-import", { action: "commit", batchId: batchB });
    const doneB = await waitDrained(page, batchB);
    expect(doneB.committed_rows, "B could not sell what A already sold").toBe(0);

    const rows = await callEdgeFunction(page, "data-center-import", {
      action: "rows",
      batchId: batchB,
      status: "exception",
    });
    const list = (rows.body as { data?: { exception_reason?: string }[] })?.data ?? [];
    expect(list.length).toBe(1);
    expect(list[0].exception_reason ?? "").not.toContain(RACE_REASON);

    // Undo batch A's two sales.
    for (let i = 0; i < 20; i++) {
      const rb = await callEdgeFunction(page, "data-center-import", {
        action: "rollback",
        batchId: batchA,
      });
      if ((rb.body as { data?: { done?: boolean } })?.data?.done) break;
    }
  });

  test("rollback under a live chain is refused, and works once it is done", async ({
    page,
  }, testInfo) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/import");

    const stoves = await freeStoves(page, 3);
    test.skip(stoves.length < 3, "not enough free stoves");
    await setCap(page, 1); // slow the chain down enough to catch it mid-run
    let batchId: string | null = null;
    try {
      batchId = await stageAndValidate(
        page,
        `rb${testInfo.workerIndex}-${Date.now()}`,
        stoves,
      );
      await callEdgeFunction(page, "data-center-import", { action: "commit", batchId });

      const during = await callEdgeFunction(page, "data-center-import", {
        action: "rollback",
        batchId,
      });
      expect(during.status, "rollback cannot run under a working chain").toBe(409);
      expect((during.body as { code?: string }).code).toBe("commit_in_progress");

      await waitDrained(page, batchId);
      let last;
      for (let i = 0; i < 20; i++) {
        last = await callEdgeFunction(page, "data-center-import", {
          action: "rollback",
          batchId,
        });
        if ((last.body as { data?: { done?: boolean } })?.data?.done) break;
      }
      expect(last?.status, "and works normally once the chain is finished").toBe(200);
    } finally {
      await setCap(page, 25);
    }
  });

  test("the panel narrates the run and survives a reload mid-chain", async ({
    page,
  }, testInfo) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/import");
    await expect(page.getByRole("heading", { name: "Bulk Import" })).toBeVisible({
      timeout: 30_000,
    });

    const stoves = await freeStoves(page, 4);
    test.skip(stoves.length < 4, "not enough free stoves");
    await setCap(page, 1); // widen the window so the reload lands mid-run
    let batchId: string | null = null;
    try {
      batchId = await stageAndValidate(
        page,
        `ui${testInfo.workerIndex}-${Date.now()}`,
        stoves,
      );
      await page.reload();

      // Press the row's own Commit button, then confirm the dialog.
      const row = page
        .locator("tr", { hasText: `ui${testInfo.workerIndex}` })
        .locator("xpath=following-sibling::tr[1]");
      await row.getByRole("button", { name: /^Commit \d+$/ }).click();
      await page.getByRole("button", { name: /^Commit$/ }).click();

      await expect(
        page.getByText(/running on the server/i).first(),
        "the person is told the work no longer needs them",
      ).toBeVisible({ timeout: 30_000 });

      /*
       * Reload mid-run. The armed Commit button must NOT come back - the
       * refreshed page reads the lease and says what is happening instead.
       */
      await page.reload();
      await expect(
        page.getByText(/Being written on the server right now/).first(),
      ).toBeVisible({ timeout: 30_000 });

      const done = await waitDrained(page, batchId);
      expect(done.committed_rows).toBe(4);
    } finally {
      if (batchId) {
        for (let i = 0; i < 20; i++) {
          const rb = await callEdgeFunction(page, "data-center-import", {
            action: "rollback",
            batchId,
          });
          if ((rb.body as { data?: { done?: boolean } })?.data?.done) break;
        }
      }
      await setCap(page, 25);
    }
  });
});
