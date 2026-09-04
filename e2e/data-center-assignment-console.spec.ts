import { test, expect } from "@playwright/test";
import { signIn, USERS, callEdgeFunction } from "./helpers";

/**
 * Directed assignment: the console over the engine's own tables.
 *
 * The engine could hand work out and nobody could see it or overrule it. These
 * tests hold the two things that changed: a supervisor can look at who is
 * holding what, and can move it.
 *
 * The invariants are not retested here - a record in two batches at once is
 * refused by a partial unique index, and data-center-assignment.spec.ts already
 * proves it against the engine. What matters here is that the manual path goes
 * through the same tables rather than around them.
 */

test.describe("the assignment console shows who holds what", () => {
  test("agents are listed with their load", async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/call-centre");

    await expect(
      page.getByRole("heading", { name: "Agents and their work" }),
    ).toBeVisible({ timeout: 20_000 });

    // Scoped to the console's own table: the call queue above it has an Agent
    // column too, and an unscoped header lookup finds both.
    const console_ = page
      .getByRole("heading", { name: "Agents and their work" })
      .locator("xpath=ancestor::div[contains(@class,'rounded-xl')][1]");
    for (const column of ["Agent", "Level", "Batches", "Records held", "Last activity"]) {
      await expect(
        console_.getByRole("columnheader", { name: column, exact: true }),
      ).toBeVisible();
    }

    // The seeded call agent is one of the people who can take work.
    await expect(page.getByText("callcentre@preview.acsl.test")).toBeVisible();
  });

  test("an agent opens to what they are holding, by partner", async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/call-centre");
    await expect(
      page.getByRole("heading", { name: "Agents and their work" }),
    ).toBeVisible({ timeout: 20_000 });

    await page.getByRole("button", { name: /^What .* is holding$/ }).first().click();

    // Either they hold something, drawn as partner batches, or they do not and
    // the empty state says so. Both are correct; a spinner that never resolves
    // is not.
    await expect(
      page.getByText(/Holding nothing right now|Export what they hold/),
    ).toBeVisible({ timeout: 20_000 });
  });

  test("assigning offers the partners that have work waiting", async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/call-centre");
    await expect(
      page.getByRole("heading", { name: "Agents and their work" }),
    ).toBeVisible({ timeout: 20_000 });

    await page.getByRole("button", { name: "Assign", exact: true }).first().click();

    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByText(/Assign work to /)).toBeVisible();
    // One partner at a time is the design, not a limitation: an agent's queue
    // never mixes partners, so ten of each is two batches.
    await expect(
      page.getByText(/Partners with work waiting|Nothing is waiting to be called/),
    ).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("the console exports, and lets the columns be chosen", async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/call-centre");
    await expect(
      page.getByRole("heading", { name: "Agents and their work" }),
    ).toBeVisible({ timeout: 20_000 });

    await expect(page.getByRole("button", { name: "Export agents" })).toBeVisible();
    // The page carries two exports, so each column picker is named after the
    // one it belongs to rather than both saying "choose columns".
    await page.getByRole("button", { name: "Columns for agents" }).click();

    // All or none, then the columns themselves. An export that is the input to
    // something else needs to be able to leave columns out.
    const picker = page.getByRole("dialog");
    await expect(picker).toBeVisible();
    await expect(picker.getByRole("button", { name: "Select all" })).toBeVisible();
    await expect(picker.getByRole("button", { name: "Clear all" })).toBeVisible();
    await expect(picker.getByRole("checkbox", { name: "Records held" })).toBeChecked();
  });
});

