import { test, expect, type Page } from "@playwright/test";
import { signIn, USERS, branchSql, callEdgeFunction } from "./helpers";

/**
 * The manual door knows capacity, and the console opens for whoever may
 * manage assignment.
 *
 * A second manual batch for an agent whose capacity is one is refused with
 * the capacity message; with a reason it lands, and the reason is on the
 * batch. A data manager, who holds assignment.manage, sees the console.
 *
 * Red on main: agent_profile_set is an unknown action, assign_batch_manual
 * knows no capacity, and the console is gated on super admin.
 */

test.describe.configure({ timeout: 240_000 });

type Agent = { agent_id: string; open_batches: number; is_enabled: boolean };
type Partner = { organization_id: string; callable: number };
type Profile = { is_enabled: boolean; max_open_batches: number | null; note: string | null } | null;

async function state(page: Page) {
  const r = await callEdgeFunction(page, "data-center-assign", { action: "agents" });
  expect(r.status).toBe(200);
  return (r.body as { data: { agents: Agent[]; pool: Partner[] } }).data;
}

/**
 * A partner with something callable. The fixed engine hands out everything the
 * seed has during global setup, so arrange rather than skip: take one record
 * back from whoever holds one, which puts its partner back in the pool.
 */
async function ensurePool(page: Page, notFrom: string): Promise<Partner[]> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const s = await state(page);
    const pool = s.pool.filter((p) => p.callable > 0);
    if (pool.length > 0) return pool;
    // Never from the agent under test: taking their last record would
    // reclaim their batch and turn the refusal into a 200.
    const holder = s.agents.find((a) => a.open_batches > 0 && a.agent_id !== notFrom);
    expect(holder, "somebody holding a batch to take a record from").toBeTruthy();
    const held = await callEdgeFunction(page, "data-center-assign", { action: "agent_detail", agentId: holder!.agent_id });
    const items = (held.body as { data: { items: { sale_id: string }[] } }).data.items;
    expect(items.length).toBeGreaterThan(0);
    await callEdgeFunction(page, "data-center-assign", { action: "unassign_item", saleId: items[0].sale_id });
  }
  throw new Error("no partner with callable records after three attempts");
}

async function profileOf(agentId: string): Promise<Profile> {
  const [p] = await branchSql<NonNullable<Profile>>(
    `select is_enabled, max_open_batches, note from data_center.call_agent_profiles where user_id = '${agentId}'`,
  );
  return p ?? null;
}

async function restoreProfile(agentId: string, was: Profile) {
  if (was) {
    await branchSql(
      `update data_center.call_agent_profiles
          set is_enabled = ${was.is_enabled}, max_open_batches = ${was.max_open_batches ?? "null"},
              note = ${was.note ? `'${was.note.replace(/'/g, "''")}'` : "null"}
        where user_id = '${agentId}'`,
    );
  } else {
    await branchSql(`delete from data_center.call_agent_profiles where user_id = '${agentId}'`);
  }
}

test("a second batch over capacity is refused, and lands with a reason", async ({ page }) => {
  await signIn(page, USERS.admin);
  const s = await state(page);
  const agent = s.agents.find((a) => a.is_enabled) ?? s.agents[0];
  expect(agent, "a call agent on the branch").toBeTruthy();
  const was = await profileOf(agent.agent_id);
  const made: string[] = [];
  try {
    const set = await callEdgeFunction(page, "data-center-assign", {
      action: "agent_profile_set",
      agentId: agent.agent_id,
      isEnabled: true,
      maxOpenBatches: 1,
    });
    expect(set.status, JSON.stringify(set.body)).toBe(200);

    // The agent must hold one batch already; make one if the engine left them empty.
    let pool = await ensurePool(page, agent.agent_id);
    const fresh = (await state(page)).agents.find((a) => a.agent_id === agent.agent_id);
    if ((fresh?.open_batches ?? 0) === 0) {
      const first = await callEdgeFunction(page, "data-center-assign", {
        action: "assign_manual", agentId: agent.agent_id, organizationId: pool[0].organization_id, size: 1,
      });
      expect(first.status, JSON.stringify(first.body)).toBe(200);
      const b = (first.body as { data: { batchId: string | null } }).data.batchId;
      expect(b).toBeTruthy();
      made.push(b!);
    }
    pool = await ensurePool(page, agent.agent_id);
    const held = (await state(page)).agents.find((a) => a.agent_id === agent.agent_id);
    expect(held?.open_batches, "the agent holds a batch before the refusal is tested").toBeGreaterThanOrEqual(1);

    const refused = await callEdgeFunction(page, "data-center-assign", {
      action: "assign_manual", agentId: agent.agent_id, organizationId: pool[0].organization_id, size: 1,
    });
    expect(refused.status).toBe(409);
    expect((refused.body as { code: string }).code).toBe("over_capacity");
    expect((refused.body as { error: string }).error).toMatch(/capacity of 1/);

    const allowed = await callEdgeFunction(page, "data-center-assign", {
      action: "assign_manual", agentId: agent.agent_id, organizationId: pool[0].organization_id, size: 1,
      overrideReason: "e2e: covering for a colleague this afternoon",
    });
    expect(allowed.status, JSON.stringify(allowed.body)).toBe(200);
    const batchId = (allowed.body as { data: { batchId: string | null } }).data.batchId;
    expect(batchId).toBeTruthy();
    made.push(batchId!);
    const [row] = await branchSql<{ override_reason: string | null }>(
      `select override_reason from data_center.assignment_batches where id = '${batchId}'`,
    );
    expect(row?.override_reason).toBe("e2e: covering for a colleague this afternoon");
  } finally {
    for (const b of made) {
      await callEdgeFunction(page, "data-center-assign", { action: "unassign_batch", batchId: b, reason: "e2e: cleanup" }).catch(() => {});
    }
    await restoreProfile(agent.agent_id, was);
    // Records put back by ensurePool go out again, as global setup leaves them.
    await callEdgeFunction(page, "data-center-assign", { action: "run" }).catch(() => {});
  }
});

test("a data manager sees the console and the levers, a call centre editor does not", async ({ page }) => {
  await signIn(page, USERS.dataManager);
  await page.goto("/data-center/call-centre");
  await expect(page.getByRole("heading", { name: "Agents and their work" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Assign now" })).toBeVisible();

  await signIn(page, USERS.callCentre);
  await page.goto("/data-center/call-centre");
  await expect(page.getByText("Assignment Log")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Agents and their work" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Assign now" })).toHaveCount(0);
});
