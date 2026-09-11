import { test, expect, type Browser, type Page } from "@playwright/test";
import { signIn, USERS, branchSql, callEdgeFunction } from "./helpers";

/**
 * Phase 28, slice 4 (D46): the manager sees where a partner's records stand,
 * and the board opens an agent's row into per-partner counts.
 *
 *  - the hand-out dialog shows never called and in progress on each partner
 *    row, and the chosen partner's six-way bar equals v_partner_standing
 *  - the Partners page bar equals the view
 *  - the board row opens into per-partner counts that equal an oracle over
 *    the assignment log, and a count links to the records page narrowed
 *  - the board accepts a span (one cell per day), a month and a year (twelve
 *    month cells), the URL carries each, and the cells sum to the calls
 */
test.describe.configure({ timeout: 240_000 });

type Standing = { never_called: number; in_progress: number; verified: number; partially_verified: number; unreachable: number; with_sales: number; total: number };
const KEYS = ["never_called", "in_progress", "verified", "partially_verified", "unreachable", "with_sales"] as const;

async function pageFor(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, email);
  return page;
}

async function viewFor(orgId: string): Promise<Standing> {
  const [row] = await branchSql<Standing>(`
    select sum(never_called)::int as never_called, sum(in_progress)::int as in_progress,
           sum(verified)::int as verified, sum(partially_verified)::int as partially_verified,
           sum(unreachable)::int as unreachable, sum(with_sales)::int as with_sales, sum(total)::int as total
      from data_center.v_partner_standing where organization_id = '${orgId}'`);
  return row;
}

/** Put one callable record back in the pool so a partner has work waiting. */
async function ensureWaiting(admin: Page) {
  const s = await callEdgeFunction(admin, "data-center-assign", { action: "agents" });
  const pool = (s.body as { data: { pool: { organization_id: string; callable: number }[] } }).data.pool;
  if (pool.some((p) => p.callable > 0)) return;
  const [item] = await branchSql<{ sale_id: string }>(`
    select i.sale_id::text from data_center.assignment_items i
      join data_center.assignment_batches b on b.id = i.batch_id
      join data_center.v_call_center_resolved r on r.sale_id = i.sale_id
     where i.is_active and b.state = 'open' and r.standing in ('never_called', 'in_progress')
     order by case when r.standing = 'never_called' then 0 else 1 end limit 1`);
  if (item) {
    await callEdgeFunction(admin, "data-center-assign", { action: "unassign_item", saleId: item.sale_id });
    return;
  }
  // Nothing held and nothing callable: the specs concluded everything. Undo
  // what they did (their calls, drafts and verdicts, bounded to three days)
  // and let go of the items in the batches that closed.
  await branchSql(`delete from data_center.call_drafts`);
  await branchSql(`delete from data_center.call_attempts where attempted_at > now() - interval '3 days'`);
  await branchSql(`update data_center.call_records set verification_outcome = 'not_verified' where updated_at > now() - interval '3 days'`);
  await branchSql(`update data_center.assignment_items i set is_active = false from data_center.assignment_batches b
    where b.id = i.batch_id and b.state = 'completed' and i.is_active`);
  const again = await callEdgeFunction(admin, "data-center-assign", { action: "agents" });
  const after = (again.body as { data: { pool: { callable: number }[] } }).data.pool;
  expect(after.some((p) => p.callable > 0), "a partner with work after the reset").toBeTruthy();
}

/** The seeded call-centre editor holds at least one record, arranged if not. */
async function ensureHolding(admin: Page, agent: Page): Promise<string> {
  const r = await callEdgeFunction(agent, "data-center-assign", { action: "agent_day" });
  const day = (r.body as { data: { agent: { agent_id: string }; to_call: unknown[] } }).data;
  if (day.to_call.length > 0) return day.agent.agent_id;
  await ensureWaiting(admin);
  const s = await callEdgeFunction(admin, "data-center-assign", { action: "agents" });
  const pool = (s.body as { data: { pool: { organization_id: string; callable: number }[] } }).data.pool;
  const partner = pool.find((p) => p.callable > 0);
  expect(partner, "a partner with work to hand out").toBeTruthy();
  const made = await callEdgeFunction(admin, "data-center-assign", {
    action: "assign_manual", agentId: day.agent.agent_id, organizationId: partner!.organization_id, size: 2, overrideReason: "partner-standing spec",
  });
  expect(made.status, JSON.stringify(made.body)).toBe(200);
  return day.agent.agent_id;
}

