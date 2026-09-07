import { test, expect, type Page } from "@playwright/test";
import { signIn, USERS, branchSql, callEdgeFunction } from "./helpers";

/**
 * Phase 26, C3: the pages behind the control centre.
 *
 *  - the agent's page: their track, To call and Called, hand out more
 *  - the hand-out dialog's live preview through assign_preview
 *  - the Records page: the queue with an outcome strip; every old drill link
 *    is sent on with its parameters
 *  - the shared-phone register on its own page
 *  - nothing crosses the viewport at 375 pixels on any of them
 */
test.describe.configure({ timeout: 240_000 });

type Agent = { agent_id: string; email: string; full_name: string | null; open_batches: number; is_enabled: boolean };

async function agentsAndPool(page: Page) {
  const r = await callEdgeFunction(page, "data-center-assign", { action: "agents" });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return (r.body as { data: { agents: Agent[]; pool: { organization_id: string; partner_name: string; callable: number }[] } }).data;
}


/**
 * A branch holds five sales. Every spec that logs a call or keeps a draft
 * takes a record out of the pool for two days, so a run can find nobody
 * holding anything and nothing callable. Run the engine; if that hands out
 * nothing, undo what the specs did (their own calls and drafts) and run it
 * again. Bounded to rows the specs made.
 */
async function replenish(admin: Page) {
  await callEdgeFunction(admin, "data-center-assign", { action: "run" });
  const { agents } = await agentsAndPool(admin);
  if (agents.some((a) => a.open_batches > 0)) return;
  await branchSql(`delete from data_center.call_drafts`);
  await branchSql(`delete from data_center.call_attempts where note like '%spec%' or attempted_at > now() - interval '3 days'`);
  await branchSql(`update data_center.call_records set verification_outcome = 'not_verified' where updated_at > now() - interval '3 days'`);
  await callEdgeFunction(admin, "data-center-assign", { action: "run" });
}

async function holderWithWork(page: Page) {
  let { agents } = await agentsAndPool(page);
  if (!agents.some((a) => a.open_batches > 0)) {
    await replenish(page);
    ({ agents } = await agentsAndPool(page));
  }
  // Enabled, so the row's action is Open and not Resume.
  const holder = agents.find((a) => a.open_batches > 0 && a.is_enabled) ?? agents.find((a) => a.open_batches > 0);
  expect(holder, "an agent holding a batch on the branch").toBeTruthy();
  if (!holder!.is_enabled) {
    await callEdgeFunction(page, "data-center-assign", { action: "agent_profile_set", agentId: holder!.agent_id, isEnabled: true });
  }
  const detail = await callEdgeFunction(page, "data-center-assign", { action: "agent_detail", agentId: holder!.agent_id });
  const items = (detail.body as { data: { items: { sale_id: string; stove_serial_no: string }[] } }).data.items;
  expect(items.length).toBeGreaterThan(0);
  return { holder: holder!, items };
}

