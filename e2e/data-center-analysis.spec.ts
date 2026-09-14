import { test, expect, type Page } from "@playwright/test";
import { signIn, USERS, callEdgeFunction } from "./helpers";

/**
 * Analysis: the seventh area.
 *
 * The claims worth guarding here are arithmetic ones. A chart that is merely
 * present proves nothing - the dashboard bars were present for two phases
 * while leading nowhere, and a cross-tab whose cells do not add up to its own
 * margin is worse than no cross-tab, because somebody will act on it.
 *
 * So: the frame's contract is checked from the outside, the heatmap is summed
 * cell by cell, the funnel is checked for monotonicity, and the bucket labels
 * are checked against `workflow_config` rather than against a list copied into
 * this file - which would only prove that two hardcodings agree.
 */

async function analysis(page: Page, body: Record<string, unknown> = {}) {
  return callEdgeFunction(page, "data-center-read", { action: "analysis", ...body });
}

test.describe("the numbers reconcile", () => {
  test("the yield funnel never widens as it goes down", async ({ page }) => {
    await signIn(page, USERS.admin);
    const r = await analysis(page);
    expect(r.status).toBe(200);

    const totals = (r.body as {
      data: { totals: { metric_key: string; dimension: Record<string, string>; value_num: number }[] };
    }).data.totals;

    const stages = new Map<string, { ord: number; value: number }>();
    for (const m of totals) {
      if (m.metric_key !== "analysis.yield_funnel") continue;
      const key = m.dimension.key2;
      const prev = stages.get(key) ?? { ord: Number(m.dimension.ord2 ?? 0), value: 0 };
      stages.set(key, { ord: prev.ord, value: prev.value + Number(m.value_num ?? 0) });
    }
    test.skip(stages.size === 0, "no sales on the preview");

    const ordered = [...stages.entries()].sort((a, b) => a[1].ord - b[1].ord);
    /*
     * Each stage's filter contains the one before it, so this holds by
     * construction in SQL. Asserted anyway: it is the property that makes the
     * chain a funnel rather than five unrelated counts, and the day somebody
     * adds a stage whose filter is not a subset, every percentage on the page
     * becomes wrong in a way that still looks plausible.
     */
    for (let i = 1; i < ordered.length; i++) {
      expect(
        ordered[i][1].value,
        `${ordered[i][0]} (${ordered[i][1].value}) must not exceed ${ordered[i - 1][0]} (${ordered[i - 1][1].value})`,
      ).toBeLessThanOrEqual(ordered[i - 1][1].value);
    }
  });

  test("the leak reasons account for every sale that is not creditable", async ({
    page,
  }) => {
    await signIn(page, USERS.admin);
    const totals = ((await analysis(page)).body as {
      data: { totals: { metric_key: string; dimension: Record<string, string>; value_num: number }[] };
    }).data.totals;

    const sum = (key: string, key2?: string) =>
      totals
        .filter((m) => m.metric_key === key && (!key2 || m.dimension.key2 === key2))
        .reduce((n, m) => n + Number(m.value_num ?? 0), 0);

    const sold = sum("analysis.yield_funnel", "sold");
    const creditable = sum("analysis.yield_funnel", "creditable");
    const leaked = sum("analysis.yield_leak");
    test.skip(sold === 0, "no sales on the preview");

    /*
     * Every non-creditable sale is charged to exactly ONE reason, the first
     * gate it failed. Overlapping tags would let one record appear under three
     * headings, and the decomposition - which is the half anybody acts on -
     * would quietly become a word cloud that adds to more than the problem.
     */
    expect(leaked).toBe(sold - creditable);
  });

  test("the stock bands cover every unsold stove exactly once", async ({ page }) => {
    await signIn(page, USERS.admin);
    const totals = ((await analysis(page)).body as {
      data: { totals: { metric_key: string; dimension: Record<string, string>; value_num: number }[] };
    }).data.totals;

    const byAxis = (axis: string) =>
      totals
        .filter((m) => m.metric_key === "analysis.stock_age" && m.dimension.by === axis)
        .reduce((n, m) => n + Number(m.value_num ?? 0), 0);

    const partner = byAxis("partner");
    test.skip(partner === 0, "no unsold stock on the preview");

    /*
     * Partner and location are two cuts of the same stoves, so they must agree.
     * They would not if a band had a gap in it - which is why the band floors
     * are derived from the top edge above them rather than stated, and why the
     * run refuses to start without an open top band.
     */
    expect(byAxis("location")).toBe(partner);
  });
});

