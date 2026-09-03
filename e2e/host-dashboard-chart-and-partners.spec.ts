import { test, expect } from "@playwright/test";
import { branchSql, callEdgeFunction, signIn, USERS } from "./helpers";

/**
 * Slice 6b of the 2026-09-02 review: the chart and the list.
 *
 * Three things, each asserted against the old code first.
 *
 * The monthly chart. The dashboard asked get-sales-advanced for five thousand
 * sales, received at most five hundred (the function clamps), and counted
 * those by month in the browser. It now draws the month rows the dashboard
 * functions return from SQL. Against the old code the page still asks for the
 * sales and the function has no month rows.
 *
 * The partner list. get-organizations-grouped fetched every organisation and
 * grouped, sorted and paged them in TypeScript; an unranged select stops at
 * 1,000 rows. With 1,100 seeded organisations the old code reports fewer
 * groups than exist; the new one groups them in SQL and counts them all.
 *
 * The cache. The numbers now live under React Query with the app's one-minute
 * stale time. Leaving the dashboard and coming back within that minute shows
 * the same numbers without a new round trip; the old code fetched on every
 * mount.
 */

const TAG = "E2E Group";
const SEED_ORGS = 1100;
const YEAR = new Date().getUTCFullYear();
const ALL_YEARS = Array.from({ length: YEAR - 2023 }, (_, i) => 2024 + i);

test.describe.configure({ timeout: 240_000 });

test.describe("slice 6b: the chart and the list", () => {
  test("the monthly chart is drawn from the dashboard's own month rows, not from a capped sales fetch", async ({
    page,
  }) => {
    const calls: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/functions/v1/")) calls.push(r.url());
    });

    await signIn(page, USERS.admin);
    await page.goto("/dashboard");
    await expect(page.getByText("TOTAL SALES", { exact: true })).toBeVisible({ timeout: 45_000 });
    await expect(page.getByText("Monthly Sales", { exact: true })).toBeVisible();
    // One point per month drawn: the chart received twelve buckets.
    await expect(page.locator(".recharts-line-dot")).toHaveCount(12, { timeout: 15_000 });

    expect(
      calls.filter((u) => u.includes("get-sales-advanced")),
      "the chart must not ask for a page of sales; the numbers come with the dashboard",
    ).toHaveLength(0);

    const r = await callEdgeFunction(page, "get-super-admin-dashboard", { years: ALL_YEARS });
    expect(r.status).toBe(200);
    const d = (r.body as any)?.data ?? {};
    expect(Array.isArray(d.salesByMonth), "the function should return month rows").toBe(true);
    const sum = (d.salesByMonth as any[]).reduce((s, x) => s + (Number(x?.count) || 0), 0);
    expect(sum, "the month rows should sum to the period's total").toBe(Number(d.stovesSoldToEndUsers));
    for (const row of d.salesByMonth as any[]) expect(String(row.month)).toMatch(/^\d{4}-\d{2}$/);
  });

  test("the partner list groups and counts every organisation, past the thousandth row", async ({ page }) => {
    const [{ partner_type }] = await branchSql<{ partner_type: string }>(
      `select partner_type from public.organizations where partner_type is not null limit 1`,
    );
    await branchSql(`delete from public.organizations where partner_name like '${TAG}%'`);
    // 1,100 organisations in 1,050 groups: every 22nd shares its name with
    // the one before it, as a second branch, so grouping is exercised too.
    await branchSql(
      `insert into public.organizations
         (partner_name, state, branch, contact_person, contact_phone, address, partner_type)
       select '${TAG} ' || lpad((case when g % 22 = 0 then g - 1 else g end)::text, 4, '0'),
              'Kano',
              case when g % 22 = 0 then 'Second' else 'Main Branch' end,
              'E2E Contact', '0800' || lpad(g::text, 7, '0'), 'E2E', '${partner_type}'
         from generate_series(1, ${SEED_ORGS}) as g`,
    );
    try {
      const [truth] = await branchSql<{ groups: number; orgs: number }>(
        `select count(distinct lower(btrim(partner_name)))::int as groups, count(*)::int as orgs
           from public.organizations where partner_name like '${TAG}%'`,
      );
      expect(Number(truth.orgs)).toBe(SEED_ORGS);
      expect(Number(truth.groups)).toBeGreaterThan(1000);

      await signIn(page, USERS.admin);
      const first = await callEdgeFunction(
        page,
        "get-organizations-grouped",
        {},
        `?search=${encodeURIComponent(TAG)}&page_size=200&page=1`,
      );
      expect(first.status).toBe(200);
      const body = first.body as any;
      expect(
        Number(body?.pagination?.total_count),
        "every group should be counted, not the first thousand rows' worth",
      ).toBe(Number(truth.groups));
      expect(Number(body?.pagination?.total_pages)).toBe(Math.ceil(Number(truth.groups) / 200));
      const rows: any[] = body?.data ?? [];
      expect(rows.length).toBe(200);
      const names = rows.map((g) => String(g.base_name));
      expect([...names].sort((a, b) => a.localeCompare(b)), "the page is sorted by name").toEqual(names);
      for (const g of rows) expect(g.branch_count, `${g.base_name} branch_count`).toBe(g.branches.length);
      const twoBranches = rows.find((g) => g.base_name === `${TAG} 0021`);
      expect(twoBranches?.branch_count, "a shared name rolls up as one group with two branches").toBe(2);
      expect(twoBranches?.branches.map((b: any) => b.branch).sort()).toEqual(["Main Branch", "Second"]);

      const last = await callEdgeFunction(
        page,
        "get-organizations-grouped",
        {},
        `?search=${encodeURIComponent(TAG)}&page_size=200&page=${Math.ceil(Number(truth.groups) / 200)}`,
      );
      expect((last.body as any)?.data?.length, "the last page holds the remainder").toBe(
        Number(truth.groups) % 200 || 200,
      );
    } finally {
      await branchSql(`delete from public.organizations where partner_name like '${TAG}%'`);
    }
  });

  test("coming back to the dashboard within a minute shows its numbers without a new round trip", async ({
    page,
  }) => {
    let statsCalls = 0;
    page.on("request", (r) => {
      if (r.url().includes("/functions/v1/get-super-admin-dashboard")) statsCalls += 1;
    });

    await signIn(page, USERS.admin);
    await page.goto("/dashboard");
    await expect(page.getByText("TOTAL SALES", { exact: true })).toBeVisible({ timeout: 45_000 });
    // The baseline is taken once the requests have gone quiet. A first load
    // can fetch more than once, and a count taken between two of those
    // fetches made this test pass against code that fetched on every mount.
    let loaded = statsCalls;
    for (let quiet = 0; quiet < 3; ) {
      await page.waitForTimeout(1000);
      if (statsCalls === loaded) quiet += 1;
      else { loaded = statsCalls; quiet = 0; }
    }
    expect(loaded).toBeGreaterThan(0);

    // Away and back through the app's own navigation; a reload would empty
    // the cache, which is not the case being tested.
    const records = page.getByRole("link", { name: "Sales Records" });
    if (!(await records.isVisible())) await page.getByText("Manage Sales", { exact: true }).click();
    await records.click();
    await page.waitForURL(/\/sales(\?|$)/, { timeout: 30_000 });
    await page.waitForTimeout(1000);
    await page.getByRole("link", { name: "Dashboard", exact: true }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
    await expect(page.getByText("TOTAL SALES", { exact: true })).toBeVisible({ timeout: 45_000 });
    await page.waitForTimeout(3000);

    expect(statsCalls, "the cached numbers should be shown; no new fetch inside the stale window").toBe(loaded);
  });
});
