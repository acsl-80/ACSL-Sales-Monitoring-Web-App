import fs from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { branchSql, signIn, USERS } from "./helpers";

/**
 * Slice 10a of the 2026-09-02 review: the States Performance Report loads in
 * a handful of requests, and its numbers are the database's.
 *
 * The report pulled every stove and every sale into the browser a thousand
 * rows at a time, paged every user through six role loops, probed two
 * assignment tables column by column, and joined it all in JavaScript. With
 * 1,100 stoves seeded on top of the branch that is some forty requests before
 * the first row. The database now computes the report in one call and pages
 * the stove modal in another, so the tab costs a handful of requests at any
 * volume, and the stove export walks the server page by page.
 *
 * The seed is all available stock: a sold stove must carry its sale (a check
 * constraint says so), and the sold count comes from the branch's own sales.
 */

const ORG = "a0000000-0000-4000-8000-000000000001";
const STATE = "Gombe";
const TAG = "E2ESTV";
const SEED_ROWS = 1100;

test.describe.configure({ timeout: 240_000 });

/** Requests to the branch's REST and function endpoints, timestamped. */
function trackBackend(page: Page) {
  const calls: Array<{ url: string; at: number }> = [];
  page.on("request", (r) => {
    const url = r.url();
    if (/\.supabase\.co\/(rest|functions)\/v1\//.test(url) && !url.includes("/realtime/")) {
      calls.push({ url, at: Date.now() });
    }
  });
  return {
    calls,
    /** Resolves once no backend request has been made for `ms`. */
    async quietFor(ms: number, limit = 60_000) {
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

const rowsInCsv = (csv: string) => (csv.match(new RegExp(`${TAG}\\d{6}(?!\\d)`, "g")) ?? []).length;
const asNumber = (text: string | null) => Number(String(text ?? "").replace(/[^\d]/g, ""));

async function oracle() {
  const [row] = await branchSql<{ partners: number; stoves: number; sold: number }>(
    `select (select count(*)::int from public.organizations o where btrim(o.state) = '${STATE}') as partners,
            (select count(*)::int from public.stove_ids_base b join public.organizations o on o.id = b.organization_id
              where btrim(o.state) = '${STATE}' and b.is_archived is not true) as stoves,
            (select count(*)::int from public.stove_ids_base b join public.organizations o on o.id = b.organization_id
              where btrim(o.state) = '${STATE}' and b.is_archived is not true and b.status = 'sold') as sold`,
  );
  return { partners: Number(row.partners), stoves: Number(row.stoves), sold: Number(row.sold) };
}

async function openStatesTab(page: Page) {
  await signIn(page, USERS.admin);
  await page.goto("/agents");
  await expect(page.getByRole("tab", { name: "States Performance Report" })).toBeVisible({ timeout: 45_000 });
}

function stateRow(page: Page) {
  return page.getByRole("tabpanel").locator("table tbody tr").filter({ hasText: STATE }).first();
}

test.beforeAll(async () => {
  await branchSql(`delete from public.stove_ids_base where stove_id like '${TAG}%'`);
  await branchSql(
    `insert into public.stove_ids_base (stove_id, organization_id, status, factory, is_archived, sales_reference, transfer_sales_date)
     select '${TAG}' || lpad(g::text, 6, '0'), '${ORG}',
            'available',
            'E2E', false, '${TAG}', current_date - (g % 90)
       from generate_series(1, ${SEED_ROWS}) as g`,
  );
});

test.afterAll(async () => {
  await branchSql(`delete from public.stove_ids_base where stove_id like '${TAG}%'`);
});

test("the States tab loads in a handful of requests and reads no table rows", async ({ page }) => {
  const backend = trackBackend(page);
  await openStatesTab(page);
  // Let the first tab finish whatever it loads, so what follows is the States tab alone.
  await backend.quietFor(2_000);

  const before = backend.calls.length;
  await page.getByRole("tab", { name: "States Performance Report" }).click();
  await expect(stateRow(page)).toBeVisible({ timeout: 120_000 });
  await backend.quietFor(1_500);

  const tabCalls = backend.calls.slice(before).map((c) => c.url);
  const tableReads = tabCalls.filter((u) => /\/rest\/v1\/(stove_ids|sales|super_admin_agent_organizations|acsl_agent_organizations)\b/.test(u));
  const userLoops = tabCalls.filter((u) => u.includes("/functions/v1/manage-users"));

  expect(tableReads.length, "the tab should read no stove or sale rows into the browser").toBe(0);
  expect(userLoops.length, "the tab should not page users through role loops").toBe(0);
  expect(tabCalls.length, `the tab should cost a handful of requests, it made ${tabCalls.length}`).toBeLessThanOrEqual(6);
});

test("the state's numbers are the database's", async ({ page }) => {
  const truth = await oracle();
  expect(truth.stoves, "the seed should put more than a thousand stoves in the state").toBeGreaterThan(1000);

  await openStatesTab(page);
  await page.getByRole("tab", { name: "States Performance Report" }).click();
  const row = stateRow(page);
  await expect(row).toBeVisible({ timeout: 120_000 });

  const cells = row.locator("td");
  // State, Partners, Agents, Stoves, Sold, Not Sold, Sell-through.
  await expect.poll(async () => asNumber(await cells.nth(3).textContent()), { timeout: 30_000 }).toBe(truth.stoves);
  expect(asNumber(await cells.nth(1).textContent())).toBe(truth.partners);
  expect(asNumber(await cells.nth(4).textContent())).toBe(truth.sold);
  expect(asNumber(await cells.nth(5).textContent())).toBe(truth.stoves - truth.sold);
});

test("the stove modal pages on the server and its export holds every stove", async ({ page }) => {
  const truth = await oracle();
  const backend = trackBackend(page);

  await openStatesTab(page);
  await page.getByRole("tab", { name: "States Performance Report" }).click();
  const row = stateRow(page);
  await expect(row).toBeVisible({ timeout: 120_000 });

  await row.getByTitle("View stove IDs in this state").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(new RegExp(`of\\s+${truth.stoves.toLocaleString("en-US")}`))).toBeVisible({ timeout: 60_000 });

  const stoveRows = dialog.locator("table tbody tr");
  await expect.poll(async () => stoveRows.count(), { timeout: 30_000 }).toBeLessThanOrEqual(100);

  const before = backend.calls.length;
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 120_000 }),
    dialog.getByRole("button", { name: /Export/ }).click(),
  ]);
  const path = await download.path();
  expect(path, "the browser should have received a file").toBeTruthy();
  const csv = fs.readFileSync(path as string, "utf8");
  expect(rowsInCsv(csv), "every seeded stove should be in the file").toBe(SEED_ROWS);

  const exportCalls = backend.calls.slice(before).filter((c) => c.url.includes("/functions/v1/performance-report"));
  expect(exportCalls.length, "the export should have walked the server in pages of five hundred").toBeGreaterThanOrEqual(3);
});
