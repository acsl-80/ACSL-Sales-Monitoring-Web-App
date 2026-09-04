import { test, expect, type Page } from "@playwright/test";
import { signIn, USERS, branchSql, callEdgeFunction } from "./helpers";

/**
 * The pool knows what is callable, and in what order.
 *
 * A record with an open send-back leaves v_callable_records and the console's
 * pool tile, and comes back when the send-back is withdrawn; a record rung
 * within the cooldown waits its turn; the picker honours "newest digitised
 * first" against a SQL oracle; the hand-out dialog offers the order.
 *
 * Red on main: the view knows no exclusions, pick_callable does not exist,
 * and the dialog has no order to choose.
 */

test.describe.configure({ timeout: 240_000 });

type Pool = { organization_id: string; callable: number }[];

async function poolOf(page: Page): Promise<Pool> {
  const r = await callEdgeFunction(page, "data-center-assign", { action: "agents" });
  expect(r.status).toBe(200);
  return (r.body as { data: { pool: Pool } }).data.pool;
}

const total = (pool: Pool, org?: string) =>
  pool.filter((p) => !org || p.organization_id === org).reduce((n, p) => n + p.callable, 0);

async function callableCount(): Promise<number> {
  const [r] = await branchSql<{ n: number }>(`select count(*)::int as n from data_center.v_callable_records`);
  return Number(r.n);
}

/** A callable record, arranged if the engine has taken them all. */
async function callableSale(page: Page): Promise<{ sale_id: string; organization_id: string }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const [row] = await branchSql<{ sale_id: string; organization_id: string }>(
      `select r.sale_id::text, r.organization_id::text from data_center.v_callable_records r
        where not exists (select 1 from data_center.corrections c where c.sale_id = r.sale_id)
        order by r.sale_id limit 1`,
    );
    if (row) return row;
    const [item] = await branchSql<{ sale_id: string }>(
      `select i.sale_id::text from data_center.assignment_items i
         join data_center.assignment_batches b on b.id = i.batch_id
        where i.is_active and b.state = 'open' limit 1`,
    );
    expect(item, "a record to put back in the pool").toBeTruthy();
    await callEdgeFunction(page, "data-center-assign", { action: "unassign_item", saleId: item.sale_id });
  }
  throw new Error("no callable record after three attempts");
}

test.afterEach(async ({ page }) => {
  // Whatever a test put back, the engine takes out again, as global setup leaves it.
  await callEdgeFunction(page, "data-center-assign", { action: "run" }).catch(() => {});
});

test("a record sent back leaves the pool and the tile, and returns when the send-back is withdrawn", async ({ page }) => {
  await signIn(page, USERS.admin);
  const sale = await callableSale(page);
  const before = await callableCount();
  const tileBefore = total(await poolOf(page), sale.organization_id);
  try {
    const opened = await callEdgeFunction(page, "data-center-corrections", {
      action: "open", saleId: sale.sale_id, note: "e2e: the receipt is wrong", fields: ["phone"],
    });
    expect(opened.status, JSON.stringify(opened.body)).toBe(200);
    expect(await callableCount()).toBe(before - 1);
    expect(total(await poolOf(page), sale.organization_id)).toBe(tileBefore - 1);

    const withdrawn = await callEdgeFunction(page, "data-center-corrections", {
      action: "withdraw", saleId: sale.sale_id, note: "e2e: taken back",
    });
    expect(withdrawn.status).toBe(200);
    expect(await callableCount()).toBe(before);
    expect(total(await poolOf(page), sale.organization_id)).toBe(tileBefore);
  } finally {
    await branchSql(`delete from data_center.corrections where sale_id = '${sale.sale_id}'`).catch(() => {});
  }
});

test("a record rung within the cooldown waits; a ring-again close newer than the attempt does not", async ({ page }) => {
  await signIn(page, USERS.admin);
  const sale = await callableSale(page);
  const [was] = await branchSql<{ last_attempt_at: string | null; existed: boolean }>(
    `select cr.last_attempt_at::text, true as existed from data_center.call_records cr where cr.sale_id = '${sale.sale_id}'`,
  );
  await branchSql(`insert into data_center.call_records (sale_id) values ('${sale.sale_id}') on conflict (sale_id) do nothing`);
  const before = await callableCount();
  try {
    await branchSql(`update data_center.call_records set last_attempt_at = now() - interval '1 hour' where sale_id = '${sale.sale_id}'`);
    expect(await callableCount(), "rung an hour ago: not offered again yet").toBe(before - 1);

    // A ring-again close after that attempt brings it straight back.
    await branchSql(
      `insert into data_center.corrections
         (sale_id, seq, state, note, opened_at, routed_rep_key, disputed_fields, before, fixed_at, after,
          reviewed_at, review_outcome, attempts_at_close)
       values ('${sale.sale_id}', 1, 'resolved', 'e2e', now() - interval '50 minutes', 'e2e rep', '{phone}',
               data_center.sale_snapshot('${sale.sale_id}'), now() - interval '20 minutes',
               data_center.sale_snapshot('${sale.sale_id}'), now() - interval '10 minutes', 'recall',
               (select coalesce(attempt_count, 0) from data_center.call_records where sale_id = '${sale.sale_id}'))`,
    );
    expect(await callableCount(), "ring again is newer than the attempt").toBe(before);
    const [r] = await branchSql<{ recall_due: boolean }>(
      `select recall_due from data_center.v_callable_records where sale_id = '${sale.sale_id}'`,
    );
    expect(r?.recall_due).toBe(true);
  } finally {
    await branchSql(`delete from data_center.corrections where sale_id = '${sale.sale_id}'`).catch(() => {});
    if (was?.existed) {
      await branchSql(`update data_center.call_records set last_attempt_at = ${was.last_attempt_at ? `'${was.last_attempt_at}'` : "null"} where sale_id = '${sale.sale_id}'`);
    } else {
      await branchSql(`delete from data_center.call_records where sale_id = '${sale.sale_id}'`);
    }
  }
});

test("the picker honours newest digitised first against the SQL oracle, and the dialog offers the order", async ({ page }) => {
  await signIn(page, USERS.admin);
  await callableSale(page);
  const [org] = await branchSql<{ organization_id: string; n: number }>(
    `select organization_id::text, count(*)::int as n from data_center.v_callable_records group by 1 order by 2 desc limit 1`,
  );
  expect(org, "a partner with callable records").toBeTruthy();
  const oracle = await branchSql<{ sale_id: string }>(
    `select sale_id::text from data_center.v_callable_records
      where organization_id = '${org.organization_id}'
      order by digitised_at desc nulls last, sale_id limit 3`,
  );
  const picked = await branchSql<{ sale_id: string; pos: number }>(
    `select sale_id::text, pos from data_center.pick_callable('${org.organization_id}', 3, '{newest_digitised}') order by pos`,
  );
  expect(picked.map((p) => p.sale_id)).toEqual(oracle.map((o) => o.sale_id));

  // An order the picker does not know is refused, not obeyed.
  const bad = await branchSql(`select * from data_center.pick_callable('${org.organization_id}', 3, '{drop_table}')`).catch((e: Error) => e);
  expect(bad).toBeInstanceOf(Error);

  await page.goto("/data-center/call-centre");
  await expect(page.getByRole("heading", { name: "Agents and their work" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: /^Assign$/ }).first().click();
  const order = page.getByRole("combobox", { name: "Hand-out order" });
  await expect(order).toBeVisible({ timeout: 15_000 });
  await expect(order.locator("option", { hasText: "Newest digitised first" })).toHaveCount(1);
});