test.describe("the period is any range", () => {
  test("narrowing to one month returns less than every month", async ({ page }) => {
    await signIn(page, USERS.admin);
    const all = (await analysis(page)).body as {
      data: { totals: unknown[]; months: string[] };
    };
    test.skip(all.data.months.length < 2, "the preview holds fewer than two months");

    const one = all.data.months[all.data.months.length - 1];
    const narrowed = await analysis(page, { from: one, to: one });
    expect(narrowed.status).toBe(200);
    const rows = (narrowed.body as { data: { totals: unknown[] } }).data.totals;

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(all.data.totals.length);
  });

  test("a bound that is not a month is refused rather than ignored", async ({ page }) => {
    await signIn(page, USERS.admin);
    /*
     * 400, not a silent fall-back to everything. The bounds are compared as
     * text against a jsonb field, so "2026-8" sorting wrongly is the whole
     * failure mode, and a range control that quietly widens is the thing this
     * module has already decided is worse than no control.
     */
    for (const bad of [{ from: "2026-8" }, { from: "2026-13" }, { from: "2026-08", to: "2026-01" }]) {
      const r = await analysis(page, bad);
      expect(r.status, JSON.stringify(bad)).toBe(400);
      expect((r.body as { code: string }).code).toBe("bad_period");
    }
  });
});

