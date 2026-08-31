import { test, expect, type Page } from "@playwright/test";
import { signIn, USERS, callEdgeFunction } from "./helpers";

/**
 * Four surfaces, one theme: a register of half a million records has to be
 * navigable without scrolling through it, and a path with a step outside the
 * app has to say so.
 *
 * The endpoint assertions here are the ones that matter most. A filter that
 * silently matches nothing looks exactly like a filter with no results, and
 * that is how the sales-rep drill-through was broken for as long as it
 * existed: it compared a sale's own transaction reference with a transfer's,
 * two different namespaces sharing a column name. The UI could not have told
 * anyone - an empty table is what "no results" looks like too.
 */

async function openStoveRecords(page: Page) {
  await signIn(page, USERS.admin);
  await page.goto("/data-center/stove-records");
  await expect(page.getByRole("heading", { name: "Stove Records" })).toBeVisible({
    timeout: 30_000,
  });
}

test.describe("a stove's history does not bury the stove", () => {
  test("the newest five, with the total beside them and the rest on request", async ({
    page,
  }) => {
    await signIn(page, USERS.admin);
    const queue = await callEdgeFunction(page, "data-center-read", {
      action: "call_queue",
      limit: 1,
    });
    const row = (queue.body as { data: { rows: { stove_serial_no: string }[] } }).data.rows[0];
    test.skip(!row, "no records on the preview");

    await page.goto(`/data-center/stove/${encodeURIComponent(row.stove_serial_no)}`);
    await expect(page.getByRole("heading", { name: "Everything that changed" })).toBeVisible({
      timeout: 30_000,
    });

    const section = page
      .locator("section", { has: page.getByRole("heading", { name: "Everything that changed" }) })
      .first();

    /*
     * Five, not everything. The endpoint is asked for six so it can answer
     * "there are more" without counting; the page shows five of them.
     */
    const items = section.locator("li");
    const before = await items.count();
    expect(before).toBeLessThanOrEqual(5);

    const more = section.getByRole("button", { name: /^Show \d+ more$/ });
    test.skip((await more.count()) === 0, "this record has five edits or fewer");

    // The footer states the total, so "show more" is a decision rather than a
    // guess about whether more means two or two hundred.
    await expect(section.getByText(/Showing \d+ of \d+ edits/)).toBeVisible();

    await more.click();
    await expect
      .poll(async () => items.count(), { timeout: 20_000 })
      .toBeGreaterThan(before);

    // And back again. Collapse and expand are separate handlers: passed as one,
    // React's click event arrives as the "collapse instead" argument and the
    // button collapses on every press.
    await section.getByRole("button", { name: "Collapse" }).click();
    await expect.poll(async () => items.count()).toBe(before);
  });

  test("more history is keyset paged, not offset paged", async ({ page }) => {
    await signIn(page, USERS.admin);
    const queue = await callEdgeFunction(page, "data-center-read", {
      action: "call_queue",
      limit: 1,
    });
    const sale = (queue.body as { data: { rows: { sale_id: string }[] } }).data.rows[0];

    const first = await callEdgeFunction(page, "data-center-read", {
      action: "stove_changes",
      saleId: sale.sale_id,
      limit: 3,
    });
    expect(first.status).toBe(200);
    const one = (first.body as {
      data: { rows: { id: string }[]; hasMore: boolean; nextCursor: unknown };
    }).data;
    test.skip(!one.hasMore, "this record has three edits or fewer");

    const second = await callEdgeFunction(page, "data-center-read", {
      action: "stove_changes",
      saleId: sale.sale_id,
      limit: 3,
      cursor: one.nextCursor,
    });
    const two = (second.body as { data: { rows: { id: string }[] } }).data;

    // No row appears twice. A cursor that tied on changed_at alone would repeat
    // rows, because a batch commit writes several audit rows inside one
    // transaction sharing a timestamp to the microsecond.
    const ids = new Set(one.rows.map((r) => r.id));
    for (const r of two.rows) expect(ids.has(r.id)).toBe(false);
  });

  test("a history request without a record is refused", async ({ page }) => {
    await signIn(page, USERS.admin);
    const refused = await callEdgeFunction(page, "data-center-read", {
      action: "stove_changes",
    });
    expect(refused.status).toBe(400);
    expect(JSON.stringify(refused.body)).toMatch(/which record/i);
  });
});

