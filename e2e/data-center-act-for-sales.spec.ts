import { test, expect } from "@playwright/test";
import { signIn, USERS, branchSql, callEdgeFunction } from "./helpers";

/**
 * Phase 34 (D67): anyone the team chooses can act for Sales on a sent-back
 * record, and the record can be found.
 *
 * The actor is the seeded manager, who holds the `viewer` level: no
 * corrections.fix, no call_records.edit, nothing routed to them. The episode
 * is routed to the seeded ACSL agent's account, so whoever fixes it as the
 * manager is fixing it for somebody else.
 *
 * Red on main: the corrections function knows no act-for-Sales key and no
 * level table, so the viewer is refused whatever is granted; the stove page
 * names the correction without a way to it; Settings has no level switch.
 *
 * No fix here edits the sale itself. Saving the fields goes through the sales
 * app's own save path, which is retrofit slice D's, and that half waits (S3).
 */

const MANAGER_ID = "b0000000-0000-4000-8000-000000000002";
const ROUTED_REP_ID = "b0000000-0000-4000-8000-000000000003";
const SAFE_ID = /^[0-9a-f-]{36}$/;

test.describe.configure({ mode: "serial", timeout: 240_000 });

type Sale = { sale_id: string; stove_serial_no: string; sales_rep: string };

async function salesOnRepTransfers(n: number): Promise<Sale[]> {
  const rows = await branchSql<Sale>(
    `select distinct on (s.id) s.id::text as sale_id, s.stove_serial_no, f.sales_rep
       from public.sales s
       join data_center.v_transfer_stoves b on b.stove_id = upper(trim(s.stove_serial_no))
       join data_center.transfer_funnel f on f.transfer_id = b.transfer_id
      where s.is_archived is not true and f.sales_rep is not null and trim(f.sales_rep) <> ''
      order by s.id limit ${n}`,
  );
  for (const r of rows) expect(SAFE_ID.test(r.sale_id)).toBe(true);
  return rows;
}

