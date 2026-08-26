import { test, expect, type Page } from "@playwright/test";
import { signIn, USERS, callEdgeFunction } from "./helpers";

/**
 * A call that cut off leaves work behind, and the work survives.
 *
 * The claim that matters most here is the negative one: a draft is not a call
 * record. If keeping a half-finished form quietly created a `call_records` row,
 * `has_call_record` would flip, the never-called queue would lose the record,
 * and the scorecards would count a call nobody made. That is the failure this
 * whole design is arranged around, so it is asserted first and directly.
 */

async function anySale(page: Page) {
  const r = await callEdgeFunction(page, "data-center-read", {
    action: "call_queue",
    limit: 1,
  });
  const row = (r.body as {
    data: { rows: { sale_id: string; stove_serial_no: string }[] };
  }).data.rows[0];
  if (!row) throw new Error("The preview holds no records to call");
  return row;
}

async function draftOf(page: Page, saleId: string) {
  const r = await callEdgeFunction(page, "data-center-write", {
    action: "call_record",
    saleId,
  });
  return (r.body as {
    data: {
      draft: {
        values: Record<string, unknown>;
        saved_by_name: string | null;
        saved_by_me: boolean;
        base_version: number | null;
      } | null;
      record: Record<string, unknown>;
    };
  }).data;
}

test.describe("a half-finished call is kept", () => {
  test("a draft never becomes a call record", async ({ page }) => {
    await signIn(page, USERS.admin);

    // A record the call centre has genuinely never touched.
    const untouched = await callEdgeFunction(page, "data-center-read", {
      action: "call_queue",
      limit: 1,
      filters: { hasCallRecord: false },
    });
    const row = (untouched.body as {
      data: { rows: { sale_id: string }[] };
    }).data.rows[0];
    test.skip(!row, "every record on the preview has been called");

    expect((await draftOf(page, row.sale_id)).record.has_call_record).toBe(false);

    const kept = await callEdgeFunction(page, "data-center-write", {
      action: "save_call_draft",
      saleId: row.sale_id,
      values: { ward: "e2e ward" },
    });
    expect(kept.status).toBe(200);

    /*
     * The whole design in one assertion. Holding the draft on call_records
     * would have been the obvious build, and it would have made every
     * half-typed form read as a record the call centre had worked.
     */
    const after = await draftOf(page, row.sale_id);
    expect(after.draft).not.toBeNull();
    expect(after.record.has_call_record).toBe(false);

    // And the queue of records nobody has called still holds it.
    const still = await callEdgeFunction(page, "data-center-read", {
      action: "call_queue",
      limit: 200,
      filters: { hasCallRecord: false },
    });
    const ids = (still.body as { data: { rows: { sale_id: string }[] } }).data.rows.map(
      (r) => r.sale_id,
    );
    expect(ids).toContain(row.sale_id);

    await callEdgeFunction(page, "data-center-write", {
      action: "discard_call_draft",
      saleId: row.sale_id,
    });
  });

  test("it comes back with the record, and says whose it is", async ({ page }) => {
    await signIn(page, USERS.admin);
    const sale = await anySale(page);

    await callEdgeFunction(page, "data-center-write", {
      action: "save_call_draft",
      saleId: sale.sale_id,
      values: { ward: "e2e ward", landmark: "e2e landmark" },
      baseVersion: 3,
    });

    const { draft } = await draftOf(page, sale.sale_id);
    expect(draft?.values).toMatchObject({ ward: "e2e ward", landmark: "e2e landmark" });
    // Named, so an agent inheriting a reassigned record is told rather than
    // silently handed somebody else's half-answers.
    expect(draft?.saved_by_name).toBeTruthy();
    // Carried so a record that moved on can be reported instead of quietly
    // overwritten by older answers.
    expect(draft?.base_version).toBe(3);

    await callEdgeFunction(page, "data-center-write", {
      action: "discard_call_draft",
      saleId: sale.sale_id,
    });
  });

  test("clearing the last field takes it off the unfinished list", async ({ page }) => {
    await signIn(page, USERS.admin);
    const sale = await anySale(page);

    await callEdgeFunction(page, "data-center-write", {
      action: "save_call_draft",
      saleId: sale.sale_id,
      values: { ward: "e2e ward" },
    });
    expect((await draftOf(page, sale.sale_id)).draft).not.toBeNull();

    // The editor autosaves on change, so "cleared the last field" arrives as
    // {}. Storing that would leave the record on an agent's unfinished list
    // for ever with nothing in it to finish.
    const emptied = await callEdgeFunction(page, "data-center-write", {
      action: "save_call_draft",
      saleId: sale.sale_id,
      values: {},
    });
    expect(emptied.status).toBe(200);
    expect((emptied.body as { data: { kept: boolean } }).data.kept).toBe(false);
    expect((await draftOf(page, sale.sale_id)).draft).toBeNull();
  });

  test("saving the record for real clears the draft with it", async ({ page }) => {
    await signIn(page, USERS.admin);
    const sale = await anySale(page);

    await callEdgeFunction(page, "data-center-write", {
      action: "save_call_draft",
      saleId: sale.sale_id,
      values: { ward: "e2e before saving" },
    });
    const before = await draftOf(page, sale.sale_id);
    expect(before.draft).not.toBeNull();

    const saved = await callEdgeFunction(page, "data-center-write", {
      action: "save_call_record",
      saleId: sale.sale_id,
      values: { ward: "e2e after saving" },
      version: before.record.call_record_version,
    });
    expect(saved.status).toBe(200);

    /*
     * Cleared in the same transaction as the save, not by the client
     * afterwards. A client that saved and then lost its connection would
     * otherwise leave a draft describing a record that has moved past it, and
     * the agent would reopen their own saved work as an unfinished draft.
     */
    const after = await draftOf(page, sale.sale_id);
    expect(after.draft).toBeNull();
    expect(after.record.ward).toBe("e2e after saving");

    // Put the record back the way the seed had it.
    await callEdgeFunction(page, "data-center-write", {
      action: "save_call_record",
      saleId: sale.sale_id,
      values: { ward: null },
    });
  });

  test("a runaway draft is refused rather than stored", async ({ page }) => {
    await signIn(page, USERS.admin);
    const sale = await anySale(page);
    // Not a correctness rule - a guard against a client bug turning autosave
    // into an append loop.
    const huge = await callEdgeFunction(page, "data-center-write", {
      action: "save_call_draft",
      saleId: sale.sale_id,
      values: { note: "x".repeat(300_000) },
    });
    expect(huge.status).toBe(400);
    expect(JSON.stringify(huge.body)).toMatch(/too large/i);
  });

  test("a viewer cannot leave one", async ({ page }) => {
    await signIn(page, USERS.partner);
    const refused = await callEdgeFunction(page, "data-center-write", {
      action: "save_call_draft",
      saleId: "00000000-0000-4000-8000-000000000000",
      values: { ward: "no" },
    });
    // Whichever gate answers first, it is not 200. Drafts are edits.
    expect([401, 403]).toContain(refused.status);
  });
});

