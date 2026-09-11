import { test, expect, type Browser, type Page } from "@playwright/test";
import { signIn, USERS, branchSql, callEdgeFunction } from "./helpers";

/**
 * Phase 28, slice 5 (D49 to D51): New first, and worked records stay with
 * the agent.
 *
 *  - the picker hands out a partner's untried numbers before its tried ones,
 *    the registry offers "New numbers first", and the default order leads
 *    with it
 *  - a quiet batch releases only its untried record; the worked one stays
 *    with the agent and the batch stays open (D50)
 *  - the hand-out dialog's order defaults to New numbers first and the nudge
 *    under the preview says what the batch draws from
 *  - Reclaim's confirm says what would go back and what would stay
 */
test.describe.configure({ timeout: 240_000 });

async function pageFor(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, email);
  return page;
}

type Roster = { agents: { agent_id: string; email: string | null; open_batches: number; is_enabled: boolean }[]; pool: { organization_id: string; callable: number }[] };
async function roster(page: Page): Promise<Roster> {
  const s = await callEdgeFunction(page, "data-center-assign", { action: "agents" });
  expect(s.status, JSON.stringify(s.body)).toBe(200);
  return (s.body as { data: Roster }).data;
}

/** Undo what the specs made and let go of what closed batches still hold, so the pool refills. */
async function reset(admin: Page) {
  await branchSql(`delete from data_center.call_drafts`);
  await branchSql(`delete from data_center.call_attempts where note like '%spec%' or attempted_at > now() - interval '3 days'`);
  await branchSql(`update data_center.call_records set verification_outcome = 'not_verified' where updated_at > now() - interval '3 days'`);
  await branchSql(`update data_center.assignment_items i set is_active = false from data_center.assignment_batches b
    where b.id = i.batch_id and b.state in ('completed', 'open') and i.is_active`);
  await branchSql(`update data_center.assignment_batches set state = 'reclaimed', reclaimed_at = now(), reclaim_reason = 'new-first spec reset' where state = 'open'`);
  await callEdgeFunction(admin, "data-center-assign", { action: "agents" });
}

/**
 * A partner with at least one untried and one tried callable number. The
 * tried one is given a call four days ago, which keeps it callable (the
 * recall window is two days) while marking it as worked.
 */
async function partnerWithBoth(admin: Page): Promise<{ orgId: string; tried: string; untried: string[] }> {
  let { pool } = await roster(admin);
  if (!pool.some((p) => p.callable >= 2)) {
    await reset(admin);
    ({ pool } = await roster(admin));
  }
  const partner = pool.find((p) => p.callable >= 2);
  expect(partner, "a partner with two callable numbers").toBeTruthy();
  const rows = await branchSql<{ sale_id: string; attempt_count: number }>(
    `select sale_id::text, attempt_count from data_center.v_callable_records where organization_id = '${partner!.organization_id}' order by attempt_count desc, sale_id`,
  );
  let tried = rows.find((r) => r.attempt_count > 0)?.sale_id;
  if (!tried) {
    tried = rows[0].sale_id;
    await branchSql(`insert into data_center.call_records (sale_id) values ('${tried}') on conflict (sale_id) do nothing`);
    await branchSql(`insert into data_center.call_attempts (sale_id, attempt_no, attempted_at, note, source)
      values ('${tried}', (select coalesce(max(attempt_no), 0) + 1 from data_center.call_attempts where sale_id = '${tried}'), now() - interval '4 days', 'new-first spec: tried', 'form')`);
  }
  const untried = rows.filter((r) => r.sale_id !== tried && r.attempt_count === 0).map((r) => r.sale_id);
  expect(untried.length, "an untried number beside the tried one").toBeGreaterThan(0);
  return { orgId: partner!.organization_id, tried, untried };
}

test("the picker hands out untried numbers first, by the configured default", async ({ browser }) => {
  const admin = await pageFor(browser, USERS.admin);
  const [cfg] = await branchSql<{ first: string; label: string }>(`
    select (value -> 'order' ->> 0) as first,
           (select label from data_center.option_values where list_key = 'assignment_priority' and value = 'never_called' and is_active) as label
      from data_center.workflow_config where key = 'assignment.priority'`);
  expect(cfg.first).toBe("never_called");
  expect(cfg.label).toBe("New numbers first");

  const { orgId, tried } = await partnerWithBoth(admin);
  const { agents } = await roster(admin);
  const agent = agents.find((a) => a.is_enabled)!;
  const p = await callEdgeFunction(admin, "data-center-assign", { action: "assign_preview", agentId: agent.agent_id, organizationId: orgId, size: 50 });
  expect(p.status, JSON.stringify(p.body)).toBe(200);
  const d = (p.body as { data: { rows: { sale_id: string; attempt_count: number }[]; poolUntried: number; poolTried: number; untriedInBatch: number } }).data;
  const firstTried = d.rows.findIndex((r) => r.attempt_count > 0);
  const lastUntried = d.rows.map((r) => r.attempt_count).lastIndexOf(0);
  expect(firstTried, "a tried number is in the preview").toBeGreaterThan(-1);
  expect(lastUntried, "every untried number sits before the first tried one").toBeLessThan(firstTried);
  expect(d.rows.map((r) => r.sale_id)).toContain(tried);
  expect(d.poolUntried).toBeGreaterThan(0);
  expect(d.poolTried).toBeGreaterThan(0);
  expect(d.untriedInBatch).toBe(lastUntried + 1);

  // The manager may still choose another order, and the picker obeys it.
  const q = await callEdgeFunction(admin, "data-center-assign", { action: "assign_preview", agentId: agent.agent_id, organizationId: orgId, size: 50, order: ["recall_due", "newest_digitised"] });
  expect(q.status).toBe(200);
});

