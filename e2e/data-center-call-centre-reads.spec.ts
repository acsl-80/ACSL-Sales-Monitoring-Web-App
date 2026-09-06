import { test, expect, type Page } from "@playwright/test";
import { signIn, USERS, branchSql, callEdgeFunction } from "./helpers";

/**
 * Phase 26, C1: the reads behind the call centre's two surfaces, and the
 * hand-out preview. Nothing here renders; each read is checked against a SQL
 * oracle on the branch database, and each gate against the seeded roles.
 *
 * The identity rule (his word, 2026-09-07, D35): a call is counted against the
 * login that logged it (`call_attempts.created_by`), never against the
 * registry's "agent" dropdown, which stays for imported sheets.
 *
 *  - board          one day, every agent: marks per call, flags per hand-out,
 *                   called, verified, to call. assignment.manage.
 *  - agent_day      one agent: the same, plus To call and Called lists.
 *                   Self always; another agent needs assignment.manage.
 *  - pool_partners  the pool by partner, paged, with who is on it.
 *  - activity       the feed: calls, hand-outs, reclaims, send-backs, reviews,
 *                   filtered and paged, with an hourly histogram.
 *  - assign_preview the rows the picker would hand out, and no batch made.
 */

test.describe.configure({ timeout: 240_000 });

type Body = Record<string, unknown>;
type Agent = { agent_id: string; email: string; open_batches: number; is_enabled: boolean };
type Partner = { organization_id: string; callable: number };
type Batch = {
  batch_id: string;
  organization_id: string;
  items: { sale_id: string; stove_serial_no: string; position: number; batch_state: string }[];
};

async function assign(page: Page, body: Body) {
  return callEdgeFunction(page, "data-center-assign", body);
}
function data<T>(r: { status: number; body: unknown }): T {
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return (r.body as { data: T }).data;
}
async function agentsAndPool(page: Page) {
  return data<{ agents: Agent[]; pool: Partner[] }>(await assign(page, { action: "agents" }));
}

/** The seeded call-centre editor, their id, and a batch in their hands. */
async function callCentreWithWork(page: Page) {
  await signIn(page, USERS.admin);
  const { agents, pool } = await agentsAndPool(page);
  const me = agents.find((a) => a.email === USERS.callCentre);
  expect(me, "the seeded call-centre editor is an agent on the branch").toBeTruthy();
  let batches = await myBatchesOf(page, USERS.callCentre);
  if (batches.every((b) => b.items.every((i) => i.batch_state !== "open"))) {
    await signIn(page, USERS.admin);
    let partner = pool.find((p) => p.callable > 0);
    if (!partner) {
      // Global setup hands out everything; take one record back to have a pool.
      const holder = agents.find((a) => a.open_batches > 0 && a.agent_id !== me!.agent_id);
      expect(holder, "somebody holding a batch").toBeTruthy();
      const held = data<{ items: { sale_id: string }[] }>(
        await assign(page, { action: "agent_detail", agentId: holder!.agent_id }),
      );
      await assign(page, { action: "unassign_item", saleId: held.items[0].sale_id });
      partner = (await agentsAndPool(page)).pool.find((p) => p.callable > 0);
    }
    expect(partner, "a partner with callable records").toBeTruthy();
    const made = await assign(page, {
      action: "assign_manual",
      agentId: me!.agent_id,
      organizationId: partner!.organization_id,
      size: 1,
      overrideReason: "call-centre reads spec",
    });
    expect(made.status, JSON.stringify(made.body)).toBe(200);
    batches = await myBatchesOf(page, USERS.callCentre);
  }
  const open = batches.find((b) => b.items.some((i) => i.batch_state === "open"))!;
  return { me: me!, batch: open };
}

async function myBatchesOf(page: Page, email: string): Promise<Batch[]> {
  await signIn(page, email);
  return data<{ batches: Batch[] }>(await assign(page, { action: "my_batches" })).batches;
}

const tzDay = async () =>
  (
    await branchSql<{ d: string }>(
      `select timezone(coalesce((select value #>> '{}' from data_center.workflow_config
                                  where key = 'call_centre.timezone'), 'Africa/Lagos'), now())::date::text as d`,
    )
  )[0].d;