test("the hand-out dialog shows each partner's standing and the chosen partner's bar equals the view", async ({ browser }) => {
  const admin = await pageFor(browser, USERS.admin);
  await ensureWaiting(admin);
  await admin.goto("/data-center/call-centre");
  await expect(admin.getByRole("heading", { name: "Agents and their work" })).toBeVisible({ timeout: 30_000 });
  await admin.getByRole("button", { name: "Hand out calls" }).click();
  const dialog = admin.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const row = dialog.locator("[data-partner-standing]").first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  const orgId = (await row.getAttribute("data-partner-standing"))!;
  const want = await viewFor(orgId);
  await expect(row.locator("[data-never-called]")).toHaveText(String(want.never_called));
  await expect(row.locator("[data-in-progress]")).toHaveText(String(want.in_progress));

  await row.locator("xpath=ancestor::button[1]").click();
  const panel = dialog.locator(`[data-partner-standing-panel="${orgId}"]`);
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await expect(panel.locator("[data-standing-bar]")).toHaveAttribute("data-standing-bar", String(want.total));
  for (const k of KEYS) {
    const cell = panel.locator(`[data-standing-cell="${k}"]`);
    if (want[k] === 0) await expect(cell).toHaveCount(0);
    else await expect(cell).toHaveAttribute("data-standing-count", String(want[k]));
  }
  await expect(panel.locator("[data-standing-legend]")).toBeVisible();
  await admin.keyboard.press("Escape");
});

test("the Partners page draws each partner's bar from the view", async ({ browser }) => {
  const admin = await pageFor(browser, USERS.admin);
  await ensureWaiting(admin);
  await admin.goto("/data-center/call-centre/partners");
  const cell = admin.locator("td[data-partner-standing]").first();
  await expect(cell).toBeVisible({ timeout: 30_000 });
  const orgId = (await cell.getAttribute("data-partner-standing"))!;
  const want = await viewFor(orgId);
  await expect(cell.locator("[data-standing-bar]")).toHaveAttribute("data-standing-bar", String(want.total));
  for (const k of KEYS) {
    if (want[k] > 0) await expect(cell.locator(`[data-standing-cell="${k}"]`)).toHaveAttribute("data-standing-count", String(want[k]));
  }
  await expect(admin.locator("[data-standing-legend]")).toHaveCount(1);
});

test("the board row opens into per-partner counts that match the assignment log, and a count is a door", async ({ browser }) => {
  const admin = await pageFor(browser, USERS.admin);
  const agent = await pageFor(browser, USERS.callCentre);
  const agentId = await ensureHolding(admin, agent);
  const want = await branchSql<{ organization_id: string; new: number; verified_partial: number; unreachable: number; with_sales: number; others: number }>(`
    select l.organization_id::text as organization_id,
           count(*) filter (where l.standing = 'never_called')::int as new,
           count(*) filter (where l.standing in ('verified', 'partially_verified'))::int as verified_partial,
           count(*) filter (where l.standing = 'unreachable')::int as unreachable,
           count(*) filter (where l.standing = 'with_sales')::int as with_sales,
           count(*) filter (where l.standing = 'in_progress')::int as others
      from data_center.v_assignment_log l
      join data_center.assignment_batches b on b.id = l.batch_id
     where l.is_active and l.agent_id = '${agentId}'
       and (l.batch_state = 'open' or (l.batch_state = 'completed' and b.completed_at > now() - interval '7 days'))
     group by 1`);
  expect(want.length).toBeGreaterThan(0);

  await admin.goto("/data-center/call-centre");
  const row = admin.locator(`[data-agent-row="${agentId}"]`);
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.getByRole("button", { name: /^What .* is holding$/ }).click();
  const held = admin.locator(`[data-held-by-partner="${agentId}"]`);
  await expect(held).toBeVisible({ timeout: 15_000 });
  for (const w of want) {
    const line = held.locator(`[data-held-partner="${w.organization_id}"]`);
    await expect(line).toBeVisible();
    for (const k of ["new", "verified_partial", "unreachable", "with_sales", "others"] as const) {
      await expect(line.locator(`[data-held-count="${k}"]`)).toHaveText(String(w[k]));
    }
  }
  const door = held.locator("[data-held-count] a").first();
  await expect(door).toBeVisible();
  await door.click();
  await expect(admin).toHaveURL(/call-centre\/records\?.*standing=/, { timeout: 30_000 });
  await expect(admin.getByText(/Narrowed to/)).toBeVisible({ timeout: 30_000 });
});