test("a quiet batch lets go of its untried number and keeps the worked one with the agent", async ({ browser }) => {
  const admin = await pageFor(browser, USERS.admin);
  const agent = await pageFor(browser, USERS.callCentre);
  const { orgId } = await partnerWithBoth(admin);
  const me = (await roster(admin)).agents.find((a) => a.email === USERS.callCentre)!;
  const made = await callEdgeFunction(admin, "data-center-assign", { action: "assign_manual", agentId: me.agent_id, organizationId: orgId, size: 2, overrideReason: "new-first spec" });
  expect(made.status, JSON.stringify(made.body)).toBe(200);
  const batchId = (made.body as { data: { batchId?: string; batch_id?: string } }).data.batchId ?? (made.body as { data: { batch_id: string } }).data.batch_id;
  const items = await branchSql<{ sale_id: string; tries: number }>(
    `select i.sale_id::text, coalesce(cr.attempt_count, 0) as tries from data_center.assignment_items i left join data_center.call_records cr on cr.sale_id = i.sale_id where i.batch_id = '${batchId}' and i.is_active order by tries desc`,
  );
  expect(items.length).toBe(2);
  let worked = items.find((i) => i.tries > 0)?.sale_id;
  if (!worked) {
    // Both untried: the agent logs one call on the first, which makes it worked.
    worked = items[0].sale_id;
    const logged = await callEdgeFunction(agent, "data-center-write", { action: "log_attempt", saleId: worked, note: "new-first spec: worked" });
    expect(logged.status, JSON.stringify(logged.body)).toBe(200);
  }
  const untried = items.find((i) => i.sale_id !== worked && i.tries === 0)!.sale_id;
  expect(untried, "an untried record beside the worked one").toBeTruthy();
  await branchSql(`update data_center.assignment_batches set last_activity_at = now() - interval '10 days' where id = '${batchId}'`);

  const preview = await callEdgeFunction(admin, "data-center-assign", { action: "reclaim_preview" });
  const pv = (preview.body as { data: { batches: number; untried: number; worked: number } }).data;
  expect(pv.batches).toBeGreaterThanOrEqual(1);
  expect(pv.untried).toBeGreaterThanOrEqual(1);
  expect(pv.worked).toBeGreaterThanOrEqual(1);

  const r = await callEdgeFunction(admin, "data-center-assign", { action: "reclaim" });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  const after = await branchSql<{ sale_id: string; is_active: boolean; state: string }>(
    `select i.sale_id::text, i.is_active, b.state from data_center.assignment_items i join data_center.assignment_batches b on b.id = i.batch_id where i.batch_id = '${batchId}'`,
  );
  expect(after.find((x) => x.sale_id === untried)!.is_active, "the untried number went back").toBe(false);
  expect(after.find((x) => x.sale_id === worked)!.is_active, "the worked record stayed").toBe(true);
  expect(after[0].state, "the batch stays open with its worked record").toBe("open");
  // The agent still sees the worked record, under callbacks.
  const day = (await callEdgeFunction(agent, "data-center-assign", { action: "agent_day" })).body as { data: { to_call: { sale_id: string; standing: string }[] } };
  const held = day.data.to_call.find((x) => x.sale_id === worked);
  expect(held, "the worked record is still in the agent's hands").toBeTruthy();
  expect(day.data.to_call.find((x) => x.sale_id === untried)).toBeUndefined();
});

test("the hand-out dialog leads with New numbers first and says what the batch draws from", async ({ browser }) => {
  const admin = await pageFor(browser, USERS.admin);
  await partnerWithBoth(admin);
  await admin.goto("/data-center/call-centre");
  await expect(admin.getByRole("heading", { name: "Agents and their work" })).toBeVisible({ timeout: 30_000 });
  await admin.getByRole("button", { name: "Hand out calls" }).click();
  const dialog = admin.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const order = dialog.getByRole("combobox", { name: "Hand-out order" });
  await expect(order).toHaveValue("never_called");
  await expect(order.locator("option[value=never_called]")).toHaveText("New numbers first");
  const who = dialog.getByRole("combobox", { name: "Who takes it" });
  await who.selectOption({ index: 1 });
  await dialog.locator("[data-partner-standing]").first().locator("xpath=ancestor::button[1]").click();
  const nudge = dialog.locator("[data-handout-nudge]");
  await expect(nudge).toBeVisible({ timeout: 30_000 });
  await expect(nudge).toContainText(/New numbers first: \d+ of this partner's \d+ untried/);
  await expect(dialog.locator("[data-assign-preview] tbody td").filter({ hasText: /^new$/ }).first()).toBeVisible();
  // Another order says what it puts ahead.
  await order.selectOption("newest_digitised");
  await expect(nudge).toContainText(/Newest digitised first/, { timeout: 15_000 });
  await admin.keyboard.press("Escape");
});

test("Reclaim's confirm says what goes back and what stays", async ({ browser }) => {
  const admin = await pageFor(browser, USERS.admin);
  await admin.goto("/data-center/call-centre");
  await expect(admin.getByRole("heading", { name: "Agents and their work" })).toBeVisible({ timeout: 30_000 });
  await admin.locator("#agents-panel").getByRole("button", { name: "Reclaim quiet batches" }).click();
  const dialog = admin.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(/untried number.*back to the pool.*already worked/s, { timeout: 15_000 });
  await dialog.getByRole("button", { name: "Not now" }).click();
});