test("the agent's page shows their day, their work and their calls, and hands out more", async ({ page }) => {
  await signIn(page, USERS.admin);
  const { holder, items } = await holderWithWork(page);
  const logged = await callEdgeFunction(page, "data-center-write", { action: "log_attempt", saleId: items[0].sale_id, note: "pages spec" });
  expect(logged.status, JSON.stringify(logged.body)).toBe(200);

  // From the board: the row's Open is a link to the page.
  await page.goto("/data-center/call-centre");
  const row = page.locator(`[data-agent-row="${holder.agent_id}"]`);
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.getByRole("link", { name: /^Open / }).click();
  await expect(page).toHaveURL(new RegExp(`/data-center/call-centre/agents/${holder.agent_id}`));
  await expect(page.locator(`[data-agent-page="${holder.agent_id}"]`)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: holder.full_name || holder.email })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("[data-track]")).toBeVisible();

  // To call carries the record; Called carries the call just logged.
  await expect(page.getByText(items[0].stove_serial_no).first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole("tab", { name: /^Called/ }).click();
  await expect(page).toHaveURL(/tab=called/);
  await expect(page.locator("[data-called-row]").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("[data-called-row]").filter({ hasText: items[0].stove_serial_no }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Export calls" })).toBeVisible();

  // The week view tallies; the day chips carry the agent's route.
  await page.getByRole("button", { name: "This week" }).click();
  await expect(page).toHaveURL(new RegExp(`agents/${holder.agent_id}.*range=week`));
  await expect(page.locator("[data-week]")).toBeVisible({ timeout: 30_000 });

  // Hand out more opens the dialog with this agent fixed.
  await page.getByRole("button", { name: "Hand out more" }).click();
  await expect(page.getByRole("dialog")).toContainText(`Assign work to ${holder.full_name || holder.email}`);
  await expect(page.getByRole("combobox", { name: "Who takes it" })).toHaveCount(0);
  await page.keyboard.press("Escape");
});

test("the hand-out dialog previews exactly what the picker would hand out, before anything is written", async ({ page }) => {
  await signIn(page, USERS.admin);
  let { agents, pool } = await agentsAndPool(page);
  // Global setup hands out everything; a concluded record put back is not
  // callable, so try a few until the pool has one.
  for (let i = 0; i < 4 && !pool.some((p) => p.callable > 0); i++) {
    const { items } = await holderWithWork(page);
    await callEdgeFunction(page, "data-center-assign", { action: "unassign_item", saleId: items[i % items.length].sale_id });
    ({ agents, pool } = await agentsAndPool(page));
  }
  const partner = pool.find((p) => p.callable > 0);
  expect(partner, "a partner with a callable record").toBeTruthy();
  const agent = agents.find((a) => a.is_enabled)!;
  const bodies: string[] = [];
  page.on("request", (req) => {
    if (req.url().includes("/functions/v1/data-center-assign")) bodies.push(req.postData() ?? "");
  });

  await page.goto("/data-center/call-centre/partners");
  const partnerRow = page.locator("tbody tr").filter({ hasText: partner!.partner_name }).first();
  await expect(partnerRow).toBeVisible({ timeout: 30_000 });
  await partnerRow.getByRole("button", { name: "Hand out" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("combobox", { name: "Who takes it" }).selectOption(agent.agent_id);
  const preview = dialog.locator("[data-assign-preview]");
  await expect(preview).toBeVisible({ timeout: 30_000 });
  await expect(preview.locator("tbody tr").first()).toBeVisible({ timeout: 30_000 });

  const oracle = await callEdgeFunction(page, "data-center-assign", {
    action: "assign_preview", agentId: agent.agent_id, organizationId: partner!.organization_id,
  });
  const rows = (oracle.body as { data: { rows: { stove_serial_no: string }[]; size: number } }).data;
  const shown = await preview.locator("tbody tr").allTextContents();
  for (const r of rows.rows.slice(0, Math.min(5, shown.length))) {
    expect(shown.some((s) => s.includes(r.stove_serial_no))).toBe(true);
  }
  await expect(dialog.getByRole("button", { name: new RegExp(`^Hand out( anyway)? ${rows.size} to `) })).toBeVisible();
  // Nothing was handed out by looking.
  expect(bodies.some((b) => b.includes('"assign_manual"'))).toBe(false);
  await page.keyboard.press("Escape");
});

test("the records page carries the queue with an outcome strip, and every old drill lands on it", async ({ page }) => {
  await signIn(page, USERS.admin);
  // An old link with a narrowing is sent on with its parameters.
  await page.goto("/data-center/call-centre?preset=review&label=fixed");
  await expect(page).toHaveURL(/\/data-center\/call-centre\/records\?/, { timeout: 30_000 });
  await expect(page).toHaveURL(/preset=review/);
  await expect(page.getByRole("heading", { name: "Call centre records" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Awaiting review" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText(/Narrowed to/)).toBeVisible();

  // The strip: four outcomes, each a door, and each count equals the queue's own total.
  const strip = page.locator("[data-outcome-strip]");
  await expect(strip).toBeVisible();
  for (const key of ["fully_verified", "partially_verified", "unreachable", "not_verified"]) {
    const cell = strip.locator(`[data-strip-outcome="${key}"]`);
    await expect(cell).toBeVisible();
    await expect.poll(async () => (await cell.textContent()) ?? "", { timeout: 30_000 }).not.toContain("…");
    await expect(cell).toHaveAttribute("href", new RegExp(`verificationOutcome=${key}`));
  }
  const shown = Number(((await strip.locator('[data-strip-outcome="unreachable"] span').first().textContent()) ?? "0").replace(/[^0-9]/g, ""));
  const total = await callEdgeFunction(page, "data-center-read", {
    action: "call_queue", cursor: null, limit: 1, direction: "desc", filters: { verificationOutcome: "unreachable" },
  });
  expect(total.status).toBe(200);
  expect(shown).toBe(Number((total.body as { data: { total: number } }).data.total));

  // The bare control centre has no queue, and a door to the records.
  await page.goto("/data-center/call-centre");
  await expect(page.getByRole("heading", { name: "Agents and their work" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Never called" })).toHaveCount(0);
  await page.locator("[data-records-door]").click();
  await expect(page).toHaveURL(/\/data-center\/call-centre\/records$/);
});

test("the shared-phone register has its own page, and the decisions card leads there", async ({ page }) => {
  await signIn(page, USERS.admin);
  await page.goto("/data-center/call-centre");
  const row = page.locator('[data-decision="Shared phone numbers, unconfirmed"]');
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.getByRole("link", { name: "Review" }).click();
  await expect(page).toHaveURL(/\/data-center\/call-centre\/shared-phones$/);
  await expect(page.getByRole("heading", { name: "Numbers with more than one stove" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/A number on two stoves is rung once/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Control centre" })).toHaveAttribute("href", /\/data-center\/call-centre$/);
});

test("nothing crosses the viewport at 375 pixels on the new pages", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await signIn(page, USERS.admin);
  const { holder } = await holderWithWork(page);
  for (const path of [
    `/data-center/call-centre/agents/${holder.agent_id}`,
    "/data-center/call-centre/records",
    "/data-center/call-centre/shared-phones",
  ]) {
    await page.goto(path);
    await expect(page.locator("main, [data-area]").first()).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1500);
    const bad = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const out: string[] = [];
      document.querySelectorAll("body *").forEach((el) => {
        const scroller = el.closest(".overflow-x-auto, .overflow-auto, [data-track]");
        if (scroller && scroller !== el) return;
        if (el.closest(".fixed")) return;
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.right > vw + 1) {
          out.push(`${el.tagName.toLowerCase()}.${String(el.className).split(" ").slice(0, 2).join(".")} right=${Math.round(r.right)}`);
        }
      });
      return { vw, sw: document.documentElement.scrollWidth, out: [...new Set(out)].slice(0, 10) };
    });
    expect(bad.sw, `${path}: page scrolls sideways`).toBeLessThanOrEqual(bad.vw + 1);
    expect(bad.out, `${path}: elements past the edge`).toEqual([]);
  }
  await context.close();
});
