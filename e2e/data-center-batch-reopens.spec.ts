import { test, expect, type Browser, type Page } from "@playwright/test";
import { signIn, USERS, branchSql, callEdgeFunction } from "./helpers";

/**
 * Phase 28, slice 6 (D52): a reopened verdict reopens its batch.
 *
 *  - concluding every record of a batch closes it (the rule that exists)
 *  - editing one record back to not verified reopens the batch, keeps the
 *    record with its agent, and the board counts the batch as open again
 *  - concluding it again closes the batch again, through a verdict-only save
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

/** Undo what the specs made and let go of what batches still hold, so the pool refills. */
async function reset(admin: Page) {
  await branchSql(`delete from data_center.call_drafts`);
  await branchSql(`delete from data_center.call_attempts where note like '%spec%' or attempted_at > now() - interval '3 days'`);
  await branchSql(`update data_center.call_records set verification_outcome = 'not_verified' where updated_at > now() - interval '3 days'`);
  await branchSql(`update data_center.assignment_items i set is_active = false from data_center.assignment_batches b
    where b.id = i.batch_id and b.state in ('completed', 'open') and i.is_active`);
  await branchSql(`update data_center.assignment_batches set state = 'reclaimed', reclaimed_at = now(), reclaim_reason = 'batch-reopens spec reset' where state = 'open'`);
  await callEdgeFunction(admin, "data-center-assign", { action: "agents" });
}

test("a record edited back to not verified reopens its closed batch and stays with its agent", async ({ browser }) => {
  const admin = await pageFor(browser, USERS.admin);
  const agent = await pageFor(browser, USERS.callCentre);
  let { pool, agents } = await roster(admin);
  if (!pool.some((p) => p.callable >= 2)) {
    await reset(admin);
    ({ pool, agents } = await roster(admin));
  }
  const partner = pool.find((p) => p.callable >= 2);
  expect(partner, "a partner with two callable numbers").toBeTruthy();
  const me = agents.find((a) => a.email === USERS.callCentre)!;
  const made = await callEdgeFunction(admin, "data-center-assign", {
    action: "assign_manual", agentId: me.agent_id, organizationId: partner!.organization_id, size: 2, overrideReason: "batch-reopens spec",
  });
  expect(made.status, JSON.stringify(made.body)).toBe(200);
  const batchId = (made.body as { data: { batchId: string } }).data.batchId;
  const rows = await branchSql<{ sale_id: string }>(`select sale_id::text from data_center.assignment_items where batch_id = '${batchId}' and is_active order by position`);
  expect(rows.length).toBe(2);

  // Conclude both the way the form does: an attempt and the verdict.
  const [vRow] = await branchSql<{ id: string }>(`select id from data_center.option_values where list_key = 'call_outcome' and value = 'verified'`);
  for (const r of rows) {
    await branchSql(`insert into data_center.call_records (sale_id, created_by) values ('${r.sale_id}', '${me.agent_id}') on conflict (sale_id) do nothing`);
    await branchSql(`insert into data_center.call_attempts (sale_id, attempt_no, attempted_at, outcome_id, created_by, source)
      values ('${r.sale_id}', (select coalesce(max(attempt_no), 0) + 1 from data_center.call_attempts where sale_id = '${r.sale_id}'), now(), '${vRow.id}', '${me.agent_id}', 'form')`);
    await branchSql(`update data_center.call_records set verification_outcome = 'fully_verified', updated_by = '${me.agent_id}', updated_at = now() where sale_id = '${r.sale_id}'`);
  }
  const [closed] = await branchSql<{ state: string; completed_at: string | null }>(`select state, completed_at::text from data_center.assignment_batches where id = '${batchId}'`);
  expect(closed.state, "the batch closed itself").toBe("completed");
  expect(closed.completed_at).toBeTruthy();

  // One record goes back to not verified through the form's own save path.
  const reopened = rows[0].sale_id;
  const rec = await callEdgeFunction(agent, "data-center-write", { action: "call_record", saleId: reopened });
  expect(rec.status, JSON.stringify(rec.body)).toBe(200);
  const version = (rec.body as { data: { record: { version: number } } }).data.record.version;
  const saved = await callEdgeFunction(agent, "data-center-write", {
    action: "save_call_record", saleId: reopened, version, values: { verification_outcome: "not_verified" },
  });
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);

  const [after] = await branchSql<{ state: string; completed_at: string | null }>(`select state, completed_at::text from data_center.assignment_batches where id = '${batchId}'`);
  expect(after.state, "the batch reopened").toBe("open");
  expect(after.completed_at).toBeNull();
  const [item] = await branchSql<{ is_active: boolean }>(`select is_active from data_center.assignment_items where batch_id = '${batchId}' and sale_id = '${reopened}'`);
  expect(item.is_active, "the record stayed with its agent").toBe(true);

  // The agent sees it as a number to try again; the board counts the batch as open.
  const day = (await callEdgeFunction(agent, "data-center-assign", { action: "agent_day" })).body as { data: { to_call: { sale_id: string; standing: string }[] } };
  const held = day.data.to_call.find((x) => x.sale_id === reopened);
  expect(held).toBeTruthy();
  expect(held!.standing).toBe("in_progress");
  const board = (await callEdgeFunction(admin, "data-center-assign", { action: "board" })).body as { data: { agents: { agent_id: string; open_batches: number }[] } };
  expect(board.data.agents.find((a) => a.agent_id === me.agent_id)!.open_batches).toBeGreaterThanOrEqual(1);

  // Concluded again, by a verdict-only save, and the batch closes again.
  const rec2 = await callEdgeFunction(agent, "data-center-write", { action: "call_record", saleId: reopened });
  const version2 = (rec2.body as { data: { record: { version: number } } }).data.record.version;
  const saved2 = await callEdgeFunction(agent, "data-center-write", {
    action: "save_call_record", saleId: reopened, version: version2, values: { verification_outcome: "partially_verified" },
  });
  expect(saved2.status, JSON.stringify(saved2.body)).toBe(200);
  const [again] = await branchSql<{ state: string }>(`select state from data_center.assignment_batches where id = '${batchId}'`);
  expect(again.state, "the batch closed again").toBe("completed");
});

test("the migration's readback holds: no completed batch holds an unfinished record", async () => {
  const [row] = await branchSql<{ n: number }>(`
    select count(*)::int as n from data_center.assignment_batches b
     where b.state = 'completed'
       and exists (select 1 from data_center.assignment_items i
                     left join data_center.call_records cr on cr.sale_id = i.sale_id
                    where i.batch_id = b.id and i.is_active
                      and coalesce(cr.verification_outcome, 'not_verified') not in ('fully_verified', 'partially_verified', 'unreachable'))`);
  expect(row.n).toBe(0);
});
