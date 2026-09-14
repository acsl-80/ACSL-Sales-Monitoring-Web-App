import { test, expect, type Page } from "@playwright/test";
import { signIn, USERS, branchSql, callEdgeFunction } from "./helpers";

/**
 * The control centre's figures equal their SQL oracles, presence follows the
 * last save, and the partner card hands out with the partner chosen.
 *
 * Phase 26, C2 replaced the board of eleven tiles with six figures over the
 * shift board. The contract the figures keep: `data-board-tile="<label>"` on
 * each, the value in the second span, and a Recompute button that refreshes
 * the computed ones.
 */
test.describe.configure({ timeout: 240_000 });

async function count(sql: string): Promise<number> {
  const [r] = await branchSql<{ n: number }>(sql);
  return Number(r?.n ?? 0);
}

async function tileValue(page: Page, label: string | RegExp): Promise<number> {
  const tile = typeof label === "string"
    ? page.locator(`[data-board-tile="${label}"]`)
    : page.locator("[data-board-tile]").filter({ has: page.locator("span", { hasText: label }) }).first();
  await expect(tile).toBeVisible({ timeout: 30_000 });
  const text = await tile.locator("span").nth(1).textContent();
  return Number((text ?? "0").replace(/[^0-9]/g, ""));
}

const TZ = `coalesce((select value #>> '{}' from data_center.workflow_config where key = 'call_centre.timezone'), 'Africa/Lagos')`;

test("after Recompute every figure equals its SQL oracle", async ({ page }) => {
  await signIn(page, USERS.admin);
  await page.goto("/data-center/call-centre");
  await expect(page.getByRole("heading", { name: "Board" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Recompute" }).click();
  await expect(page.getByRole("button", { name: "Recompute" })).toBeEnabled({ timeout: 60_000 });

  const oracle = {
    callable: await count(`select count(*)::int as n from data_center.v_callable_records`),
    open: await count(`select count(*)::int as n from data_center.v_corrections c where c.state = 'open' and c.is_archived is not true`),
    batches: await count(`select count(*)::int as n from data_center.assignment_batches where state = 'open'`),
    calledToday: await count(
      // Phase 28, D47: a call counts for the person it resolves to.
      `select count(*)::int as n from data_center.v_call_attempts_resolved a
        where a.agent_user_id is not null and timezone(${TZ}, a.attempted_at)::date = timezone(${TZ}, now())::date`,
    ),
  };
  await expect.poll(() => tileValue(page, "Waiting to be called"), { timeout: 30_000 }).toBe(oracle.callable);
  expect(await tileValue(page, "Waiting on Sales")).toBe(oracle.open);
  expect(await tileValue(page, "Batches in hand")).toBe(oracle.batches);
  expect(await tileValue(page, /^Calls made today$/)).toBe(oracle.calledToday);
  await expect(page.locator('[data-board-tile="Waiting to be called"]')).toHaveAttribute("href", /call-centre\/partners/);
  await expect(page.locator('[data-board-tile="Waiting on Sales"]')).toHaveAttribute("href", /corrections\?tab=open/);
});

test("presence follows the last save, and the levers live on the shift board", async ({ page }) => {
  await signIn(page, USERS.admin);
  const r = await callEdgeFunction(page, "data-center-assign", { action: "agents" });
  const agents = (r.body as { data: { agents: { agent_id: string; open_batches: number; is_enabled: boolean }[] } }).data.agents;
  const agent = agents.find((a) => a.is_enabled && a.open_batches > 0);
  expect(agent, "an enabled agent holding a batch on the branch").toBeTruthy();
  const [batch] = await branchSql<{ id: string; last_activity_at: string }>(
    `select id::text, last_activity_at::text from data_center.assignment_batches where assigned_to = '${agent!.agent_id}' and state = 'open' order by assigned_at desc limit 1`,
  );
  expect(batch, "the agent's open batch").toBeTruthy();
  try {
    await branchSql(`update data_center.assignment_batches set last_activity_at = now() where id = '${batch.id}'`);
    await page.goto("/data-center/call-centre");
    const row = page.locator(`[data-agent-row="${agent!.agent_id}"]`);
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row.locator("[data-presence]")).toHaveAttribute("data-presence", "working");
    await expect(row.locator("[data-track]")).toBeVisible();

    await branchSql(`update data_center.assignment_batches set last_activity_at = now() - interval '3 hours' where id = '${batch.id}'`);
    const [seen] = await branchSql<{ recent: boolean }>(
      `select coalesce(last_seen_at > now() - make_interval(mins => coalesce((select (value #>> '{}')::int from data_center.workflow_config where key = 'presence.working_within_minutes'), 10)), false) as recent
         from data_center.v_agent_activity where agent_id = '${agent!.agent_id}'`,
    );
    await page.reload();
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row.locator("[data-presence]")).toHaveAttribute("data-presence", seen?.recent ? "working" : /away|available|at_capacity/);

    const panel = page.locator("#agents-panel");
    await expect(panel.getByRole("button", { name: "Assign now" })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Reclaim quiet batches" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^What happened/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Assign now" })).toHaveCount(1);
  } finally {
    await branchSql(`update data_center.assignment_batches set last_activity_at = '${batch.last_activity_at}' where id = '${batch.id}'`);
  }
});

test("the partner card offers a hand-out with the partner chosen and an agent to pick", async ({ page }) => {
  await signIn(page, USERS.admin);
  const [item] = await branchSql<{ sale_id: string }>(
    // Phase 28: a concluded record stays in its batch but is no longer
    // callable, so pick one that would return to the pool when let go.
    `select i.sale_id::text from data_center.assignment_items i
       join data_center.assignment_batches b on b.id = i.batch_id
       join data_center.v_call_center_resolved r on r.sale_id = i.sale_id
      where i.is_active and b.state = 'open' and r.standing in ('never_called', 'in_progress')
      order by case when r.standing = 'never_called' then 0 else 1 end limit 1`,
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
  await page.keyboard.press("Escape");
  await expect(pool.getByRole("link", { name: /^See all/ })).toHaveAttribute("href", /call-centre\/partners/);
  await callEdgeFunction(page, "data-center-assign", { action: "run" }).catch(() => {});
});