test("the board and the agent's day count a call against the login that logged it", async ({ page }) => {
  const { me, batch } = await callCentreWithWork(page);
  const sale = batch.items.find((i) => i.batch_state === "open")!;

  // The call-centre editor logs one call, as themselves.
  await signIn(page, USERS.callCentre);
  const outcome = await branchSql<{ id: string }>(
    `select id from data_center.option_values where list_key = 'call_outcome' and value = 'callback_requested'`,
  );
  const logged = await callEdgeFunction(page, "data-center-write", {
    action: "log_attempt",
    saleId: sale.sale_id,
    outcomeId: outcome[0].id,
    note: "call-centre reads spec",
  });
  expect(logged.status, JSON.stringify(logged.body)).toBe(200);

  // Self: agent_day needs no manage permission.
  const mine = data<{
    agent: { agent_id: string };
    marks: { at: string; sale_id: string; family: string; outcome_value: string }[];
    called: number;
    to_call: { sale_id: string; position: number }[];
    concluded: { sale_id: string; outcome_value: string | null }[];
  }>(await assign(page, { action: "agent_day" }));
  expect(mine.agent.agent_id).toBe(me.agent_id);
  expect(mine.marks.some((m) => m.sale_id === sale.sale_id && m.family === "callback")).toBe(true);
  expect(mine.to_call.map((r) => r.sale_id)).toContain(sale.sale_id);

  const day = await tzDay();
  const [oracle] = await branchSql<{ n: number }>(
    `select count(*)::int as n from data_center.call_attempts a
      where a.created_by = '${me.agent_id}'
        and timezone(coalesce((select value #>> '{}' from data_center.workflow_config
                                where key = 'call_centre.timezone'), 'Africa/Lagos'), a.attempted_at)::date = '${day}'`,
  );
  expect(mine.called).toBe(oracle.n);

  // Another agent's day is the manager's to read, not the editor's.
  const other = (await agentsAndPool(page)).agents.find((a) => a.agent_id !== me.agent_id);
  if (other) {
    const denied = await assign(page, { action: "agent_day", agentId: other.agent_id });
    expect(denied.status).toBe(403);
  }
  const board403 = await assign(page, { action: "board" });
  expect(board403.status).toBe(403);
  expect((board403.body as { code: string }).code).toBe("no_feature");

  // The manager's board carries the same mark and the same count.
  await signIn(page, USERS.admin);
  const board = data<{
    day: string;
    agents: {
      agent_id: string;
      called: number;
      verified: number;
      to_call: number;
      marks: { sale_id: string; family: string }[];
      flags: { kind: string; at: string }[];
    }[];
  }>(await assign(page, { action: "board", day }));
  expect(board.day).toBe(day);
  const row = board.agents.find((a) => a.agent_id === me.agent_id);
  expect(row, "the editor is a row on the board").toBeTruthy();
  expect(row!.called).toBe(oracle.n);
  expect(row!.marks.some((m) => m.sale_id === sale.sale_id && m.family === "callback")).toBe(true);
  expect(row!.to_call).toBe(mine.to_call.length);
});

test("the pool by partner is paged, totalled, and knows who is on it", async ({ page }) => {
  await signIn(page, USERS.admin);
  const [oracle] = await branchSql<{ partners: number; waiting: number }>(
    `select count(distinct organization_id)::int as partners, count(*)::int as waiting
       from data_center.v_callable_records`,
  );
  const first = data<{
    rows: { organization_id: string; waiting: number; on_it: string[]; batch_size: number }[];
    total: number;
    page: number;
    pageSize: number;
    totals: { waiting: number; partners: number; nobody_on: number; new_recent: number };
  }>(await assign(page, { action: "pool_partners", page: 1, pageSize: 2 }));
  expect(first.total).toBe(oracle.partners);
  expect(first.totals.waiting).toBe(oracle.waiting);
  expect(first.rows.length).toBeLessThanOrEqual(2);
  for (let i = 1; i < first.rows.length; i++) {
    expect(first.rows[i - 1].waiting).toBeGreaterThanOrEqual(first.rows[i].waiting);
  }
  const nobody = data<{ rows: { on_it: string[] }[]; total: number }>(
    await assign(page, { action: "pool_partners", nobodyOn: true, pageSize: 50 }),
  );
  expect(nobody.total).toBe(first.totals.nobody_on);
  for (const r of nobody.rows) expect(r.on_it).toEqual([]);
});

