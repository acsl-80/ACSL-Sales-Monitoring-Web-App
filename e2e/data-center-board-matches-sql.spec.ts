import { test, expect, type Page } from "@playwright/test";
import { signIn, USERS, branchSql, callEdgeFunction } from "./helpers";

/**
 * The control centre. After Recompute every board tile equals its SQL
 * oracle; presence on the agents panel follows the last save; the levers
 * live on the agents panel and no longer in the log.
 *
 * Red on main: there is no board, no agents panel, and the log still carries
 * "Assign now".
 */

test.describe.configure({ timeout: 240_000 });

async function count(sql: string): Promise<number> {
  const [r] = await branchSql<{ n: number }>(sql);
  return Number(r?.n ?? 0);
}

async function tileValue(page: Page, label: string): Promise<number> {
  const tile = page.locator(`[data-board-tile="${label}"]`);
  await expect(tile).toBeVisible({ timeout: 30_000 });
  const text = await tile.locator("span").nth(1).textContent();
  return Number((text ?? "0").replace(/[^0-9]/g, ""));
}

test("after Recompute every tile equals its SQL oracle", async ({ page }) => {
  await signIn(page, USERS.admin);
  await page.goto("/data-center/call-centre");
  await expect(page.getByRole("heading", { name: "Board" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Recompute" }).click();
  await expect(page.getByRole("button", { name: "Recompute" })).toBeEnabled({ timeout: 60_000 });

  const oracle = {
    callable: await count(`select count(*)::int as n from data_center.v_callable_records`),
    recent: await count(
      `select count(*)::int as n from data_center.v_callable_records
        where digitised_at > now() - make_interval(days => coalesce((select (value #>> '{}')::int from data_center.workflow_config where key = 'pool.recent_days'), 7))`,
    ),
    neverCalled: await count(
      `select count(*)::int as n from public.sales s where s.is_archived is not true and not exists (select 1 from data_center.call_records cr where cr.sale_id = s.id)`,
    ),
    open: await count(`select count(*)::int as n from data_center.v_corrections c where c.state = 'open' and c.is_archived is not true`),
    fixed: await count(`select count(*)::int as n from data_center.v_corrections c where c.state = 'fixed' and c.is_archived is not true`),
    held: await count(
      `select count(*)::int as n from data_center.assignment_items i join data_center.assignment_batches b on b.id = i.batch_id where i.is_active and b.state = 'open'`,
    ),
  };

  await expect.poll(() => tileValue(page, "Callable now"), { timeout: 30_000 }).toBe(oracle.callable);
  expect(await tileValue(page, "New this week")).toBe(oracle.recent);
  expect(await tileValue(page, "Never called")).toBe(oracle.neverCalled);
  expect(await tileValue(page, "Waiting on Sales")).toBe(oracle.open);
  expect(await tileValue(page, "Awaiting review")).toBe(oracle.fixed);
  expect(await tileValue(page, "In progress")).toBe(oracle.held);

  // Every tile is a door: the "Never called" tile lands on the queue preset.
  await expect(page.locator('[data-board-tile="Never called"]')).toHaveAttribute("href", /preset=todo/);
});

test("presence follows the last save, and the levers live on the agents panel", async ({ page }) => {
  await signIn(page, USERS.admin);
  const r = await callEdgeFunction(page, "data-center-assign", { action: "agents" });
  const agents = (r.body as { data: { agents: { agent_id: string; open_batches: number; is_enabled: boolean }[] } }).data.agents;
  const agent = agents.find((a) => a.is_enabled && a.open_batches > 0);
  test.skip(!agent, "no enabled agent holding a batch on the branch");
  const [batch] = await branchSql<{ id: string; last_activity_at: string }>(
    `select id::text, last_activity_at::text from data_center.assignment_batches where assigned_to = '${agent!.agent_id}' and state = 'open' order by last_activity_at desc limit 1`,
  );
  test.skip(!batch, "the agent's open batch vanished between the read and the query");
  try {
    await branchSql(`update data_center.assignment_batches set last_activity_at = now() where id = '${batch.id}'`);
    await page.goto("/data-center/call-centre");
    const row = page.locator(`[data-agent-row="${agent!.agent_id}"]`);
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row.locator("[data-presence]")).toHaveAttribute("data-presence", "working");

    await branchSql(`update data_center.assignment_batches set last_activity_at = now() - interval '3 hours' where id = '${batch.id}'`);
    // Presence is the newest of three inputs; a draft or an attempt of the
    // agent's own could still hold it at Working, so judge against the view.
    const [seen] = await branchSql<{ recent: boolean }>(
      `select coalesce(last_seen_at > now() - make_interval(mins => coalesce((select (value #>> '{}')::int from data_center.workflow_config where key = 'presence.working_within_minutes'), 10)), false) as recent
         from data_center.v_agent_activity where agent_id = '${agent!.agent_id}'`,
    );
    await page.reload();
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row.locator("[data-presence]")).toHaveAttribute(
      "data-presence",
      seen?.recent ? "working" : /away|available|at_capacity/,
    );

    // The levers: on the panel, not in the log.
    const panel = page.locator("#agents-panel");
    await expect(panel.getByRole("button", { name: "Assign now" })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Reclaim quiet batches" })).toBeVisible();
    await expect(page.getByText("Assignment Log")).toBeVisible();
    await expect(page.getByRole("button", { name: "Assign now" })).toHaveCount(1);
  } finally {
    await branchSql(`update data_center.assignment_batches set last_activity_at = '${batch.last_activity_at}' where id = '${batch.id}'`);
  }
});

test("the pool by partner offers a hand-out with the partner chosen and an agent to pick", async ({ page }) => {
  await signIn(page, USERS.admin);
  // Arrange rather than skip: the engine hands out everything in global
  // setup, so put one record back, and recompute so the pool table sees it.
  const [item] = await branchSql<{ sale_id: string }>(
    `select i.sale_id::text from data_center.assignment_items i join data_center.assignment_batches b on b.id = i.batch_id where i.is_active and b.state = 'open' limit 1`,
  );
  expect(item, "a record to put back in the pool").toBeTruthy();
  await callEdgeFunction(page, "data-center-assign", { action: "unassign_item", saleId: item.sale_id });
  const rerun = await callEdgeFunction(page, "data-center-compute", { action: "run", families: ["pool"] });
  expect(rerun.status, JSON.stringify(rerun.body)).toBe(200);
  await page.goto("/data-center/call-centre");
  const pool = page.locator("#pool-by-partner");
  await expect(pool).toBeVisible({ timeout: 30_000 });
  const hand = pool.getByRole("button", { name: /^Hand out/ }).first();
  await expect(hand).toBeVisible({ timeout: 30_000 });
  await hand.click();
  await expect(page.getByRole("combobox", { name: "Who takes it" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("combobox", { name: "Hand-out order" })).toBeVisible();
  // The record goes out again, as global setup leaves the branch.
  await callEdgeFunction(page, "data-center-assign", { action: "run" }).catch(() => {});
});
