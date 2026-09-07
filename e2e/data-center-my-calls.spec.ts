import { test, expect, type Browser, type Page } from "@playwright/test";
import { signIn, USERS, branchSql, callEdgeFunction } from "./helpers";

/**
 * Phase 26, C4: My calls, on the call form that exists.
 *
 *  - an agent who opens the call centre lands on My calls
 *  - the queue names the next record and every number copies for the call
 *    app, whose name comes from configuration (D36)
 *  - the call form carries copy fields in its header, a callback time beside
 *    a callback outcome, and after Save offers the next record
 *  - nothing dials: no tel: link anywhere on the surface
 */
test.describe.configure({ timeout: 240_000 });

async function pageFor(browser: Browser, email: string, clipboard = false): Promise<Page> {
  const context = await browser.newContext(clipboard ? { permissions: ["clipboard-read", "clipboard-write"] } : {});
  const page = await context.newPage();
  await signIn(page, email);
  return page;
}

/** The seeded call-centre editor holds an open batch, arranged by the admin if not. */
async function ensureWork(admin: Page, agent: Page) {
  const r = await callEdgeFunction(agent, "data-center-assign", { action: "agent_day" });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  let day = (r.body as { data: { agent: { agent_id: string }; to_call: { sale_id: string; stove_serial_no: string; phone: string | null }[] } }).data;
  if (day.to_call.length < 2) {
    const s = await callEdgeFunction(admin, "data-center-assign", { action: "agents" });
    const { agents, pool } = (s.body as { data: { agents: { agent_id: string; open_batches: number }[]; pool: { organization_id: string; callable: number }[] } }).data;
    let partner = pool.find((p) => p.callable >= 2);
    if (!partner) {
      const holder = agents.find((a) => a.open_batches > 0 && a.agent_id !== day.agent.agent_id)!;
      const held = await callEdgeFunction(admin, "data-center-assign", { action: "agent_detail", agentId: holder.agent_id });
      const items = (held.body as { data: { items: { sale_id: string }[] } }).data.items;
      for (const it of items.slice(0, 2)) await callEdgeFunction(admin, "data-center-assign", { action: "unassign_item", saleId: it.sale_id });
      const again = await callEdgeFunction(admin, "data-center-assign", { action: "agents" });
      partner = (again.body as { data: { pool: typeof pool } }).data.pool.find((p) => p.callable >= 1);
    }
    expect(partner, "a partner with work to hand out").toBeTruthy();
    const made = await callEdgeFunction(admin, "data-center-assign", {
      action: "assign_manual", agentId: day.agent.agent_id, organizationId: partner!.organization_id, size: 2, overrideReason: "my-calls spec",
    });
    expect(made.status, JSON.stringify(made.body)).toBe(200);
    const r2 = await callEdgeFunction(agent, "data-center-assign", { action: "agent_day" });
    day = (r2.body as typeof r).data as typeof day;
  }
  expect(day.to_call.length).toBeGreaterThan(0);
  return day;
}

test("an agent lands on My calls, sees the next record, and copies the number for the call app", async ({ browser }) => {
  const admin = await pageFor(browser, USERS.admin);
  const agent = await pageFor(browser, USERS.callCentre, true);
  const day = await ensureWork(admin, agent);
  const [cfg] = await branchSql<{ name: string }>(`select value #>> '{}' as name from data_center.workflow_config where key = 'call_centre.dialler_name'`);
  expect(cfg?.name, "the dialler name is configured on the branch").toBeTruthy();

  await agent.goto("/data-center/call-centre");
  await expect(agent).toHaveURL(/\/data-center\/my-calls/, { timeout: 30_000 });
  await expect(agent.locator("[data-my-calls]")).toBeVisible({ timeout: 30_000 });
  const next = agent.locator("[data-my-next]");
  await expect(next).toBeVisible({ timeout: 30_000 });
  await expect(agent.locator('[data-my-figure="to call"]')).toContainText(String(day.to_call.length));
  // Every record in hand is on the page, once.
  for (const it of day.to_call) {
    await expect(agent.getByText(it.stove_serial_no, { exact: true }).first()).toBeVisible();
  }
  // Nothing dials.
  expect(await agent.locator('a[href^="tel:"]').count()).toBe(0);

  // Copy: the button turns Copied and names the call app; the clipboard holds the number.
  const field = next.locator("[data-copy-field]").first();
  const shown = (await field.locator("[data-copy-value]").textContent())!.trim();
  await field.getByRole("button", { name: /^Copy phone/ }).click();
  await expect(field.getByRole("button", { name: /^Copy phone/ })).toHaveText(/Copied/);
  await expect(field.getByRole("status")).toContainText(cfg.name);
  const clip = await agent.evaluate(() => navigator.clipboard.readText());
  expect(clip).toBe(shown);
});