test("the activity feed carries the call as an event, filters by agent and kind, and sums its histogram", async ({ page }) => {
  const { me } = await callCentreWithWork(page);
  await signIn(page, USERS.admin);
  const feed = data<{
    rows: { at: string; kind: string; actor_id: string | null; sale_id: string | null }[];
    total: number;
    page: number;
    pageSize: number;
    histogram: { bucket: string; calls: number }[];
    totals: { calls: number; handed_out: number; reclaimed: number };
  }>(await assign(page, { action: "activity", agentId: me.agent_id, kind: "call", pageSize: 20 }));
  expect(feed.total).toBeGreaterThan(0);
  for (const r of feed.rows) {
    expect(r.kind).toBe("call");
    expect(r.actor_id).toBe(me.agent_id);
  }
  const summed = feed.histogram.reduce((n, b) => n + b.calls, 0);
  expect(summed).toBe(feed.totals.calls);
  expect(feed.pageSize).toBe(20);

  const handouts = data<{ rows: { kind: string }[]; total: number }>(
    await assign(page, { action: "activity", kind: "handed_out", pageSize: 5 }),
  );
  for (const r of handouts.rows) expect(r.kind).toBe("handed_out");
  const [oracle] = await branchSql<{ n: number }>(
    `select count(*)::int as n from data_center.assignment_batches
      where assigned_at >= now() - interval '7 days'`,
  );
  expect(handouts.total).toBe(oracle.n);

  // An editor without assignment.manage sees only their own activity.
  await signIn(page, USERS.callCentre);
  const own = data<{ rows: { actor_id: string | null }[] }>(
    await assign(page, { action: "activity", kind: "call", pageSize: 50 }),
  );
  for (const r of own.rows) expect(r.actor_id).toBe(me.agent_id);
});

test("the hand-out preview shows exactly what the picker would pick, and hands out nothing", async ({ page }) => {
  await signIn(page, USERS.admin);
  let { agents, pool } = await agentsAndPool(page);
  let partner = pool.find((p) => p.callable > 0);
  if (!partner) {
    const holder = agents.find((a) => a.open_batches > 0);
    expect(holder).toBeTruthy();
    const held = data<{ items: { sale_id: string }[] }>(
      await assign(page, { action: "agent_detail", agentId: holder!.agent_id }),
    );
    await assign(page, { action: "unassign_item", saleId: held.items[0].sale_id });
    ({ agents, pool } = await agentsAndPool(page));
    partner = pool.find((p) => p.callable > 0);
  }
  expect(partner).toBeTruthy();
  const agent = agents.find((a) => a.is_enabled) ?? agents[0];
  const [{ n: before }] = await branchSql<{ n: number }>(
    `select count(*)::int as n from data_center.assignment_batches`,
  );
  const preview = data<{
    rows: { pos: number; sale_id: string; stove_serial_no: string; phone: string | null }[];
    size: number;
    waitingAfter: number;
    agent: { open_batches: number; cap: number; over_capacity: boolean };
  }>(
    await assign(page, {
      action: "assign_preview",
      agentId: agent.agent_id,
      organizationId: partner!.organization_id,
      size: 3,
      order: ["newest_digitised"],
    }),
  );
  const oracle = await branchSql<{ sale_id: string; pos: number }>(
    `select sale_id::text, pos from data_center.pick_callable('${partner!.organization_id}', 3, array['newest_digitised']) order by pos`,
  );
  expect(preview.rows.map((r) => r.sale_id)).toEqual(oracle.map((r) => r.sale_id));
  expect(preview.size).toBe(oracle.length);
  expect(preview.waitingAfter).toBe(partner!.callable - oracle.length);
  expect(preview.agent.over_capacity).toBe(agent.open_batches >= preview.agent.cap);
  const [{ n: after }] = await branchSql<{ n: number }>(
    `select count(*)::int as n from data_center.assignment_batches`,
  );
  expect(after).toBe(before);

  const bad = await assign(page, {
    action: "assign_preview",
    agentId: agent.agent_id,
    organizationId: partner!.organization_id,
    order: ["by_moon_phase"],
  });
  expect(bad.status).toBe(409);
});
