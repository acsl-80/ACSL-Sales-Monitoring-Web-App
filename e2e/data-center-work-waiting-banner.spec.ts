import { test, expect } from "@playwright/test";
import { signIn, USERS, branchSql } from "./helpers";

/**
 * The work-waiting banner: one banner, counts as links to where the work is
 * done. A sales rep sees what is routed to them; whoever reviews sees
 * everyone's row too. Nothing renders when every count is zero.
 *
 * Red on main: the old banner has no pills and no per-tab links.
 */

const ACSL_AGENT_ID = "b0000000-0000-4000-8000-000000000003";
const SAFE_ID = /^[0-9a-f-]{36}$/;

test.describe.configure({ timeout: 240_000 });

async function seedOpenEpisodeFor(agentId: string) {
  const [sale] = await branchSql<{ sale_id: string }>(
    `select s.id::text as sale_id from public.sales s
      where s.is_archived is not true
        and not exists (select 1 from data_center.corrections c where c.sale_id = s.id)
      order by s.id limit 1`,
  );
  if (!sale) return null;
  expect(SAFE_ID.test(sale.sale_id)).toBe(true);
  const [access] = await branchSql<{ access_role: string | null }>(
    `select access_role from data_center.module_access where user_id = '${agentId}'`,
  );
  await branchSql(
    `insert into data_center.module_access (user_id, access_role) values ('${agentId}', 'sales_rep')
     on conflict (user_id) do update set access_role = 'sales_rep'`,
  );
  await branchSql(
    `insert into data_center.corrections
       (sale_id, seq, state, note, opened_at, routed_rep_key, routed_rep_user_id, assigned_to, disputed_fields, before)
     values ('${sale.sale_id}', 1, 'open', 'e2e: banner', now(), 'e2e rep', '${agentId}', '${agentId}', '{phone}',
             data_center.sale_snapshot('${sale.sale_id}'))`,
  );
  return async () => {
    await branchSql(`delete from data_center.corrections where sale_id = '${sale.sale_id}'`).catch(() => {});
    if (access?.access_role) {
      await branchSql(`update data_center.module_access set access_role = '${access.access_role}' where user_id = '${agentId}'`);
    } else {
      await branchSql(`delete from data_center.module_access where user_id = '${agentId}'`);
    }
  };
}

test("a sales rep sees what is sent back to them, linked to their own list", async ({ page }) => {
  const restore = await seedOpenEpisodeFor(ACSL_AGENT_ID);
  test.skip(!restore, "no live sale without episodes on the branch");
  try {
    await signIn(page, USERS.acslAgent);
    await page.goto("/data-center/corrections");
    const banner = page.locator("[data-work-waiting]");
    await expect(banner).toBeVisible({ timeout: 30_000 });
    await expect(banner.getByText(/waiting for you/)).toBeVisible();
    const mine = banner.getByRole("link", { name: /Sent back to me/ });
    await expect(mine).toBeVisible();
    await expect(mine).toHaveAttribute("href", /\/data-center\/corrections\?tab=open&mine=1/);
    // A rep reviews nothing, so the everyone row is not theirs to see.
    await expect(banner.getByRole("link", { name: /Waiting on Sales, everyone/ })).toHaveCount(0);
  } finally {
    await restore!();
  }
});

test("a reviewer sees everyone's row, and each pill lands on the tab or preset it counts", async ({ page }) => {
  const restore = await seedOpenEpisodeFor(ACSL_AGENT_ID);
  test.skip(!restore, "no live sale without episodes on the branch");
  try {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/dashboard");
    const banner = page.locator("[data-work-waiting]");
    await expect(banner).toBeVisible({ timeout: 30_000 });
    const everyone = banner.getByRole("link", { name: /Waiting on Sales, everyone/ });
    await expect(everyone).toBeVisible();
    await expect(everyone).toHaveAttribute("href", /\/data-center\/corrections\?tab=open$/);
    await everyone.click();
    await expect(page.getByRole("tab", { name: /Waiting on Sales/ })).toHaveAttribute("aria-selected", "true", { timeout: 30_000 });
  } finally {
    await restore!();
  }
});