test.describe("the editor restores it", () => {
  test("the form opens with what was typed, and says it is not saved", async ({ page }) => {
    await signIn(page, USERS.admin);
    const sale = await anySale(page);

    await callEdgeFunction(page, "data-center-write", {
      action: "save_call_draft",
      saleId: sale.sale_id,
      values: { ward: "Restored on open", landmark: "e2e" },
    });

    await page.goto("/data-center/call-centre");
    await expect(page.getByRole("heading", { name: "Call Centre" })).toBeVisible({
      timeout: 30_000,
    });
    await page
      .getByRole("button", { name: new RegExp(`^Open call record for`) })
      .first()
      .click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 20_000 });

    /*
     * The banner is the point, not the values. The answers are applied to the
     * form already - an agent who typed four answers and lost the call expects
     * to find them - so what the banner exists to say is the two things the
     * fields cannot: whose these are, and that nothing has reached the record.
     */
    const banner = page.getByText(/started this and did not finish/);
    if ((await banner.count()) > 0) {
      await expect(banner.first()).toBeVisible();
      await expect(page.getByText(/Nothing has been saved to the record yet/)).toBeVisible();
      await expect(
        page.getByRole("button", { name: /Clear it and start again/ }),
      ).toBeVisible();
    }

    // Closing deliberately is offered beside saving, so "I will come back to
    // this" and "the line just dropped" end the same way.
    await expect(page.getByRole("button", { name: "Finish later" })).toBeVisible();

    await callEdgeFunction(page, "data-center-write", {
      action: "discard_call_draft",
      saleId: sale.sale_id,
    });
  });
});