test.describe("assigning by hand goes through the engine's own tables", () => {
  test("a manual batch is made, then returned to the pool", async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/call-centre");
    await expect(
      page.getByRole("heading", { name: "Agents and their work" }),
    ).toBeVisible({ timeout: 20_000 });

    const before = await callEdgeFunction(page, "data-center-assign", { action: "agents" });
    expect(before.status).toBe(200);
    const state = (before.body as {
      data: {
        agents: { agent_id: string; records_held: number }[];
        pool: { organization_id: string; callable: number }[];
      };
    }).data;

    // Arrange rather than skip. A skipped test reads as a pass, and this one
    // is the only thing proving manual assignment end to end - so if the pool
    // happens to be empty because everything is already assigned, put one
    // record back and use that. Unassigning is itself under test below.
    let pool = state.pool;
    if (pool.length === 0) {
      const held = await callEdgeFunction(page, "data-center-assign", {
        action: "agent_detail",
        agentId: state.agents[0].agent_id,
      });
      const items = (held.body as { data: { items: { sale_id: string }[] } }).data.items;
      expect(items.length).toBeGreaterThan(0);
      await callEdgeFunction(page, "data-center-assign", {
        action: "unassign_item",
        saleId: items[0].sale_id,
      });
      const refreshed = await callEdgeFunction(page, "data-center-assign", { action: "agents" });
      pool = (refreshed.body as { data: { pool: typeof state.pool } }).data.pool;
    }
    expect(pool.length).toBeGreaterThan(0);

    const agent = state.agents[0];
    const partner = pool[0];
    const want = Math.min(2, partner.callable);

    const assigned = await callEdgeFunction(page, "data-center-assign", {
      action: "assign_manual",
      agentId: agent.agent_id,
      organizationId: partner.organization_id,
      size: want,
      // Phase 24: the engine's batch already fills this agent's capacity of
      // one; a second by hand needs a reason, which lands on the batch.
      overrideReason: "e2e: a second batch on top of the engine's",
    });
    expect(assigned.status).toBe(200);
    const batch = (assigned.body as { data: { batchId: string | null; size: number } }).data;
    expect(batch.size).toBe(want);
    expect(batch.batchId).not.toBeNull();

    // It shows up as that agent's work, by partner, with serials to drill into.
    const detail = await callEdgeFunction(page, "data-center-assign", {
      action: "agent_detail",
      agentId: agent.agent_id,
    });
    const items = (detail.body as {
      data: { items: { batch_id: string; stove_serial_no: string }[] };
    }).data.items;
    expect(items.filter((i) => i.batch_id === batch.batchId)).toHaveLength(want);
    expect(items[0].stove_serial_no).toBeTruthy();

    // And returning it puts the records back rather than losing them.
    const released = await callEdgeFunction(page, "data-center-assign", {
      action: "unassign_batch",
      batchId: batch.batchId,
    });
    expect(released.status).toBe(200);
    expect((released.body as { data: { released: number } }).data.released).toBe(want);

    const after = await callEdgeFunction(page, "data-center-assign", { action: "agents" });
    const poolAfter = (after.body as { data: { pool: { callable: number }[] } }).data.pool;
    // Exactly what it took, back where it came from. Compared against the pool
    // as it stood after arranging, not before.
    expect(poolAfter.reduce((n, p) => n + p.callable, 0)).toBe(
      pool.reduce((n, p) => n + p.callable, 0),
    );
  });

  test("a batch of nothing is never handed to anyone", async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/call-centre");
    await expect(
      page.getByRole("heading", { name: "Agents and their work" }),
    ).toBeVisible({ timeout: 20_000 });

    const state = await callEdgeFunction(page, "data-center-assign", { action: "agents" });
    const agents = (state.body as { data: { agents: { agent_id: string }[] } }).data.agents;

    // A partner with nothing callable. The batch is made, comes back empty and
    // is deleted, so nobody is left holding a batch of nothing.
    const empty = await callEdgeFunction(page, "data-center-assign", {
      action: "assign_manual",
      agentId: agents[0].agent_id,
      organizationId: "00000000-0000-0000-0000-000000000000",
      size: 5,
      // The capacity rule would answer first; it is covered by its own spec.
      overrideReason: "e2e: an empty partner, on top of the engine's batch",
    });
    expect([200, 500]).toContain(empty.status);
    if (empty.status === 200) {
      expect((empty.body as { data: { size: number } }).data.size).toBe(0);
    }
  });

  test("only a super admin may assign", async ({ page }) => {
    await signIn(page, USERS.callCentre);
    await page.goto("/data-center/call-centre");
    await expect(page.getByRole("heading", { name: "Call Centre" }).first()).toBeVisible({
      timeout: 20_000,
    });

    // The console is not drawn for them, and the endpoint refuses regardless:
    // a hidden button is not a permission.
    await expect(
      page.getByRole("heading", { name: "Agents and their work" }),
    ).toHaveCount(0);

    const refused = await callEdgeFunction(page, "data-center-assign", { action: "agents" });
    expect(refused.status).toBe(403);
  });
});

