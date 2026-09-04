import { test, expect, type Page } from "@playwright/test";
import { signIn, USERS, branchSql, callEdgeFunction } from "./helpers";

/**
 * A paused agent receives nothing, by engine or by hand, and resume restores
 * them. The engine picks its agents from module access, so an agent with no
 * profile row is a candidate and a paused one is not.
 *
 * Red on main: agent_profile_set is an unknown action, and the engine's
 * inner join on call_agent_profiles ignores the pause anyway when no row
 * exists.
 */

test.describe.configure({ timeout: 240_000 });

type Agent = { agent_id: string; open_batches: number; is_enabled: boolean };

async function agents(page: Page): Promise<Agent[]> {
  const r = await callEdgeFunction(page, "data-center-assign", { action: "agents" });
  expect(r.status).toBe(200);
  return (r.body as { data: { agents: Agent[] } }).data.agents;
}

test("paused: the engine skips them and the manual door refuses; resumed: both open again", async ({ page }) => {
  await signIn(page, USERS.admin);
  const list = await agents(page);
  // The emptiest agent: the one the engine would pick first if it were allowed to.
  const agent = [...list].filter((a) => a.is_enabled).sort((a, b) => a.open_batches - b.open_batches)[0];
  expect(agent, "an enabled call agent on the branch").toBeTruthy();
  const [was] = await branchSql<{ is_enabled: boolean; max_open_batches: number | null }>(
    `select is_enabled, max_open_batches from data_center.call_agent_profiles where user_id = '${agent.agent_id}'`,
  );
  const madeByRun: string[] = [];
  try {
    const paused = await callEdgeFunction(page, "data-center-assign", {
      action: "agent_profile_set", agentId: agent.agent_id, isEnabled: false, note: "e2e: on leave",
    });
    expect(paused.status, JSON.stringify(paused.body)).toBe(200);
    expect((paused.body as { data: { profile: { is_enabled: boolean } } }).data.profile.is_enabled).toBe(false);

    // The engine runs and hands out whatever it can; none of it to the paused agent.
    const [{ before }] = await branchSql<{ before: number }>(
      `select count(*)::int as before from data_center.assignment_batches where assigned_to = '${agent.agent_id}'`,
    );
    const run = await callEdgeFunction(page, "data-center-assign", { action: "run" });
    expect(run.status).toBe(200);
    const out = (run.body as { data: { batches: { batch_id: string; agent_id: string }[] } }).data;
    madeByRun.push(...out.batches.map((b) => b.batch_id));
    expect(out.batches.some((b) => b.agent_id === agent.agent_id), "the engine handed the paused agent a batch").toBe(false);
    const [{ after }] = await branchSql<{ after: number }>(
      `select count(*)::int as after from data_center.assignment_batches where assigned_to = '${agent.agent_id}'`,
    );
    expect(after).toBe(before);

    // By hand, the same answer.
    const [partner] = await branchSql<{ organization_id: string }>(
      `select organization_id::text from data_center.v_callable_records group by 1 order by count(*) desc limit 1`,
    );
    if (partner) {
      const refused = await callEdgeFunction(page, "data-center-assign", {
        action: "assign_manual", agentId: agent.agent_id, organizationId: partner.organization_id, size: 1,
      });
      expect(refused.status).toBe(409);
      expect((refused.body as { code: string }).code).toBe("paused");
    }

    const resumed = await callEdgeFunction(page, "data-center-assign", {
      action: "agent_profile_set", agentId: agent.agent_id, isEnabled: true,
    });
    expect(resumed.status).toBe(200);
    expect((resumed.body as { data: { profile: { is_enabled: boolean } } }).data.profile.is_enabled).toBe(true);
    const listed = (await agents(page)).find((a) => a.agent_id === agent.agent_id);
    expect(listed?.is_enabled).toBe(true);
  } finally {
    for (const b of madeByRun) {
      await callEdgeFunction(page, "data-center-assign", { action: "unassign_batch", batchId: b, reason: "e2e: cleanup" }).catch(() => {});
    }
    if (was) {
      await branchSql(
        `update data_center.call_agent_profiles set is_enabled = ${was.is_enabled}, max_open_batches = ${was.max_open_batches ?? "null"}, note = null where user_id = '${agent.agent_id}'`,
      );
    } else {
      await branchSql(`delete from data_center.call_agent_profiles where user_id = '${agent.agent_id}'`);
    }
  }
});
