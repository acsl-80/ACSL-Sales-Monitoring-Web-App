import { test, expect } from "@playwright/test";
import { signIn, USERS, branchSql, callEdgeFunction } from "./helpers";

/**
 * D68: who reviews a fix is said where the fix is sent, and a card counts
 * what Sales corrected and how the closed ones closed.
 *
 * Red on main: the list answers no `outcomes` and the detail no `reviewers`,
 * so the card reads zero for corrected and the panel names nobody.
 *
 * Four sales with no send-back of their own get one episode each, in the four
 * states the card tells apart. The counts are the whole branch's, so the spec
 * asserts what its own rows add, not totals. Everything it made goes again.
 */

const SAFE_ID = /^[0-9a-f-]{36}$/;
const CALL_CENTRE = "Preview Call Centre";
const DATA_MANAGER = "Preview Data Manager";
const SUPER_ADMIN = "Preview Super Admin";

test.describe.configure({ mode: "serial", timeout: 240_000 });

type Sale = { sale_id: string; had_call_record: boolean };
type Outcomes = { corrected: number; resolvedAfterFix: number; withdrawn: number };
type List = { counts: { open: number; fixed: number; resolved: number }; outcomes?: Outcomes };

async function freshSales(n: number): Promise<Sale[]> {
  const rows = await branchSql<Sale>(
    `select s.id::text as sale_id,
            exists (select 1 from data_center.call_records cr where cr.sale_id = s.id) as had_call_record
       from public.sales s
      where s.is_archived is not true
        and not exists (select 1 from data_center.corrections c where c.sale_id = s.id)
      order by s.id limit ${n}`,
  );
  expect(rows.length, `${n} sales with no send-back`).toBe(n);
  for (const r of rows) expect(SAFE_ID.test(r.sale_id)).toBe(true);
  return rows;
}

/** The six columns the corrections mirror writes onto a call record. */
const MIRROR = [
  "correction_requested_at", "correction_requested_by", "correction_reason_id",
  "correction_note", "correction_resolved_at", "correction_resolved_by",
];

/**
 * Hold a call record's mirror columns, and return the way back. Inserting an
 * episode makes the mirror trigger write onto an existing call record, and
 * deleting the episode does not undo it.
 */
