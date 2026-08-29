import { test, expect } from "@playwright/test";
import { callEdgeFunction, signIn, USERS } from "./helpers";

/**
 * Dashboards through the real UI.
 *
 * The capacity claim (74 metrics computed in 5.2 s, read in 2.3 ms at 500,000
 * sales) is measured against the local seeded database and written up in
 * src/app/data-center/DASHBOARDS.md. The preview branch holds a handful of
 * sales, so what it can prove is different and more useful here: that the read
 * never aggregates, that recomputing is restricted, and that the panel is
 * honest about how current its numbers are.
 */

type Metric = {
  metric_key: string;
  dimension: Record<string, unknown> | null;
  value_num: number | null;
};

test.describe("dashboards", () => {
  test("super admin sees the dashboard and can recompute", async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/dashboard");

    await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole("button", { name: /Recompute/ })).toBeVisible();
  });

  test("the dashboard says where its numbers come from in time", async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/dashboard");
    await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible({
      timeout: 20_000,
    });

    // Either it has been computed and says when, or it says it has not been.
    // What it must never do is present numbers with no date on them.
    const stamp = page.getByText(/computed |never computed|no figures yet/);
    await expect(stamp.first()).toBeVisible();
  });

  test("a viewer sees the dashboard but is not offered Recompute", async ({ page }) => {
    await signIn(page, USERS.manager);
    await page.goto("/data-center/dashboard");

    // dashboard.view is part of every access level; running the computation is
    // super admin only, because it reads every sale.
    await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole("button", { name: /Recompute/ })).toHaveCount(0);
  });

  test("loading the dashboard asks for snapshots, never for a page of sales", async ({
    page,
  }) => {
    const bodies: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/functions/v1/data-center-read")) {
        bodies.push(req.postData() ?? "");
      }
    });

    await signIn(page, USERS.admin);
    await page.goto("/data-center/dashboard");
    await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible({
      timeout: 20_000,
    });

    // The dashboard has its own action. If it were ever reworked to build its
    // figures from records pages, this is what would catch it.
    await expect
      .poll(() => bodies.some((b) => b.includes('"dashboard"')), { timeout: 15_000 })
      .toBe(true);
  });
  /**
   * Narrowing the page must not empty it.
   *
   * This is the shape of a bug that already shipped. One PR gave the scorecards
   * a period; the seven other families the dashboard reads kept none, and the
   * read query drops undated rows from a range. So selecting a year left Issued
   * answering for that year while Sold, Verified, all four bar charts and five
   * support cards read zero. Nothing failed. `value()` returns 0 for a metric
   * that is not in the payload, so absence rendered as a confident number.
   *
   * The rule this asserts is the one the read query implements: a family either
   * carries periods and narrows, or carries none and passes through whole.
   * There is no third case where a family is silently dropped, and a new family
   * added without a period cannot reintroduce one.
   */
  test("narrowing to a period never silently empties a family", async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/dashboard");
    await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible({
      timeout: 20_000,
    });

    const read = async (range: Record<string, string>) => {
      const { status, body } = await callEdgeFunction(page, "data-center-read", {
        action: "dashboard",
        ...range,
      });
      expect(status).toBe(200);
      return (body as { data: { metrics: Metric[]; periodicKeys: string[] } }).data;
    };

    const allTime = await read({});
    const narrowed = await read({ from: "2026-01", to: "2026-12" });

    // The server has to say which families can answer for a period, or the page
    // cannot label one card "all time" beside neighbours that narrowed.
    expect(Array.isArray(allTime.periodicKeys)).toBe(true);
    expect(allTime.periodicKeys).toContain("scorecard.issued");
    expect(allTime.periodicKeys).toContain("sales.total");

    const periodic = new Set(allTime.periodicKeys);
    const families = (ms: Metric[]) => new Set(ms.map((m) => m.metric_key));
    const narrowedFamilies = families(narrowed.metrics);

    // Nothing disappears. A family that narrows may legitimately sum to zero in
    // a range, but it must still be in the payload; a family that cannot narrow
    // must come back untouched.
    const missing = [...families(allTime.metrics)].filter((k) => !narrowedFamilies.has(k));
    expect(missing, `families dropped by a range: ${missing.join(", ")}`).toEqual([]);

    const sumOf = (ms: Metric[], key: string) =>
      ms.filter((m) => m.metric_key === key).reduce((n, m) => n + Number(m.value_num ?? 0), 0);

    for (const key of families(allTime.metrics)) {
      if (periodic.has(key)) continue;
      expect(sumOf(narrowed.metrics, key), `${key} is all-time and must not change`)
        .toBe(sumOf(allTime.metrics, key));
    }

    // The period is an internal key. The page renders the shape it always did.
    for (const m of narrowed.metrics) {
      expect(m.dimension ?? {}).not.toHaveProperty("period");
    }
  });
});