test.describe("the register can be narrowed rather than scrolled", () => {
  test("every filter the server accepts is offered by name", async ({ page }) => {
    await signIn(page, USERS.admin);
    const r = await callEdgeFunction(page, "data-center-read", { action: "record_facets" });
    expect(r.status).toBe(200);
    const f = (r.body as {
      data: {
        partners: unknown[];
        salesReps: unknown[];
        states: string[];
        lgasByState: Record<string, string[]>;
        salesModels: unknown[];
        salesAgents: unknown[];
      };
    }).data;

    // Reference data, so these hold whether or not anybody has sold there.
    expect(f.states.length).toBeGreaterThan(30);
    expect(Object.keys(f.lgasByState).length).toBeGreaterThan(30);
    expect(f.partners.length).toBeGreaterThan(0);
    expect(f.salesAgents.length).toBeGreaterThan(0);
  });

  test("the sales rep filter reaches the sales that rep's transfers produced", async ({
    page,
  }) => {
    await signIn(page, USERS.admin);
    const facets = await callEdgeFunction(page, "data-center-read", {
      action: "record_facets",
    });
    const reps = (facets.body as { data: { salesReps: { name: string }[] } }).data.salesReps;
    test.skip(reps.length === 0, "no transfers on the preview");

    /*
     * The regression this test exists for.
     *
     * A sale's transaction_id is the sale's own reference; a transfer's is the
     * consignment's, and it reaches the sale through the stock row rather than
     * directly. Compared to each other they never match, so the filter matched
     * nothing and the scorecard drill-through opened an empty table.
     *
     * Asserted as "at least one rep reaches at least one sale" rather than an
     * exact count, because the seed can change. Every rep matching nothing is
     * the failure, and it is the one an empty table cannot tell you about.
     */
    let reached = 0;
    for (const rep of reps) {
      const r = await callEdgeFunction(page, "data-center-read", {
        action: "records",
        limit: 5,
        filters: { transferSalesRep: rep.name },
      });
      expect(r.status).toBe(200);
      reached += (r.body as { data: { total: number } }).data.total;
    }
    expect(reached).toBeGreaterThan(0);
  });

  test("the match count answers the filter, not the page", async ({ page }) => {
    await signIn(page, USERS.admin);
    const first = await callEdgeFunction(page, "data-center-read", {
      action: "records",
      limit: 2,
    });
    const one = (first.body as {
      data: { total: number; nextCursor: unknown; hasMore: boolean };
    }).data;
    expect(typeof one.total).toBe("number");

    test.skip(!one.hasMore, "the preview holds one page of records");
    const second = await callEdgeFunction(page, "data-center-read", {
      action: "records",
      limit: 2,
      cursor: one.nextCursor,
    });
    // Null rather than a smaller number. "How many match" was answered on page
    // one; recomputing it per page would both cost a statement and, built after
    // the cursor, count down as somebody scrolled.
    expect((second.body as { data: { total: number | null } }).data.total).toBeNull();
  });

  test("turning the sort round reads from the other end of the register", async ({ page }) => {
    await signIn(page, USERS.admin);
    const newest = await callEdgeFunction(page, "data-center-read", {
      action: "records",
      limit: 1,
      direction: "desc",
    });
    const oldest = await callEdgeFunction(page, "data-center-read", {
      action: "records",
      limit: 1,
      direction: "asc",
    });
    const a = (newest.body as { data: { rows: { sales_date: string }[] } }).data.rows[0];
    const b = (oldest.body as { data: { rows: { sales_date: string }[] } }).data.rows[0];
    test.skip(!a || !b || a.sales_date === b.sales_date, "one date on the preview");
    expect(a.sales_date >= b.sales_date).toBe(true);
  });

  test("the panel opens, narrows, and says what it narrowed to", async ({ page }) => {
    await openStoveRecords(page);

    await page.getByRole("button", { name: /More filters/ }).click();
    const partner = page.getByLabel("Partner", { exact: true });
    await expect(partner).toBeVisible();

    // The LGA cannot be chosen before its state, and says so rather than being
    // hidden: a control that vanishes is a control somebody hunts for.
    const lga = page.getByLabel("Buyer's LGA");
    await expect(lga).toBeDisabled();
    await page.getByLabel("Buyer's state").selectOption("Gombe");
    await expect(lga).toBeEnabled();

    // Every active filter says its own name and comes off on its own. A filter
    // set and forgotten is how somebody concludes a partner has no records.
    await expect(page.getByText("Filtered to")).toBeVisible();
    await expect(page.getByText("Gombe state")).toBeVisible();

    await page.getByRole("button", { name: /Remove filter: Gombe state/ }).click();
    await expect(page.getByText("Gombe state")).toHaveCount(0);
    // The LGA went with it: an LGA whose state is gone filters for somewhere
    // that is no longer on offer, and returns nothing for a reason nobody sees.
    await expect(lga).toBeDisabled();
  });

  test("the header counts what matched, not what loaded", async ({ page }) => {
    await openStoveRecords(page);
    await expect(page.getByText(/\d+\+? records? · \d+ loaded/)).toBeVisible({
      timeout: 30_000,
    });
  });
});