async function holdMirror(saleId: string) {
  const [row] = await branchSql<{ snap: unknown }>(
    `select jsonb_build_object(${MIRROR.map((c) => `'${c}', cr.${c}`).join(", ")}) as snap
       from data_center.call_records cr where cr.sale_id = '${saleId}'`,
  );
  return async () => {
    if (!row) return;
    const json = JSON.stringify(row.snap).replace(/'/g, "''");
    await branchSql(
      `update data_center.call_records cr
          set (${MIRROR.join(", ")}) =
              (select ${MIRROR.map((c) => `r.${c}`).join(", ")}
                 from jsonb_populate_record(null::data_center.call_records, '${json}'::jsonb) r)
        where cr.sale_id = '${saleId}'`,
    );
  };
}

/** One episode per sale: open, corrected and awaiting review, resolved after a fix, withdrawn. */
async function arrange(sales: Sale[]) {
  const [open, fixed, resolved, withdrawn] = sales;
  const restores = await Promise.all(sales.map((s) => (s.had_call_record ? holdMirror(s.sale_id) : null)));
  const ep = (id: string, rest: string) =>
    branchSql(
      `insert into data_center.corrections (sale_id, seq, state, note, opened_at, disputed_fields,
                                             fixed_at, fix_note, reviewed_at, review_outcome)
       values ('${id}', 1, ${rest})`,
    );
  await ep(open.sale_id, `'open', 'e2e: open', now(), '{phone}', null, null, null, null`);
  await ep(fixed.sale_id, `'fixed', 'e2e: fixed', now(), '{phone}', now(), 'e2e: rang the buyer', null, null`);
  await ep(resolved.sale_id, `'resolved', 'e2e: resolved', now(), '{phone}', now(), 'e2e: corrected', now(), 'recall'`);
  await ep(withdrawn.sale_id, `'resolved', 'e2e: withdrawn', now(), '{phone}', null, null, now(), 'withdrawn'`);
  return async () => {
    for (const [i, s] of sales.entries()) {
      await branchSql(`delete from data_center.corrections where sale_id = '${s.sale_id}'`).catch(() => {});
      if (!s.had_call_record) {
        await branchSql(`delete from data_center.call_records where sale_id = '${s.sale_id}'`).catch(() => {});
      } else {
        await restores[i]?.().catch(() => {});
      }
    }
  };
}

const listOf = async (page: import("@playwright/test").Page) => {
  const r = await callEdgeFunction(page, "data-center-corrections", { action: "list", tab: "open", limit: 1 });
  expect(r.status).toBe(200);
  return (r.body as { data: List }).data;
};

test("the list counts what Sales corrected and how the closed ones closed", async ({ page }) => {
  await signIn(page, USERS.admin);
  const before = await listOf(page);
  const sales = await freshSales(4);
  const undo = await arrange(sales);
  try {
    const after = await listOf(page);
    expect(after.outcomes, "the list should answer the card's counts").toBeTruthy();
    expect(after.counts.open - before.counts.open).toBe(1);
    expect(after.counts.fixed - before.counts.fixed).toBe(1);
    expect(after.counts.resolved - before.counts.resolved).toBe(2);
    expect(after.outcomes!.corrected - (before.outcomes?.corrected ?? 0)).toBe(2);
    expect(after.outcomes!.resolvedAfterFix - (before.outcomes?.resolvedAfterFix ?? 0)).toBe(1);
    expect(after.outcomes!.withdrawn - (before.outcomes?.withdrawn ?? 0)).toBe(1);

    // The card shows the same numbers the list answered.
    await page.goto("/data-center/corrections");
    const card = page.locator("[data-correction-figures]");
    await expect(card).toBeVisible({ timeout: 30_000 });
    const corrected = card.locator('[data-board-tile="Corrected by Sales"]');
    await expect(corrected).toContainText(after.outcomes!.corrected.toLocaleString(), { timeout: 20_000 });
    await expect(card.locator('[data-board-tile="Resolved"]'))
      .toContainText(`${after.outcomes!.resolvedAfterFix.toLocaleString()} after a correction`);
  } finally {
    await undo();
  }
});

test("the fix screen names who reviews, and the timeline says it waits on them", async ({ page }) => {
  const sales = await freshSales(4);
  const undo = await arrange(sales);
  const [open, fixed] = sales;
  // All four are arranged so the states match the first test; two are read.
  try {
    await signIn(page, USERS.admin);
    const detail = await callEdgeFunction(page, "data-center-corrections", { action: "detail", saleId: open.sale_id });
    expect(detail.status).toBe(200);
    const reviewers = (detail.body as { data: { reviewers?: { count: number; names: string[] } } }).data.reviewers;
    expect(reviewers, "the detail should say who reviews").toBeTruthy();
    expect(reviewers!.names).toContain(CALL_CENTRE);
    expect(reviewers!.names).toContain(DATA_MANAGER);
    expect(reviewers!.names).not.toContain(SUPER_ADMIN);
    expect(reviewers!.count).toBe(reviewers!.names.length);

    await page.goto(`/data-center/corrections/${open.sale_id}`);
    const next = page.locator("[data-review-next]");
    await expect(next).toBeVisible({ timeout: 30_000 });
    await expect(next).toContainText("Next, the call centre reviews it");
    await expect(next).toContainText(`any of ${reviewers!.count} reviewers`);
    await next.getByText("Who reviews").click();
    await expect(next).toContainText(CALL_CENTRE);

    await page.goto(`/data-center/corrections/${fixed.sale_id}`);
    await expect(page.getByText("Awaiting review by the call centre")).toBeVisible({ timeout: 30_000 });
  } finally {
    await undo();
  }
});