test("the board takes a span, a month and a year, and the cells add up", async ({ browser }) => {
  const admin = await pageFor(browser, USERS.admin);
  const [{ today }] = await branchSql<{ today: string }>(`
    select timezone(coalesce((select value #>> '{}' from data_center.workflow_config where key = 'call_centre.timezone'), 'Africa/Lagos'), now())::date::text as today`);
  const end = new Date(`${today}T00:00:00Z`);
  const start = new Date(end.getTime() - 9 * 86_400_000);
  const span = `${start.toISOString().slice(0, 10)}..${today}`;

  const s = await callEdgeFunction(admin, "data-center-assign", { action: "board", range: span });
  expect(s.status, JSON.stringify(s.body)).toBe(200);
  const sb = (s.body as { data: { range: string; grain: string; days: string[]; from: string; agents: { agent_id: string; called: number; days: { called: number }[] }[] } }).data;
  expect(sb.range).toBe("span");
  expect(sb.grain).toBe("day");
  expect(sb.days).toHaveLength(10);
  expect(sb.from).toBe(start.toISOString().slice(0, 10));
  for (const a of sb.agents) {
    expect(a.days).toHaveLength(10);
    expect(a.days.reduce((n, d) => n + d.called, 0)).toBe(a.called);
    const [o] = await branchSql<{ n: number }>(`
      with cfg as (select coalesce((select value #>> '{}' from data_center.workflow_config where key = 'call_centre.timezone'), 'Africa/Lagos') as tz)
      select count(*)::int as n from data_center.v_call_attempts_resolved x cross join cfg
       where x.agent_user_id = '${a.agent_id}'
         and timezone(cfg.tz, x.attempted_at)::date between '${sb.from}'::date and '${today}'::date`);
    expect(a.called, `calls in the span for ${a.agent_id}`).toBe(o.n);
  }

  const year = today.slice(0, 4);
  const y = await callEdgeFunction(admin, "data-center-assign", { action: "board", range: year });
  const yb = (y.body as { data: { range: string; grain: string; days: string[]; agents: { called: number; days: { called: number }[] }[] } }).data;
  expect(yb.range).toBe("year");
  expect(yb.grain).toBe("month");
  expect(yb.days).toHaveLength(12);
  for (const a of yb.agents) expect(a.days.reduce((n, d) => n + d.called, 0)).toBe(a.called);

  const tooLong = await callEdgeFunction(admin, "data-center-assign", { action: "board", range: `${year}-01-01..${today}` });
  const tl = (tooLong.body as { data: { days: string[] } }).data;
  expect(tl.days.length).toBeLessThanOrEqual(92);

  // The URL carries each form and the board draws the cells.
  await admin.goto(`/data-center/call-centre?range=${year}`);
  await expect(admin.locator('[data-period-cells="12"][data-grain="month"]').first()).toBeVisible({ timeout: 30_000 });
  // The router quotes a bare year so it does not read back as a number; both forms are the year.
  await expect(admin).toHaveURL(new RegExp(`range=(%22)?${year}(%22)?(&|$)`));
  const month = today.slice(0, 7);
  const daysInMonth = new Date(Date.UTC(Number(year), Number(month.slice(5)), 0)).getUTCDate();
  await admin.goto(`/data-center/call-centre?range=${month}`);
  await expect(admin.locator(`[data-period-cells="${daysInMonth}"][data-grain="day"]`).first()).toBeVisible({ timeout: 30_000 });
  await admin.goto(`/data-center/call-centre?range=${span}`);
  await expect(admin.locator('[data-period-cells="10"]').first()).toBeVisible({ timeout: 30_000 });
  await expect(admin.getByRole("button", { name: /^Pick a year$|^Year$/ }).or(admin.getByLabel("Pick a year"))).toBeVisible();
  // The agent page takes the same control.
  const first = await admin.locator("[data-agent-row]").first().getAttribute("data-agent-row");
  await admin.goto(`/data-center/call-centre/agents/${first}?range=${year}`);
  await expect(admin.locator('[data-period-cells="12"][data-grain="month"]')).toBeVisible({ timeout: 30_000 });
});