/**
 * The assignment log, as a place of work.
 *
 * It was a table you could only look at, which made it a report: seeing that a
 * record had been rung twice and concluded nothing, you then went and found it
 * in the queue. The row is now the way in.
 */
test.describe("the assignment log can be worked from", () => {
  test("it says what a row is, and pages without an offset", async ({ page }) => {
    const bodies: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/functions/v1/data-center-read")) {
        bodies.push(req.postData() ?? "");
      }
    });

    await signIn(page, USERS.admin);
    await page.goto("/data-center/call-centre");

    await expect(page.getByText("Assignment Log")).toBeVisible({ timeout: 20_000 });
    // The table was read as a list of batches, which it is not.
    await expect(
      page.getByText(/One line per record handed to an agent/),
    ).toBeVisible();

    await expect(page.getByRole("button", { name: "Previous page" })).toBeDisabled();
    await expect(page.getByLabel("Per page")).toBeVisible();

    // Keyset, never OFFSET: at 500,000 rows page 400 would read every row
    // before it.
    await expect
      .poll(() => bodies.some((b) => b.includes('"assignment_log"')), { timeout: 15_000 })
      .toBe(true);
    for (const body of bodies) {
      expect(body).not.toContain('"offset"');
    }
  });

  test("a row opens the record, and the quick edit logs a call", async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/call-centre");
    await expect(page.getByText("Assignment Log")).toBeVisible({ timeout: 20_000 });

    /*
     * Wait for the log to have LOADED, not merely to exist.
     *
     * "Assignment Log" is static chrome in the panel header and renders before
     * the fetch returns. Counting the quick-edit buttons straight after it
     * found none every single time, and the skip below then reported green
     * over a feature nobody had ever checked - on a preview holding 52 batches
     * and 41 items, so the reason given ("nothing assigned") was not even
     * true. This is the failure CLAUDE.md describes: when a helper can fail,
     * make it wait on something that only exists once the data is there.
     *
     * The footer counts the rows it drew, so it is that signal.
     */
    await expect(page.getByText(/\d+ records? on page \d+/)).toBeVisible({ timeout: 20_000 });

    const quick = page.getByRole("button", { name: /^Quick edit / }).first();
    test.skip((await quick.count()) === 0, "Nothing assigned to work from");

    // The quick edit is the two things anyone actually does here, without
    // opening the record at all.
    await quick.click();
    await expect(page.getByLabel("Log a call")).toBeVisible();
    await expect(page.getByText("Settle the verification")).toBeVisible();
    await page.keyboard.press("Escape");

    /*
     * And the row itself opens the same enrichment editor the queue opens.
     *
     * The row is taken FROM the button rather than filtered by it.
     * `filter({ has: quick })` reads as "the row containing this button" and
     * means "every row containing any matching button", which on a page of
     * twenty-five assignments is twenty-five rows and a strict-mode violation.
     */
    /*
     * A CELL, not the row.
     *
     * `.click()` on the <tr> targets its geometric centre, and the sixth
     * column is the stove serial - a Link whose onClick calls
     * stopPropagation, deliberately, so that opening the stove's history and
     * opening the call record are different gestures. When the data makes the
     * columns wide enough that the row's centre lands on that link, the click
     * navigates to the stove record and no dialog ever appears.
     *
     * It passed for months because the seeded rows happened to be narrow. It
     * started failing when new specs changed which rows the log draws, which
     * is the test being fragile rather than the product being wrong. The first
     * cell holds a state chip and can never hold a link, and a click on it
     * still bubbles to the row.
     */
    await quick.locator("xpath=ancestor::tr[1]").locator("td").first().click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 20_000 });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("a viewer gets the log to read and nothing to press", async ({ page }) => {
    await signIn(page, USERS.manager);
    await page.goto("/data-center/call-centre");
    await expect(page.getByText("Assignment Log")).toBeVisible({ timeout: 20_000 });

    // A viewer holds no call_records.edit, so the row is not a door and the
    // pencil is not drawn. The endpoint refuses regardless.
    await expect(page.getByRole("button", { name: /^Quick edit / })).toHaveCount(0);
    await expect(page.getByText(/Open a row to enrich it/)).toHaveCount(0);
  });
});