test("the call form copies, takes a callback time, and after Save offers the next record", async ({ browser }) => {
  const admin = await pageFor(browser, USERS.admin);
  const agent = await pageFor(browser, USERS.callCentre, true);
  const day = await ensureWork(admin, agent);
  const first = day.to_call[0];

  await agent.goto("/data-center/my-calls");
  await expect(agent.locator("[data-my-next]")).toBeVisible({ timeout: 30_000 });
  await agent.getByRole("button", { name: "Open the call form" }).click();
  const dialog = agent.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await expect(dialog.locator("[data-copy-numbers] [data-copy-field]").first()).toBeVisible({ timeout: 30_000 });

  // A callback outcome opens the time; the quick chip fills it; Log call stores it.
  const [cb] = await branchSql<{ id: string; label: string }>(`select id, label from data_center.option_values where list_key = 'call_outcome' and value = 'callback_requested'`);
  const outcome = dialog.getByRole("combobox", { name: "Outcome of this call" });
  await outcome.click();
  await agent.getByRole("option", { name: cb.label }).click();
  const timeBox = dialog.locator("[data-callback-time]");
  await expect(timeBox).toBeVisible();
  await timeBox.getByRole("button", { name: "in 1 hour" }).click();
  await expect(dialog.locator("#dc-callback-at")).not.toHaveValue("");
  const saleOnForm = await dialog.locator("[data-copy-numbers] [data-copy-value]").last().textContent();
  await dialog.getByRole("button", { name: "Log call" }).click();
  await expect(dialog.getByText("Call logged.")).toBeVisible({ timeout: 15_000 });
  const [logged] = await branchSql<{ callback_at: string | null; sale_id: string }>(
    `select a.callback_at::text, a.sale_id::text from data_center.call_attempts a
      join public.sales s on s.id = a.sale_id
     where s.stove_serial_no = '${(saleOnForm ?? "").trim()}' order by a.attempted_at desc limit 1`,
  );
  expect(logged?.callback_at, "the callback time reached the attempt").toBeTruthy();

  // Save offers the next record; Next record opens it in the same dialog.
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  const handoff = dialog.locator("[data-handoff]");
  await expect(handoff).toBeVisible({ timeout: 15_000 });
  await expect(handoff).toContainText("Saved");
  if (day.to_call.length > 1) {
    await expect(handoff).toContainText("Next for you");
    await handoff.getByRole("button", { name: "Next record" }).click();
    await expect(dialog.locator("[data-copy-numbers] [data-copy-value]").last()).not.toHaveText(first.stove_serial_no, { timeout: 15_000 });
  } else {
    await expect(handoff).toContainText("last record assigned to you");
  }
  await expect(handoff.getByRole("link", { name: "See all assigned" })).toHaveAttribute("href", /\/data-center\/my-calls/);
});

test("nothing crosses the viewport at 375 pixels on My calls", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await signIn(page, USERS.callCentre);
  await page.goto("/data-center/my-calls");
  await expect(page.locator("[data-my-calls]")).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  const bad = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const out: string[] = [];
    document.querySelectorAll("body *").forEach((el) => {
      const scroller = el.closest(".overflow-x-auto, .overflow-auto");
      if (scroller && scroller !== el) return;
      if (el.closest(".fixed")) return;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > vw + 1) out.push(`${el.tagName.toLowerCase()}.${String(el.className).split(" ").slice(0, 2).join(".")} right=${Math.round(r.right)}`);
    });
    return { vw, sw: document.documentElement.scrollWidth, out: [...new Set(out)].slice(0, 10) };
  });
  expect(bad.sw).toBeLessThanOrEqual(bad.vw + 1);
  expect(bad.out).toEqual([]);
  await context.close();
});