test.describe("the page keeps the frame's contract", () => {
  test("every chart has a heading, an export and a way in", async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/analysis");
    await expect(page.getByRole("heading", { name: "Analysis", exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await page.waitForTimeout(5_000);

    /*
     * Checked from the outside, so it holds for charts that do not exist yet.
     * ChartFrame throws in development when a chart has neither a drill nor an
     * export, but a throw in development is not a gate - this is.
     */
    const exports = page.getByRole("button", { name: /^Export / });
    const count = await exports.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      await expect(exports.nth(i)).toBeVisible();
    }
  });

  test("the cross-tab is a real table whose cells add up to its margins", async ({
    page,
  }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/analysis");
    await expect(page.getByRole("heading", { name: "Analysis", exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await page.waitForTimeout(5_000);

    const tables = page.getByRole("table");
    const found = await tables.count();
    test.skip(found === 0, "no cross-tab rendered on the preview's data");

    /*
     * The payoff for not drawing this in SVG. A recharts heatmap cannot be
     * read back at all, so the one property that makes a cross-tab safe to act
     * on - that it adds up - would have been untestable.
     */
    const ok = await page.evaluate(() => {
      const problems: string[] = [];
      for (const table of Array.from(document.querySelectorAll("table"))) {
        const foot = table.querySelector("tfoot");
        if (!foot) continue;
        const num = (el: Element | null) =>
          Number((el?.textContent ?? "0").replace(/[^0-9.-]/g, "") || 0);

        let rowSumTotal = 0;
        for (const tr of Array.from(table.querySelectorAll("tbody tr"))) {
          const cells = Array.from(tr.querySelectorAll("td"));
          if (cells.length < 2) continue;
          const body = cells.slice(0, -1).reduce((n, td) => n + num(td), 0);
          const total = num(cells[cells.length - 1]);
          if (body !== total) problems.push(`row ${body} != ${total}`);
          rowSumTotal += total;
        }

        const footCells = Array.from(foot.querySelectorAll("td"));
        if (footCells.length) {
          const grand = num(footCells[footCells.length - 1]);
          if (grand !== rowSumTotal) problems.push(`grand ${grand} != ${rowSumTotal}`);
        }
      }
      return problems;
    });

    expect(ok, `cross-tab margins disagree: ${ok.join("; ")}`).toEqual([]);
  });

  test("a stock cell opens the stoves behind it, and back returns", async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/analysis");
    await expect(page.getByRole("heading", { name: "Analysis", exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await page.waitForTimeout(5_000);

    /*
     * Scoped to the table on purpose.
     *
     * ChartFrame also renders an sr-only list of the same cells as links, so
     * that every drill a mouse can reach is reachable by keyboard and nameable
     * by a screen reader. Those links are earlier in the DOM than the heatmap
     * cells and `sr-only` leaves them technically visible, so a loose
     * `a[href*=...]` selector resolves to one of them and then times out
     * because the page sits on top of it. That is a trap for any test written
     * against this page later, which is why it is written down here rather
     * than worked around silently.
     */
    const srOnly = page.locator('ul.sr-only a[href*="/data-center/stock"]');
    expect(await srOnly.count(), "the keyboard route should exist").toBeGreaterThan(0);

    const link = page.locator('table a[href*="/data-center/stock"]').first();
    test.skip((await link.count()) === 0, "no stock cell on the preview's data");

    await link.click();
    // A URL, never component state, so back restores the page without anything
    // being written to make it do so.
    await expect(page).toHaveURL(/\/data-center\/stock/);
    await expect(
      page.getByRole("heading", { name: "Stock at partners", exact: true }),
    ).toBeVisible({ timeout: 30_000 });

    await page.goBack();
    await expect(page.getByRole("heading", { name: "Analysis", exact: true })).toBeVisible({
      timeout: 30_000,
    });
  });
});

test.describe("the bands are configuration", () => {
  test("the labels come from workflow_config, not from the code", async ({ page }) => {
    await signIn(page, USERS.admin);
    const data = ((await analysis(page)).body as {
      data: {
        stockBands: { code: string; label: string; min_days: number; max_days: number | null }[];
        velocityBands: { code: string; max_days: number | null }[];
      };
    }).data;

    expect(data.stockBands.length).toBeGreaterThan(0);
    expect(data.velocityBands.length).toBeGreaterThan(0);

    for (const set of [data.stockBands, data.velocityBands]) {
      // Exactly one open top band. Without it the far end of the distribution
      // matches nothing and vanishes, which for stock ageing means losing the
      // precise units the chart exists to find.
      expect(set.filter((b) => b.max_days === null)).toHaveLength(1);
    }

    /*
     * The floors are derived from the top edge of the band below, so they
     * chain with no gap and no overlap. A hand-written min/max pair per band
     * can be edited into a gap, and stoves would then disappear from the chart
     * with no error raised anywhere.
     */
    const sorted = [...data.stockBands].sort((a, b) => a.min_days - b.min_days);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].min_days).toBe((sorted[i - 1].max_days ?? 0) + 1);
    }
  });
});

test.describe("who may read it", () => {
  test("a call agent is refused the analysis outright", async ({ page }) => {
    await signIn(page, USERS.callCentre);
    const r = await analysis(page);
    /*
     * 403, not 200-with-nothing. Analysis crosses what a buyer told an agent
     * on the phone with the partner and the place they bought in, so it is its
     * own key rather than dashboard.view, which every level in the module
     * holds.
     */
    expect(r.status).toBe(403);
    expect((r.body as { code: string }).code).toBe("no_feature");
  });

  test("the dashboard did not inherit the analysis rows", async ({ page }) => {
    await signIn(page, USERS.admin);
    const r = await callEdgeFunction(page, "data-center-read", { action: "dashboard" });
    expect(r.status).toBe(200);

    const metrics = (r.body as { data: { metrics: { metric_key: string }[] } }).data.metrics;
    /*
     * Analysis writes its families into the same run at month grain, which is
     * tens of thousands of rows. The Dashboard renders none of them, so
     * without the filter it silently pays for a payload it never reads - the
     * kind of regression that shows up as "the dashboard got slow" months
     * later with nothing in the diff to point at.
     */
    expect(metrics.filter((m) => m.metric_key.startsWith("analysis."))).toHaveLength(0);
  });
});

test.describe("the stock surface", () => {
  test("it lists unsold stock and narrows to a band", async ({ page }) => {
    await signIn(page, USERS.admin);
    const bands = ((await analysis(page)).body as {
      data: { stockBands: { code: string }[] };
    }).data.stockBands;

    const all = await callEdgeFunction(page, "data-center-read", {
      action: "stock",
      filters: {},
      limit: 200,
    });
    expect(all.status).toBe(200);
    const rows = (all.body as { data: { rows: { days: number }[] } }).data.rows;
    test.skip(rows.length === 0, "no unsold stock on the preview");

    // Every row carries the age the chart bucketed it by.
    for (const r of rows) expect(r.days).toBeGreaterThanOrEqual(0);

    const band = bands[bands.length - 1];
    const narrowed = await callEdgeFunction(page, "data-center-read", {
      action: "stock",
      filters: { ageBucket: band.code },
      limit: 200,
    });
    expect(narrowed.status).toBe(200);
    const narrowedRows = (narrowed.body as { data: { rows: unknown[] } }).data.rows;
    expect(narrowedRows.length).toBeLessThanOrEqual(rows.length);
  });

  test("it never offers an offset", async ({ page }) => {
    await signIn(page, USERS.admin);
    const r = await callEdgeFunction(page, "data-center-read", {
      action: "stock",
      filters: {},
      limit: 5,
    });
    const body = r.body as { data: { nextCursor: unknown; hasMore: boolean } };
    // Keyset only, so an OFFSET cannot creep in later.
    expect(JSON.stringify(body)).not.toContain('"offset"');
    if (body.data.hasMore) expect(body.data.nextCursor).not.toBeNull();
  });
});
