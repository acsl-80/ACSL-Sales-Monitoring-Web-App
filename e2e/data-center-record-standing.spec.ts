import { test, expect } from "@playwright/test";
import { signIn, USERS, branchSql, callEdgeFunction } from "./helpers";

/**
 * A record's standing, defined once (Phase 28, S1; D41).
 *
 * One SQL function says where a call record stands: never called, in
 * progress, verified, partly verified, unreachable, or with Sales. The three
 * views carry it, the partner view sums it, the registry names it, and the
 * records page narrows to it from the URL and from a preset.
 *
 * Red on main: the function, the columns, the partner view, the list and the
 * `standing` filter do not exist.
 */

test.describe.configure({ timeout: 120_000 });

test("the function answers the six standings, with Sales first", async () => {
  const rows = await branchSql<{ k: string; s: string }>(`
    select k, data_center.record_standing(v, n, c) as s from (values
      ('no record',             null::text,           null::int, null::text),
      ('record, no attempts',   'not_verified',       0,         'none'),
      ('called, not concluded', 'not_verified',       2,         'none'),
      ('verified',              'fully_verified',     1,         'none'),
      ('partly',                'partially_verified', 1,         'resolved'),
      ('unreachable',           'unreachable',        3,         'none'),
      ('open over a verdict',   'fully_verified',     1,         'open'),
      ('fixed over a verdict',  'unreachable',        3,         'fixed')
    ) as t(k, v, n, c)`);
  expect(Object.fromEntries(rows.map((r) => [r.k, r.s]))).toEqual({
    "no record": "never_called",
    "record, no attempts": "never_called",
    "called, not concluded": "in_progress",
    verified: "verified",
    partly: "partially_verified",
    unreachable: "unreachable",
    "open over a verdict": "with_sales",
    "fixed over a verdict": "with_sales",
  });
});

test("the views carry the standing and the partner view sums to the records", async () => {
  const [disagree] = await branchSql<{ n: number }>(
    `select count(*)::int as n from data_center.v_call_center c
      where c.standing is distinct from data_center.record_standing(c.verification_outcome, c.attempt_count, c.correction_state)`,
  );
  expect(Number(disagree.n)).toBe(0);

  const [resolved] = await branchSql<{ n: number; nulls: number }>(
    `select count(*)::int as n, count(*) filter (where standing is null)::int as nulls from data_center.v_call_center_resolved`,
  );
  expect(Number(resolved.n)).toBeGreaterThan(0);
  expect(Number(resolved.nulls)).toBe(0);

  const [log] = await branchSql<{ nulls: number }>(
    `select count(*) filter (where standing is null)::int as nulls from data_center.v_assignment_log`,
  );
  expect(Number(log.nulls)).toBe(0);

  const partners = await branchSql<{ organization_id: string; total: number; parts: number; counted: number; callable: number; pool: number }>(
    `select p.organization_id::text, p.total,
            (p.never_called + p.in_progress + p.verified + p.partially_verified + p.unreachable + p.with_sales)::int as parts,
            (select count(*) from data_center.v_call_center c where c.organization_id = p.organization_id and c.is_archived is not true)::int as counted,
            p.callable,
            (select count(*) from data_center.v_callable_records r where r.organization_id = p.organization_id)::int as pool
       from data_center.v_partner_standing p`,
  );
  expect(partners.length).toBeGreaterThan(0);
  for (const p of partners) {
    expect(Number(p.parts), `parts sum for ${p.organization_id}`).toBe(Number(p.total));
    expect(Number(p.total), `total for ${p.organization_id}`).toBe(Number(p.counted));
    expect(Number(p.callable), `callable for ${p.organization_id}`).toBe(Number(p.pool));
  }
});

test("the registry names the six standings and offers the two new outcomes first", async () => {
  const standings = await branchSql<{ value: string }>(
    `select value from data_center.option_values where list_key = 'record_standing' and is_active order by sort_order`,
  );
  expect(standings.map((s) => s.value)).toEqual([
    "never_called", "in_progress", "verified", "partially_verified", "unreachable", "with_sales",
  ]);
  const outcomes = await branchSql<{ value: string; sort_order: number; is_active: boolean }>(
    `select value, sort_order, is_active from data_center.option_values where list_key = 'call_outcome' order by sort_order, value`,
  );
  expect(outcomes.slice(0, 2).map((o) => o.value)).toEqual(["verified", "partially_verified"]);
  expect(outcomes.every((o) => o.is_active)).toBe(true);
  // The ten that were there before keep their order after the two.
  expect(outcomes.length).toBeGreaterThanOrEqual(12);
});

test("the records page narrows to a standing from the URL and offers the standings as presets", async ({ page }) => {
  // Arrange one unreachable record inside the queue's default period (this
  // year) through the real write path, so the page has a row to show whatever
  // the branch's seed holds; put it back afterwards.
  const [sale] = await branchSql<{ sale_id: string; version: number | null }>(
    `select c.sale_id::text, c.call_record_version as version
       from data_center.v_call_center c
      where c.is_archived is not true and c.sales_date >= date_trunc('year', now())
        and c.standing in ('never_called', 'in_progress')
      order by c.sales_date desc limit 1`,
  );
  test.skip(!sale, "no record this year on the branch");
  await signIn(page, USERS.admin);
  const arranged = await callEdgeFunction(page, "data-center-write", {
    action: "save_call_record",
    saleId: sale.sale_id,
    values: { verification_outcome: "unreachable" },
    version: sale.version,
  });
  expect(arranged.status, JSON.stringify(arranged.body).slice(0, 200)).toBe(200);

  try {
    await page.goto("/data-center/call-centre/records?standing=unreachable");
    await expect(page.getByRole("heading", { name: "Call Centre" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Narrowed to/)).toBeVisible({ timeout: 15_000 });

    const rows = page.getByRole("button", { name: /^Open call record for/ });
    await expect(rows.first()).toBeVisible({ timeout: 30_000 });
    const shown = Math.min(await rows.count(), 8);
    for (let i = 0; i < shown; i++) {
      await expect(rows.nth(i)).toContainText("Unreachable");
    }
    // The chip names the narrowing and removes it.
    await expect(page.getByRole("button", { name: "Remove filter: Unreachable" })).toBeVisible();
  } finally {
    await callEdgeFunction(page, "data-center-write", {
      action: "save_call_record",
      saleId: sale.sale_id,
      values: { verification_outcome: "not_verified" },
    });
  }

  // The presets say the six standings.
  for (const label of ["New", "In progress", "Verified", "Partly verified", "Unreachable", "With Sales"]) {
    await expect(page.getByRole("button", { name: label, exact: true })).toBeVisible();
  }
});