/** One open episode per sale, routed to the ACSL agent's account; returns the undo. */
async function sendBack(sales: Sale[]) {
  for (const sale of sales) {
    const repKey = sale.sales_rep.trim().toLowerCase().replace(/'/g, "''");
    await branchSql(`delete from data_center.corrections where sale_id = '${sale.sale_id}'`);
    await branchSql(
      `insert into data_center.corrections
         (sale_id, seq, state, note, opened_at, routed_rep_key, routed_rep_user_id, disputed_fields, before)
       values ('${sale.sale_id}', 1, 'open', 'e2e: the number rings a different household', now(),
               '${repKey}', '${ROUTED_REP_ID}', '{phone}', data_center.sale_snapshot('${sale.sale_id}'))`,
    );
  }
  return async () => {
    for (const sale of sales) {
      await branchSql(`delete from data_center.corrections where sale_id = '${sale.sale_id}'`).catch(() => {});
    }
  };
}

/** Nothing gives the manager the power until a test does. */
async function clearGrants() {
  await branchSql(
    `delete from data_center.feature_grants
      where user_id = '${MANAGER_ID}' and feature_key = 'corrections.act_for_sales'`,
  );
  await branchSql(`delete from data_center.act_for_sales_levels`);
}

test("a viewer is refused, then acts for Sales by grant or by level, and the fix names both", async ({ page }) => {
  const [sale] = await salesOnRepTransfers(1);
  test.skip(!sale, "no sale on a transfer that names a rep");
  await clearGrants();
  const undo = await sendBack([sale]);
  try {
    await signIn(page, USERS.manager);

    // Without the power: a viewer may not open or close a send-back.
    const refusedDetail = await callEdgeFunction(page, "data-center-corrections", { action: "detail", saleId: sale.sale_id });
    expect(refusedDetail.status).toBe(403);
    const refusedFix = await callEdgeFunction(page, "data-center-corrections", {
      action: "fix", saleId: sale.sale_id, note: "e2e: should not land",
    });
    expect(refusedFix.status).toBe(403);

    // Given to the person: the fix lands, stamped with who and for whom.
    await branchSql(
      `insert into data_center.feature_grants (user_id, feature_key)
       values ('${MANAGER_ID}', 'corrections.act_for_sales') on conflict do nothing`,
    );
    const fixed = await callEdgeFunction(page, "data-center-corrections", {
      action: "fix", saleId: sale.sale_id, note: "e2e: rang the buyer, the receipt is right",
    });
    expect(fixed.status).toBe(200);
    const [episode] = await branchSql<{ state: string; fixed_by: string; fixed_on_behalf: string | null }>(
      `select state, fixed_by::text, fixed_on_behalf from data_center.corrections
        where sale_id = '${sale.sale_id}' order by seq desc limit 1`,
    );
    expect(episode.state).toBe("fixed");
    expect(episode.fixed_by).toBe(MANAGER_ID);
    expect(episode.fixed_on_behalf).toBe(sale.sales_rep);

    // Given to the whole level instead: the person's grant goes, the level's
    // switch comes on, and the record opens with the fix offered.
    await branchSql(`update data_center.corrections set state = 'open', fixed_at = null, fixed_by = null,
                       fixed_on_behalf = null, fix_note = null where sale_id = '${sale.sale_id}'`);
    await clearGrants();
    await branchSql(`insert into data_center.act_for_sales_levels (access_role) values ('viewer')`);
    const detail = await callEdgeFunction(page, "data-center-corrections", { action: "detail", saleId: sale.sale_id });
    expect(detail.status).toBe(200);
    const can = (detail.body as { data: { can: { fix: boolean; actForSales: boolean; mine: boolean } } }).data.can;
    expect(can.fix).toBe(true);
    expect(can.actForSales).toBe(true);
    expect(can.mine).toBe(false);
  } finally {
    await clearGrants();
    await undo();
  }
});

test("the record is found from Explore, opened from its row, saved, and the list moves on", async ({ page }) => {
  const sales = await salesOnRepTransfers(2);
  test.skip(sales.length < 2, "fewer than two sales on transfers that name a rep");
  await clearGrants();
  await branchSql(`insert into data_center.act_for_sales_levels (access_role) values ('viewer')`);
  const undo = await sendBack(sales);
  const [first] = sales;
  try {
    await signIn(page, USERS.manager);
    await page.goto("/data-center");
    await page.getByRole("link", { name: "Open Records to fix" }).click();
    await expect(page.getByRole("heading", { name: "Records to fix" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("You can fix any of these for Sales")).toBeVisible({ timeout: 30_000 });

    // Narrowed to the one serial, from the search box, held in the URL.
    await page.getByLabel("Search").fill(first.stove_serial_no);
    await expect(page).toHaveURL(/q=/, { timeout: 10_000 });
    const rows = page.locator("[data-correction-row]");
    await expect(rows).toHaveCount(1, { timeout: 30_000 });

    // The row itself opens the record, not the stove page.
    await rows.first().locator("td").nth(3).click();
    await expect(page.getByRole("heading", { name: "Fix this record" })).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(new RegExp(`/data-center/corrections/${first.sale_id}`));
    await expect(page.getByText(/You are fixing this for/)).toBeVisible({ timeout: 20_000 });

    await page.getByLabel(/What did you change/).fill("e2e: rang the buyer, the receipt is right");
    await page.getByRole("button", { name: "Send for review" }).click();

    const saved = page.locator("[data-correction-saved]");
    await expect(saved).toBeVisible({ timeout: 30_000 });
    await expect(saved).toContainText("Sent for review");
    const [episode] = await branchSql<{ state: string; fixed_on_behalf: string | null }>(
      `select state, fixed_on_behalf from data_center.corrections
        where sale_id = '${first.sale_id}' order by seq desc limit 1`,
    );
    expect(episode.state).toBe("fixed");
    expect(episode.fixed_on_behalf).toBe(first.sales_rep);

    // The list was narrowed to this one record, so there is no next.
    await saved.getByRole("button", { name: "Next record" }).click();
    await expect(saved).toContainText("That was the last record waiting in this list", { timeout: 30_000 });
  } finally {
    await clearGrants();
    await undo();
  }
});

test("the stove page leads to its open correction", async ({ page }) => {
  const [sale] = await salesOnRepTransfers(1);
  test.skip(!sale, "no sale on a transfer that names a rep");
  const undo = await sendBack([sale]);
  try {
    // The stove page reads the state from the newest episode, through the view.
    await signIn(page, USERS.dataManager);
    await page.goto(`/data-center/stove/${encodeURIComponent(sale.stove_serial_no)}`);
    const link = page.locator("[data-open-correction]");
    await expect(link).toBeVisible({ timeout: 30_000 });
    await link.click();
    await expect(page.getByRole("heading", { name: "Fix this record" })).toBeVisible({ timeout: 30_000 });
  } finally {
    await undo();
  }
});

test("Settings switches a level on and off for acting for Sales", async ({ page }) => {
  await clearGrants();
  try {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/settings");
    const card = page.locator("[data-act-for-sales]");
    await expect(card).toBeVisible({ timeout: 30_000 });
    const viewer = card.getByLabel("Every viewer");
    await expect(viewer).not.toBeChecked();
    await viewer.check();
    await expect
      .poll(async () => (await branchSql<{ n: number }>(
        `select count(*)::int as n from data_center.act_for_sales_levels where access_role = 'viewer'`,
      ))[0].n, { timeout: 20_000 })
      .toBe(1);
    await expect(card.getByLabel("Every viewer")).toBeChecked({ timeout: 20_000 });
    await card.getByLabel("Every viewer").uncheck();
    await expect
      .poll(async () => (await branchSql<{ n: number }>(
        `select count(*)::int as n from data_center.act_for_sales_levels`,
      ))[0].n, { timeout: 20_000 })
      .toBe(0);
  } finally {
    await clearGrants();
  }
});
