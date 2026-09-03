import { test, expect, type Page } from "@playwright/test";
import { branchSql, getEdgeFunction, signIn, USERS } from "./helpers";

/**
 * Slice 10b of the 2026-09-02 review: the Agents and Partners Performance
 * Reports load in a handful of requests, and the agents' numbers are the
 * database's.
 *
 * The Agents tab hydrated its rows with two requests per agent (the agent's
 * partners through an edge function, then a count of the agent's sales) and
 * paged every stove of every assigned partner into the browser. The Partners
 * tab asked for each row's agents one row at a time. The database now answers
 * each tab in one call.
 *
 * The seed is all available stock in one partner: a sold stove must carry its
 * sale (a check constraint says so), and the sold counts come from the
 * branch's own sales.
 */

const ORG = "a0000000-0000-4000-8000-000000000001";
/** The seeded call-centre agent, assigned to every partner but the fourth. */
const AGENT = "b0000000-0000-4000-8000-000000000006";
const AGENT_NAME = "Preview Call Centre";
const TAG = "E2EAGT";
const SEED_ROWS = 1100;

test.describe.configure({ timeout: 240_000 });

function trackBackend(page: Page) {
  const calls: Array<{ url: string; body: string; at: number }> = [];
  page.on("request", (r) => {
    const url = r.url();
    if (/\.supabase\.co\/(rest|functions)\/v1\//.test(url) && !url.includes("/realtime/")) {
      calls.push({ url, body: r.postData() ?? "", at: Date.now() });
    }
  });
  return {
    calls,
    async quietFor(ms: number, limit = 90_000) {
      const started = Date.now();
      for (;;) {
        const last = calls.length ? calls[calls.length - 1].at : 0;
        if (Date.now() - last >= ms) return;
        if (Date.now() - started > limit) throw new Error("the page never went quiet");
        await page.waitForTimeout(250);
      }
    },
  };
}

const asNumber = (text: string | null) => Number(String(text ?? "").replace(/[^\d]/g, ""));

async function agentOracle() {
  const [row] = await branchSql<{ received: number; sold: number }>(
    `with direct as (
       select organization_id from public.acsl_agent_org_scope(array['${AGENT}'::uuid]) where source = 'explicit'
     )
     select (select count(*)::int from public.stove_ids_base b join direct d on d.organization_id = b.organization_id
              where b.is_archived is not true) as received,
            (select count(*)::int from public.sales s where s.created_by = '${AGENT}' and s.is_archived is not true) as sold`,
  );
  return { received: Number(row.received), sold: Number(row.sold) };
}

test.beforeAll(async () => {
  await branchSql(`delete from public.stove_ids_base where stove_id like '${TAG}%'`);
  await branchSql(
    `insert into public.stove_ids_base (stove_id, organization_id, status, factory, is_archived, sales_reference, transfer_sales_date)
     select '${TAG}' || lpad(g::text, 6, '0'), '${ORG}', 'available', 'E2E', false, '${TAG}', current_date - (g % 90)
       from generate_series(1, ${SEED_ROWS}) as g`,
  );
});

test.afterAll(async () => {
  await branchSql(`delete from public.stove_ids_base where stove_id like '${TAG}%'`);
});

function agentRow(page: Page) {
  return page.getByRole("tabpanel").locator("table tbody tr").filter({ hasText: AGENT_NAME }).first();
}

test("the Agents tab hydrates every row in one request and reads no table rows", async ({ page }) => {
  const backend = trackBackend(page);
  await signIn(page, USERS.admin);
  await page.goto("/agents");
  await expect(page.getByRole("tab", { name: "ACSL Agents Performance Report" })).toBeVisible({ timeout: 45_000 });
  await expect(agentRow(page)).toBeVisible({ timeout: 90_000 });
  // The numbers arrive after the list; the tab is done when the backend has been quiet a while.
  await backend.quietFor(3_000);

  const urls = backend.calls.map((c) => c.url);
  const perAgentOrgs = urls.filter((u) => /\/functions\/v1\/super-admin-agents\/[^/?]+\/organizations/.test(u));
  const tableReads = urls.filter((u) => /\/rest\/v1\/(stove_ids|sales)\b/.test(u));
  const reportCalls = backend.calls.filter((c) => c.url.includes("/functions/v1/performance-report") && c.body.includes('"agents"'));

  expect(perAgentOrgs.length, "no request should ask for one agent's partners at a time").toBe(0);
  expect(tableReads.length, "the tab should read no stove or sale rows into the browser").toBe(0);
  expect(reportCalls.length, "the agents' numbers should come from at most two report calls").toBeLessThanOrEqual(2);
});

test("an agent's received, sold and available are the database's", async ({ page }) => {
  const truth = await agentOracle();
  expect(truth.received, "the seed should give the agent more than a thousand stoves to collect").toBeGreaterThan(1000);

  await signIn(page, USERS.admin);
  await page.goto("/agents");
  const row = agentRow(page);
  await expect(row).toBeVisible({ timeout: 90_000 });

  await expect.poll(async () => asNumber(await row.getByTitle("Records to collect").textContent()), { timeout: 90_000 }).toBe(truth.received);
  expect(asNumber(await row.getByTitle("Records collected").textContent())).toBe(truth.sold);
  expect(asNumber(await row.getByTitle("Records not collected").textContent())).toBe(Math.max(0, truth.received - truth.sold));
});

test("the Partners tab gets the page's agents in one request", async ({ page }) => {
  const backend = trackBackend(page);
  await signIn(page, USERS.admin);
  await page.goto("/agents");
  await expect(page.getByRole("tab", { name: "Partners Performance Report" })).toBeVisible({ timeout: 45_000 });
  await backend.quietFor(2_000);

  const before = backend.calls.length;
  await page.getByRole("tab", { name: "Partners Performance Report" }).click();
  // Inactive tabs stay mounted, so only a visible row belongs to this tab.
  await expect(page.getByRole("tabpanel").locator("table tbody tr:visible").first()).toBeVisible({ timeout: 90_000 });
  await backend.quietFor(2_000);

  const tabCalls = backend.calls.slice(before);
  const perRow = tabCalls.filter((c) => /\/functions\/v1\/super-admin-agents\?[^#]*organization_id=/.test(c.url));
  const pageCalls = tabCalls.filter((c) => c.url.includes("/functions/v1/performance-report") && c.body.includes('"partner-agents"'));

  expect(perRow.length, "no request should ask for one partner's agents at a time").toBe(0);
  expect(pageCalls.length, "the page's agents should come from at most two report calls").toBeLessThanOrEqual(2);
  expect(pageCalls.length, "the page's agents should have been asked for").toBeGreaterThanOrEqual(1);
});

test("an agent's partners endpoint answers, for the modals that still ask it", async ({ page }) => {
  await signIn(page, USERS.admin);
  await page.goto("/agents");
  await expect(page.getByRole("tab", { name: "ACSL Agents Performance Report" })).toBeVisible({ timeout: 45_000 });

  const res = await getEdgeFunction(page, `super-admin-agents/${AGENT}/organizations`);
  expect(res.status, "the endpoint should answer, not throw").toBe(200);
  expect(Array.isArray((res.body as { data?: unknown })?.data), "the answer should carry the agent's partners").toBe(true);
});
