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
 *
 * Phase 28, D45: My calls on New.
 *
 *  - New is open on first load and stays out of the URL; another view rides
 *    in `view`
 *  - a record saved as partly verified leaves New and appears under Partly
 *    verified
 *  - the counts strip equals an SQL oracle over `v_call_attempts_resolved`
 *    by outcome for the day, plus send-backs the agent opened; All is the sum
 *  - at 375 the folded views sit under More
 */
test.describe.configure({ timeout: 240_000 });

async function pageFor(browser: Browser, email: string, clipboard = false): Promise<Page> {
  const context = await browser.newContext(clipboard ? { permissions: ["clipboard-read", "clipboard-write"] } : {});
  const page = await context.newPage();
  await signIn(page, email);
  return page;
}

type Roster = { agents: { agent_id: string; open_batches: number }[]; pool: { organization_id: string; callable: number }[] };
async function agentsAndPool(page: Page): Promise<Roster> {
  const s = await callEdgeFunction(page, "data-center-assign", { action: "agents" });
  expect(s.status, JSON.stringify(s.body)).toBe(200);
  return (s.body as { data: Roster }).data;
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

/** The seeded call-centre editor holds an open batch, arranged by the admin if not. */
async function ensureWork(admin: Page, agent: Page) {
  const r = await callEdgeFunction(agent, "data-center-assign", { action: "agent_day" });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  let day = (r.body as { data: { agent: { agent_id: string }; to_call: { sale_id: string; stove_serial_no: string; phone: string | null; standing: string }[] } }).data;
  if (day.to_call.length < 2) {
    let { agents, pool } = await agentsAndPool(admin);
    let partner = pool.find((p) => p.callable >= 2) ?? pool.find((p) => p.callable >= 1);
    if (!partner) {
      const holder = agents.find((a) => a.open_batches > 0 && a.agent_id !== day.agent.agent_id);
      if (holder) {
        const held = await callEdgeFunction(admin, "data-center-assign", { action: "agent_detail", agentId: holder.agent_id });
        const items = (held.body as { data: { items: { sale_id: string }[] } }).data.items;
        for (const it of items.slice(0, 2)) await callEdgeFunction(admin, "data-center-assign", { action: "unassign_item", saleId: it.sale_id });
      } else {
        await replenish(admin);
      }
      ({ agents, pool } = await agentsAndPool(admin));
      partner = pool.find((p) => p.callable >= 1);
      if (!partner) {
        await replenish(admin);
        ({ agents, pool } = await agentsAndPool(admin));
        partner = pool.find((p) => p.callable >= 1);
      }
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
  // Phase 28, D45: New is the working surface, so "to call" counts the New
  // records and the page lists those; the concluded ones sit in other views.
  const fresh = day.to_call.filter((it) => it.standing === "never_called");
  await expect(agent.locator('[data-my-figure="to call"]')).toContainText(String(fresh.length));
  await expect(agent.locator('[data-my-view="new"]')).toHaveAttribute("aria-pressed", "true");
  await expect(agent).not.toHaveURL(/view=/);
  for (const it of fresh) {
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

  await agent.goto("/data-center/my-calls");
  await expect(agent.locator("[data-my-next]")).toBeVisible({ timeout: 30_000 });
  await agent.getByRole("button", { name: "Open the call form" }).click();
  const dialog = agent.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await expect(dialog.locator("[data-copy-numbers] [data-copy-field]").first()).toBeVisible({ timeout: 30_000 });

  // A callback outcome opens the time; the quick chip fills it; Save call stores it (D42).
  const [cb] = await branchSql<{ id: string; label: string }>(`select id, label from data_center.option_values where list_key = 'call_outcome' and value = 'callback_requested'`);
  const outcome = dialog.getByRole("combobox", { name: "Outcome of this call" });
  await outcome.click();
  await agent.getByRole("option", { name: cb.label }).click();
  const timeBox = dialog.locator("[data-callback-time]");
  await expect(timeBox).toBeVisible();
  await timeBox.getByRole("button", { name: "in 1 hour" }).click();
  await expect(dialog.locator("#dc-callback-at")).not.toHaveValue("");
  const saleOnForm = await dialog.locator("[data-copy-numbers] [data-copy-value]").last().textContent();
  await dialog.locator('[data-save-call="footer"]').click();
  await expect(dialog.getByText("Call saved.", { exact: true })).toBeVisible({ timeout: 15_000 });
  const [logged] = await branchSql<{ callback_at: string | null; sale_id: string }>(
    `select a.callback_at::text, a.sale_id::text from data_center.call_attempts a
      join public.sales s on s.id = a.sale_id
     where s.stove_serial_no = '${(saleOnForm ?? "").trim()}' order by a.attempted_at desc limit 1`,
  );
  expect(logged?.callback_at, "the callback time reached the attempt").toBeTruthy();

  // The save offered the next record; Next record opens it in the same dialog.
  const handoff = dialog.locator("[data-handoff]");
  await expect(handoff).toBeVisible({ timeout: 15_000 });
  await expect(handoff).toContainText("Saved");
  await expect(handoff.getByRole("link", { name: "See all assigned" })).toHaveAttribute("href", /\/data-center\/my-calls/);
  if (day.to_call.length > 1) {
    await expect(handoff).toContainText("Next for you");
    await handoff.getByRole("button", { name: "Next record" }).click();
    await expect(dialog.locator("[data-copy-numbers] [data-copy-value]").last()).not.toHaveText((saleOnForm ?? "").trim(), { timeout: 15_000 });
  } else {
    await expect(handoff).toContainText("last record assigned to you");
  }
});

/** The counts the strip should show for today, by the D45 rule, straight from SQL. */
async function oracleToday(agentId: string) {
  const [row] = await branchSql<{ verified: number; partially_verified: number; unreachable: number; others: number; with_sales: number }>(`
    with cfg as (
      select coalesce((select value #>> '{}' from data_center.workflow_config where key = 'call_centre.timezone'), 'Africa/Lagos') as tz
    ),
    calls as (
      select o.value as outcome
        from data_center.v_call_attempts_resolved x
        cross join cfg
        left join data_center.option_values o on o.id = x.outcome_id
       where x.agent_user_id = '${agentId}'
         and timezone(cfg.tz, x.attempted_at)::date = timezone(cfg.tz, now())::date
    )
    select count(*) filter (where outcome = 'verified')::int as verified,
           count(*) filter (where outcome = 'partially_verified')::int as partially_verified,
           count(*) filter (where outcome = 'unreachable')::int as unreachable,
           count(*) filter (where outcome is null or outcome not in ('verified', 'partially_verified', 'unreachable'))::int as others,
           (select count(*)::int from data_center.corrections c cross join cfg
             where c.opened_by = '${agentId}'
               and timezone(cfg.tz, c.opened_at)::date = timezone(cfg.tz, now())::date) as with_sales
      from calls`);
  return row;
}

test("a record saved as partly verified leaves New, lands under Partly verified, and the counts match SQL", async ({ browser }) => {
  const admin = await pageFor(browser, USERS.admin);
  const agent = await pageFor(browser, USERS.callCentre);
  const day = await ensureWork(admin, agent);
  const fresh = day.to_call.filter((it) => it.standing === "never_called");
  expect(fresh.length, "a New record to conclude").toBeGreaterThan(0);

  await agent.goto("/data-center/my-calls");
  await expect(agent.locator("[data-my-next]")).toBeVisible({ timeout: 30_000 });
  const saleId = (await agent.locator("[data-my-next]").getAttribute("data-my-next"))!;
  expect(fresh.map((f) => f.sale_id)).toContain(saleId);

  // Save call with the Partly verified outcome (D42, D43).
  await agent.getByRole("button", { name: "Open the call form" }).click();
  const dialog = agent.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  const [pv] = await branchSql<{ label: string }>(`select label from data_center.option_values where list_key = 'call_outcome' and value = 'partially_verified'`);
  await dialog.getByRole("combobox", { name: "Outcome of this call" }).click();
  await agent.getByRole("option", { name: pv.label }).click();
  await dialog.locator('[data-save-call="footer"]').click();
  await expect(dialog.getByText("Call saved.", { exact: true })).toBeVisible({ timeout: 15_000 });
  await agent.keyboard.press("Escape");

  // Gone from New, present under Partly verified, and the URL says so.
  await agent.goto("/data-center/my-calls");
  await expect(agent.locator("[data-my-views]")).toBeVisible({ timeout: 30_000 });
  await expect(agent.locator(`[data-my-next="${saleId}"], [data-my-row="${saleId}"]`)).toHaveCount(0);
  await agent.locator('[data-my-view="partially_verified"]').first().click();
  await expect(agent).toHaveURL(/view=partially_verified/);
  await expect(agent.locator(`[data-my-row="${saleId}"]`)).toBeVisible({ timeout: 15_000 });
  await agent.locator('[data-my-view="new"]').first().click();
  await expect(agent).not.toHaveURL(/view=/);

  // The strip equals SQL for today, and All is the sum.
  const want = await oracleToday(day.agent.agent_id);
  expect(want.partially_verified).toBeGreaterThan(0);
  const cell = (k: string) => agent.locator(`[data-my-count="today-${k}"]`);
  for (const k of ["verified", "partially_verified", "unreachable", "with_sales", "others"] as const) {
    await expect(cell(k)).toHaveText(String(want[k]), { timeout: 15_000 });
  }
  const all = want.verified + want.partially_verified + want.unreachable + want.with_sales + want.others;
  await expect(cell("all")).toHaveText(String(all));
});

test("at 375 the folded views sit under More", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await signIn(page, USERS.callCentre);
  await page.goto("/data-center/my-calls");
  await expect(page.locator("[data-my-views]")).toBeVisible({ timeout: 30_000 });
  for (const k of ["new", "verified", "partially_verified", "unreachable", "with_sales"]) {
    await expect(page.locator(`[data-my-view="${k}"]`).first()).toBeVisible();
  }
  await expect(page.locator('[data-my-view="others"]')).toBeHidden();
  await expect(page.locator('[data-my-view="all"]')).toBeHidden();
  await page.locator("[data-my-more]").click();
  const menu = page.locator("[data-my-more-menu]");
  await expect(menu.locator('[data-my-view="others"]')).toBeVisible();
  await expect(menu.locator('[data-my-view="all"]')).toBeVisible();
  await menu.locator('[data-my-view="all"]').click();
  await expect(page).toHaveURL(/view=all/);
  await expect(page.locator("[data-my-more]")).toHaveText(/All/);
  await context.close();
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
