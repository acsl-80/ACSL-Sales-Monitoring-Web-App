import { test, expect, type Page } from "@playwright/test";
import { branchSql, signIn, USERS } from "./helpers";

/**
 * Slice 11c of the 2026-09-02 review (finding F7): the Agents Performance
 * Report's chart asks once.
 *
 * The "Records Collected" chart paged the agent roster through three role
 * loops, read the sales table twice per two hundred agents, and bucketed the
 * rows by month in the browser with no regard to the year. The database now
 * answers one year in one call, and the month's bar is the database's count.
 */

const ORG = "a0000000-0000-4000-8000-000000000001";
/** The seeded call-centre agent, an acsl_agent. */
const AGENT = "b0000000-0000-4000-8000-000000000006";
const TAG = "E2ECHT";
const SEED_ROWS = 40;

test.describe.configure({ timeout: 180_000 });

function trackBackend(page: Page) {
  const calls: Array<{ url: string; body: string; at: number }> = [];
  let lastActivity = 0;
  const isBackend = (url: string) => /\.supabase\.co\/(rest|functions)\/v1\//.test(url) && !url.includes("/realtime/");
  page.on("request", (r) => {
    if (isBackend(r.url())) {
      lastActivity = Date.now();
      calls.push({ url: r.url(), body: r.postData() ?? "", at: lastActivity });
    }
  });
  page.on("response", (r) => {
    if (isBackend(r.url())) lastActivity = Date.now();
  });
  return {
    calls,
    async quietFor(ms: number, limit = 90_000) {
      const started = Date.now();
      for (;;) {
        if (Date.now() - lastActivity >= ms) return;
        if (Date.now() - started > limit) throw new Error("the page never went quiet");
        await page.waitForTimeout(250);
      }
    },
  };
}

test.beforeAll(async () => {
  await branchSql(`delete from public.sales where transaction_id like '${TAG}%'`);
  await branchSql(
    `insert into public.sales (
       transaction_id, stove_serial_no, sales_date, end_user_name, phone, contact_person, contact_phone,
       partner_name, retailer_branch, state_backup, lga_backup, amount, total_paid, is_installment,
       payment_status, organization_id, created_by, platform)
     select '${TAG}' || lpad(g::text, 5, '0'), '${TAG}' || lpad(g::text, 6, '0'),
            (now() at time zone 'Africa/Lagos')::date,
            'E2E Chart Buyer ' || g, '0803' || lpad(g::text, 7, '0'), 'E2E Chart Contact', '0803' || lpad(g::text, 7, '0'),
            o.partner_name, o.branch, o.state, 'E2E', 43000, 43000, false, 'fully_paid', o.id, '${AGENT}', 'web'
       from generate_series(1, ${SEED_ROWS}) as g
       cross join public.organizations o
      where o.id = '${ORG}'`,
  );
});

test.afterAll(async () => {
  await branchSql(`delete from public.sales where transaction_id like '${TAG}%'`);
});

test("the chart asks once and its month is the database's count", async ({ page }) => {
  const [truth] = await branchSql<{ n: number; y: number; m: number }>(
    `with agents as (select id from public.profiles where role in ('acsl_agent','acsl_agent_manager','super_admin_agent')),
          records as (select distinct s.id, coalesce(s.sales_date, (s.created_at at time zone 'Africa/Lagos')::date) as on_day
                        from public.sales s where s.is_archived is not true
                         and (s.created_by in (select id from agents) or s.sold_on_behalf_of in (select id from agents)))
     select count(*)::int as n,
            extract(year from (now() at time zone 'Africa/Lagos'))::int as y,
            extract(month from (now() at time zone 'Africa/Lagos'))::int as m
       from records
      where extract(year from on_day) = extract(year from (now() at time zone 'Africa/Lagos'))
        and extract(month from on_day) = extract(month from (now() at time zone 'Africa/Lagos'))`,
  );
  expect(Number(truth.n), "the seed should give this month more than the forty it planted").toBeGreaterThanOrEqual(SEED_ROWS);

  const backend = trackBackend(page);
  await signIn(page, USERS.admin);
  await page.goto("/agents");
  await expect(page.getByRole("tab", { name: "ACSL Agents Performance Report" })).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText("Records Collected").first()).toBeVisible({ timeout: 45_000 });
  await backend.quietFor(3_000);

  const urls = backend.calls.map((c) => c.url);
  const salesReads = urls.filter((u) => /\/rest\/v1\/sales\?[^#]*(created_by|sold_on_behalf_of)=in\./.test(u));
  const rosterLoops = urls.filter((u) => /\/functions\/v1\/manage-users\?[^#]*role=super_admin_agent/.test(u));
  const chartCalls = backend.calls.filter((c) => c.url.includes("/functions/v1/performance-report") && c.body.includes('"agent-records"'));

  expect.soft(salesReads.length, "the chart should read no sale rows into the browser").toBe(0);
  expect.soft(rosterLoops.length, "the chart should not page the roster through role loops").toBe(0);
  expect.soft(chartCalls.length, "the chart should come from one report call").toBe(1);

  // The month's bar carries its value as a label; this month's label is the database's count.
  const chart = page.locator("svg.recharts-surface").first();
  await expect(chart).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(async () => (await chart.locator("text").allTextContents()).map((t) => t.trim()).includes(String(truth.n)), {
      timeout: 30_000,
    })
    .toBe(true);
});
