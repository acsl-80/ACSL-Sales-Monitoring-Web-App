import { test, expect, type Page } from "@playwright/test";
import { callEdgeFunction, signIn, USERS } from "./helpers";

/**
 * What the bench promised and did not keep.
 *
 * Three defects found by spot-checking the live module, all in the path a
 * typist walks forty times a morning, and all invisible to the suite because
 * every existing bench test finishes a record and then stops looking.
 *
 *   1. Finishing a receipt was undone seconds later. `finish()` saved the
 *      record with the contact defaults applied and then recorded the
 *      DEFAULTED body as "last saved", while the autosave compared the live
 *      form - which still held the blanks those defaults filled. The two could
 *      never match again, so the form read as dirty forever and the
 *      twenty-second timer fired a draft save on top of the finish. Production
 *      held two such rows, both `status='draft'` with `normalized` NULL, and
 *      both showed in the confirmation queue as "still being typed" with the
 *      Confirm button greyed out at zero.
 *
 *   2. A typist's bench batch fragmented. The "find my open batch" lookup
 *      matched `state = 'staged'` only, so the moment a batch was validated or
 *      dry-run the next receipt started a fresh one, and a day of work
 *      scattered into a row per session in the queue it was supposed to be
 *      aggregated in.
 *
 *   3. The partner sweep counted what it had fetched. It loaded two hundred
 *      behind a "Load more" and every number on screen - the total, the "still
 *      to type" chip - described that page rather than the partner.
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

/** Every bench row this account has, with the state that decides the queue. */
async function benchRows(page: Page) {
  const r = await callEdgeFunction(page, "data-center-import", { action: "workbench_queue" });
  return r.body as Record<string, unknown>;
}

const receipt = (marker: string) => ({
  endUserName: "Held",
  endUserSurname: "Fast",
  phone: "08015550101",
  salesDate: "2026-01-04",
  state: "Kogi",
  lga: "Isanlu",
  address: `${marker} Street`,
  salesModel: "Amina Model",
  // Deliberately NOT set. These are exactly the two fields `withDefaults`
  // fills, and leaving them blank is what made the finish and the autosave
  // disagree about what had been saved.
  // contactPerson, contactPhone
});

test.describe("a finished receipt stays finished", () => {
  test("a draft save after a finish does not undo the finish", async ({ page }, testInfo) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/workbench");

    const [serial] = await freeStoves(page, 1);
    test.skip(!serial, "no free stove on this database");

    const marker = `hold${testInfo.workerIndex}-${Date.now()}`;
    const finished = await callEdgeFunction(page, "data-center-import", {
      action: "workbench_save",
      stoveId: serial,
      values: { ...receipt(marker), contactPerson: "Held Fast", contactPhone: "08015550101" },
      complete: true,
    });
    expect(finished.status, "the receipt should finish").toBe(200);
    expect((finished.body as { data: { status: string } }).data.status).toBe("valid");

    /*
     * Now the save the bench's own autosave used to fire seconds later. It is
     * the same call the timer makes: the typed values, complete false.
     *
     * The bench no longer sends it - the form, the saved body and the dirty
     * check were made to agree - but that fix lives in a component, and a rule
     * enforced only in a component holds until the next component. This is the
     * invariant underneath it.
     */
    const drafted = await callEdgeFunction(page, "data-center-import", {
      action: "workbench_save",
      stoveId: serial,
      values: receipt(marker),
      complete: false,
    });
    expect(drafted.status).toBe(200);

    const after = await callEdgeFunction(page, "data-center-import", {
      action: "workbench_save",
      stoveId: serial,
      values: receipt(marker),
      complete: false,
    });
    expect(after.status).toBe(200);
    // The assertion the bug failed. It read "draft", and the record then sat
    // in the confirmation queue unable to be confirmed.
    expect(
      (after.body as { data: { status: string } }).data.status,
      "a draft save must not undo a finish",
    ).toBe("valid");

    const queue = await benchRows(page);
    const json = JSON.stringify(queue);
    expect(json).toContain(serial);
  });

  test("a typist keeps one open bench batch, whatever state it reaches", async ({
    page,
  }, testInfo) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/workbench");

    const stoves = await freeStoves(page, 2);
    test.skip(stoves.length < 2, "not enough free stoves");

    const marker = `one${testInfo.workerIndex}-${Date.now()}`;
    const first = await callEdgeFunction(page, "data-center-import", {
      action: "workbench_save",
      stoveId: stoves[0],
      values: { ...receipt(marker), contactPerson: "One Batch", contactPhone: "08015550102" },
      complete: true,
    });
    expect(first.status).toBe(200);
    const batchId = (first.body as { data: { batchId: string } }).data.batchId;

    // Move the batch off 'staged', which is what used to orphan it.
    const checked = await callEdgeFunction(page, "data-center-import", {
      action: "validate",
      batchId,
    });
    expect(checked.status).toBe(200);

    const second = await callEdgeFunction(page, "data-center-import", {
      action: "workbench_save",
      stoveId: stoves[1],
      values: { ...receipt(marker), contactPerson: "One Batch", contactPhone: "08015550103" },
      complete: true,
    });
    expect(second.status).toBe(200);
    // The assertion the bug failed. It minted a second batch here, and the
    // typist's day split across rows in the confirmation queue.
    expect(
      (second.body as { data: { batchId: string } }).data.batchId,
      "the second receipt belongs in the batch the first one opened",
    ).toBe(batchId);

    await callEdgeFunction(page, "data-center-import", { action: "rollback", batchId });
  });
});

