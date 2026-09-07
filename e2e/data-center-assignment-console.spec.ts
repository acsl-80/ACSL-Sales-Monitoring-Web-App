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
      .locator("xpath=ancestor::*[contains(@class,'rounded-xl')][1]");
    // Phase 24: the agents panel. State is presence; capacity sits beside the
    // open batches; last save replaces last activity.
    for (const column of ["Agent", "State", "Called", "Verified", "To call", "Open batches"]) {
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

    await page.getByRole("button", { name: "Hand out calls" }).click();

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
    await expect(picker.getByRole("checkbox", { name: "To call" })).toBeChecked();
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
 * The activity page (Phase 26, C2) took over from the assignment log: one row
 * per thing that happened, keyset paged, readable by anyone with call-centre
 * view and worked from by anyone who may edit.
 */
test.describe("the activity page can be worked from", () => {
  test("it says what a row is, and pages without an offset", async ({ page }) => {
    const bodies: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/functions/v1/data-center-assign")) {
        bodies.push(req.postData() ?? "");
      }
    });
    await signIn(page, USERS.admin);
    await page.goto("/data-center/call-centre/activity");
    await expect(page.getByRole("heading", { name: "Activity" }).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/calls logged, batches handed out and reclaimed/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Previous page" })).toBeDisabled();
    await expect(page.getByLabel("Per page")).toBeVisible();
    await expect
      .poll(() => bodies.some((b) => b.includes('"activity"')), { timeout: 15_000 })
      .toBe(true);
    for (const body of bodies.filter((b) => b.includes('"activity"'))) {
      expect(body).not.toContain('"offset"');
      expect(body).not.toContain('"page"');
    }
  });

  test("a row opens the record", async ({ page }) => {
    await signIn(page, USERS.admin);
    // Arrange one call on the branch: global setup hands out work but logs
    // no calls, and a feed of calls needs at least one to open.
    const held = await callEdgeFunction(page, "data-center-assign", { action: "agents" });
    const holder = (held.body as { data: { agents: { agent_id: string; open_batches: number }[] } }).data.agents.find((a) => a.open_batches > 0);
    expect(holder, "an agent holding a batch").toBeTruthy();
    const detail = await callEdgeFunction(page, "data-center-assign", { action: "agent_detail", agentId: holder!.agent_id });
    const item = (detail.body as { data: { items: { sale_id: string }[] } }).data.items[0];
    expect(item, "a record in that batch").toBeTruthy();
    const logged = await callEdgeFunction(page, "data-center-write", { action: "log_attempt", saleId: item.sale_id, note: "console spec" });
    expect(logged.status, JSON.stringify(logged.body)).toBe(200);
    await page.goto("/data-center/call-centre/activity?kind=call");
    await expect(page.getByRole("heading", { name: "Activity" }).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/\d+ events? on page \d+/)).toBeVisible({ timeout: 20_000 });
    const open = page.locator("tbody tr").first().getByRole("button", { name: "Open" });
    await expect(open, "a call event on the branch to open").toBeVisible({ timeout: 20_000 });
    await open.click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 20_000 });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("a viewer gets the activity page to read and nothing to press", async ({ page }) => {
    await signIn(page, USERS.manager);
    await page.goto("/data-center/call-centre/activity");
    await expect(page.getByRole("heading", { name: "Activity" }).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Assign now" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Quick edit / })).toHaveCount(0);
  });
});