test.describe("bulk import leads with where the file comes from", () => {
  test("all three steps are on the page, including the one that is not", async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/import");
    await expect(page.getByRole("heading", { name: "Bulk Import" })).toBeVisible({
      timeout: 30_000,
    });

    /*
     * Folded, then opened.
     *
     * This block used to be open on arrival, on the reasoning that the page
     * should read in the order the job happens rather than starting in the
     * middle of it. That reasoning holds for somebody arriving at step one and
     * fails for everybody else: an operator whose file is already staged and
     * waiting on a decision met three panels of instructions for work they had
     * finished, above the thing they needed.
     *
     * So it is one click instead of none. What this test protects is unchanged:
     * the guidance exists, and it still names all three steps including the one
     * that happens in Excel.
     */
    const how = page.getByRole("button", { name: /How a bulk import works/ });
    await expect(how).toBeVisible();
    await how.click();

    for (const step of [
      "Download the sheet for a partner",
      // Named even though it happens in Excel. Somebody who has never
      // downloaded a sheet should see that they are missing a step rather than
      // conclude the upload is broken.
      "Fill it in, away from the app",
      "Upload it back",
    ]) {
      await expect(page.getByText(step, { exact: true })).toBeVisible();
    }
  });

  test("the sheet needs a partner, and then builds", async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/import");
    await expect(page.getByRole("heading", { name: "Bulk Import" })).toBeVisible({
      timeout: 30_000,
    });

    // The sheet builder lives inside the guidance block, which is folded now.
    await page.getByRole("button", { name: /How a bulk import works/ }).click();

    const build = page.getByRole("button", { name: "Build the sheet" });
    await expect(build).toBeDisabled();

    /*
     * A partner IS chosen here and is NOT chosen on upload, and the asymmetry
     * is the point: the sheet is built from a partner's transfers so it cannot
     * exist without one, while a filled-in sheet carries stove IDs that already
     * say whose it is.
     */
    const picker = page.getByLabel("Whose stoves");
    await expect(picker).toBeEnabled({ timeout: 20_000 });
    const options = await picker.locator("option").count();
    test.skip(options < 2, "no partners available to this user");
    await picker.selectOption({ index: 1 });
    await expect(build).toBeEnabled();

    await build.click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Sheet for digitalisation/)).toBeVisible();
  });

  test("the upload still asks nothing about which partner", async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/import");
    await expect(page.getByRole("heading", { name: "Bulk Import" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.getByText(/stove IDs in the file say which partner it belongs to/),
    ).toBeVisible();
  });
});

test.describe("the call brief reads as five blocks, not one sheet", () => {
  test("each block is titled, and the chase count is in the heading", async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/call-centre");
    await expect(page.getByRole("heading", { name: "Call Centre" })).toBeVisible({
      timeout: 30_000,
    });

    await page.getByRole("button", { name: /^Open call record for/ }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 20_000 });

    for (const group of [
      "Who you are ringing",
      "The stove they have",
      "What they paid, and to whom",
      "Where they live",
      "What has happened so far",
    ]) {
      await expect(page.getByText(group, { exact: true })).toBeVisible();
    }

    // Three chases is where the process stops calling, so it belongs in the
    // block heading rather than four fields down among the dates.
    await expect(
      page.getByText(/^(chased three times|\d+ so far)$/).first(),
    ).toBeVisible();
  });
});