test.describe("the partner sweep counts the partner", () => {
  test("the total is the partner's, not the page's, and paging does not change it", async ({
    page,
  }) => {
    await signIn(page, USERS.admin);

    const small = await callEdgeFunction(page, "data-center-read", {
      action: "partner_stoves",
      organizationId: PARTNER,
      limit: 2,
    });
    expect(small.status).toBe(200);
    const a = (small.body as { data: { stoves: unknown[]; total: number; nextCursor: string } })
      .data;

    // A page of two, and a total that is not two. That gap is the whole point:
    // the screen used to print the first number and call it the second.
    expect(a.stoves.length).toBeLessThanOrEqual(2);
    expect(typeof a.total, "the server has to report a total to page against").toBe("number");
    test.skip(a.total <= 2, "this partner is too small to prove paging");
    expect(a.total).toBeGreaterThan(a.stoves.length);

    const next = await callEdgeFunction(page, "data-center-read", {
      action: "partner_stoves",
      organizationId: PARTNER,
      limit: 2,
      cursor: a.nextCursor,
    });
    const b = (next.body as { data: { stoves: { stove_id: string }[]; total: number } }).data;
    expect(b.total, "the total describes the set, so it does not move with the page").toBe(
      a.total,
    );
    const firstIds = (a.stoves as { stove_id: string }[]).map((s) => s.stove_id);
    expect(
      b.stoves.every((s) => !firstIds.includes(s.stove_id)),
      "page two is not page one again",
    ).toBe(true);
  });

  test("still-to-type is decided by the server, so its count is honest", async ({ page }) => {
    await signIn(page, USERS.admin);

    const ask = (recorded: string | null) =>
      callEdgeFunction(page, "data-center-read", {
        action: "partner_stoves",
        organizationId: PARTNER,
        limit: 5,
        recorded,
      });

    const all = (await ask(null)).body as { data: { total: number } };
    const todo = (await ask("no")).body as {
      data: { total: number; stoves: { sale_id: string | null }[] };
    };
    const done = (await ask("yes")).body as {
      data: { total: number; stoves: { sale_id: string | null }[] };
    };

    // The filter is real, not a label over an unfiltered page.
    expect(todo.data.stoves.every((s) => !s.sale_id)).toBe(true);
    expect(done.data.stoves.every((s) => s.sale_id)).toBe(true);
    // And it reconciles, which is what makes the chip's number worth printing.
    expect(todo.data.total + done.data.total).toBe(all.data.total);
  });
});
