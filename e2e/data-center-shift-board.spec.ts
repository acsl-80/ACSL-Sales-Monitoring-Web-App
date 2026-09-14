import { test, expect } from "@playwright/test";
import { signIn, USERS, branchSql, callEdgeFunction } from "./helpers";

/**
 * Phase 26, C2: the control centre as a shift board.
 *
 * The day lives in the URL; the board's rows equal the `board` read; the
 * partner card and the decisions card each carry their one verb; the partner
 * and activity pages page by cursor and export with a column picker. Checked
 * at a desk width and at 375 pixels, where nothing may cross the viewport
 * outside a scrolling table.
 */
test.describe.configure({ timeout: 240_000 });

type BoardRead = {
  day: string; today: string; range: string;
  agents: { agent_id: string; called: number; verified: number; to_call: number; presence: string }[];
  totals: { called: number; verified: number };
};

async function boardRead(page: Parameters<typeof callEdgeFunction>[0], body: Record<string, unknown> = {}) {
  const r = await callEdgeFunction(page, "data-center-assign", { action: "board", ...body });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return (r.body as { data: BoardRead }).data;
}

test("the board draws every agent the read returns, with the day's counts", async ({ page }) => {
  await signIn(page, USERS.admin);
  const read = await boardRead(page);
  await page.goto("/data-center/call-centre");
  await expect(page.getByRole("heading", { name: "Agents and their work" })).toBeVisible({ timeout: 30_000 });
  for (const a of read.agents) {
    const row = page.locator(`[data-agent-row="${a.agent_id}"]`);
    await expect(row).toBeVisible();
    await expect(row.locator("[data-presence]")).toHaveAttribute("data-presence", a.presence);
    const cells = row.locator("td");
    await expect(cells.nth(4)).toContainText(String(a.called));
    await expect(cells.nth(5)).toContainText(String(a.verified));
    await expect(cells.nth(6)).toContainText(String(a.to_call));
    await expect(row.locator("[data-track]")).toBeVisible();
  }
  // The legend and the export are there, and the table sorts by the figures.
  await expect(page.getByRole("button", { name: "Export agents" })).toBeVisible();
  await page.getByRole("button", { name: "To call" }).click();
  const first = page.locator("[data-agent-row]").first();
  const most = Math.max(...read.agents.map((a) => a.to_call));
  await expect(first.locator("td").nth(6)).toContainText(String(most));
});

test("the day chips change the day in the URL, and the board follows", async ({ page }) => {
  await signIn(page, USERS.admin);
  await page.goto("/data-center/call-centre");
  await expect(page.locator("[data-day-chips]")).toBeVisible({ timeout: 30_000 });
  // The chips know the call centre's today only once the board has answered.
  await expect(page.getByRole("button", { name: /^Today, / })).toBeEnabled({ timeout: 30_000 });
  await page.getByRole("button", { name: "Yesterday" }).click();
  await expect(page).toHaveURL(/day=\d{4}-\d{2}-\d{2}/);
  const day = new URL(page.url()).searchParams.get("day")!;
  const read = await boardRead(page, { day });
  expect(read.day).toBe(day);
  await expect(page.getByRole("button", { name: "Yesterday" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-agent-row]").first().locator("[data-now]")).toHaveCount(0);

  await page.getByRole("button", { name: "This week" }).click();
  await expect(page).toHaveURL(/range=week/);
  await expect(page.locator("[data-week]").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("columnheader", { name: "The week, by day" })).toBeVisible();

  await page.getByRole("button", { name: /^Today/ }).click();
  await expect(page).not.toHaveURL(/day=|range=/);
  await expect(page.getByRole("button", { name: /^Today/ })).toHaveAttribute("aria-pressed", "true");
});

test("the decisions card counts what needs a manager, and each verb leads somewhere", async ({ page }) => {
  await signIn(page, USERS.admin);
  await page.goto("/data-center/call-centre");
  await expect(page.getByRole("heading", { name: "Needs a decision" })).toBeVisible({ timeout: 30_000 });
  for (const label of ["Shared phone numbers, unconfirmed", "Fixed by Sales, awaiting review", "Stuck at the call limit", "Agents over capacity"]) {
    const row = page.locator(`[data-decision="${label}"]`);
    await expect(row).toBeVisible();
    await expect(row.getByRole("link").or(row.getByRole("button"))).toBeVisible();
  }
  await expect(page.locator('[data-decision="Stuck at the call limit"]').getByRole("link")).toHaveAttribute("href", /preset=exhausted/);
  const idle = page.locator('[data-decision^="Batches idle"]');
  await expect(idle).toBeVisible();
  await expect(idle.getByRole("button", { name: "Reclaim" })).toBeVisible();
});

test("the feed says what happened, and All activity opens the full page in the same window", async ({ page }) => {
  await signIn(page, USERS.admin);
  const read = await boardRead(page);
  await page.goto("/data-center/call-centre");
  await expect(page.getByRole("heading", { name: /^What happened/ })).toBeVisible({ timeout: 30_000 });
  const feed = page.locator("[data-feed]");
  await expect(feed).toBeVisible();
  const items = feed.locator("li");
  const n = await items.count();
  expect(n).toBeGreaterThan(0);
  if (read.totals.called > 0) {
    await expect(feed.locator('[data-kind="call"]').first()).toBeVisible();
  }
  const all = page.getByRole("link", { name: "All activity" });
  await expect(all).toHaveAttribute("href", /from=/, { timeout: 30_000 });
  await all.click();
  await expect(page).toHaveURL(new RegExp(`call-centre/activity\\?from=${read.day}&to=${read.day}`));
  await expect(page.getByRole("heading", { name: "Activity" }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Export activity" })).toBeVisible();
  await page.getByRole("button", { name: "Columns for activity" }).click();
  const picker = page.getByRole("dialog");
  await expect(picker.getByRole("checkbox", { name: "Stove ID" })).toBeChecked();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("link", { name: "Control centre" })).toHaveAttribute("href", /\/data-center\/call-centre$/);
});

test("the partners page lists the whole pool, filters by nobody on it, and pages by cursor", async ({ page }) => {
  const bodies: string[] = [];
  page.on("request", (req) => {
    if (req.url().includes("/functions/v1/data-center-assign")) bodies.push(req.postData() ?? "");
  });
  await signIn(page, USERS.admin);
  const [oracle] = await branchSql<{ partners: number; nobody: number }>(
    `with pool as (select distinct r.organization_id from data_center.v_callable_records r)
     select count(*)::int as partners,
            count(*) filter (where not exists (select 1 from data_center.assignment_batches b where b.organization_id = pool.organization_id and b.state = 'open'))::int as nobody
       from pool`,
  );
  await page.goto("/data-center/call-centre/partners?limit=25");
  await expect(page.getByRole("heading", { name: "Waiting, by partner" }).first()).toBeVisible({ timeout: 30_000 });
  const strip = page.locator("[data-strip]");
  await expect(strip).toContainText("partners with work");
  await expect.poll(async () => (await strip.textContent()) ?? "", { timeout: 30_000 }).toContain(String(oracle.partners));
  await expect(page.getByRole("button", { name: "Export partners" })).toBeVisible();

  await page.getByRole("button", { name: "Nobody on it" }).click();
  await expect(page).toHaveURL(/nobodyOn=true/);
  await expect.poll(() => page.locator("tbody tr").filter({ hasText: "nobody" }).count(), { timeout: 30_000 }).toBe(Math.min(25, oracle.nobody));
  for (const body of bodies.filter((b) => b.includes('"pool_partners"'))) {
    expect(body).not.toContain('"offset"');
    expect(body).not.toContain('"page"');
  }
  await expect(page.getByRole("button", { name: "Previous page" })).toBeDisabled();
});

test("nothing crosses the viewport at 375 pixels outside a scrolling table", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await signIn(page, USERS.admin);
  for (const path of ["/data-center/call-centre", "/data-center/call-centre/partners", "/data-center/call-centre/activity"]) {
    await page.goto(path);
    await expect(page.locator("main, [data-area]").first()).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1500);
    const bad = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const out: string[] = [];
      document.querySelectorAll("body *").forEach((el) => {
        const scroller = el.closest(".overflow-x-auto, .overflow-auto, [data-track]");
        if (scroller && scroller !== el) return;
        // The host's off-canvas drawer sits to the left of the viewport by
        // design; only the right edge is this page's to keep.
        if (el.closest(".fixed")) return;
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.right > vw + 1) {
          out.push(`${el.tagName.toLowerCase()}.${String(el.className).split(" ").slice(0, 2).join(".")} right=${Math.round(r.right)}`);
        }
      });
      return { vw, sw: document.documentElement.scrollWidth, out: [...new Set(out)].slice(0, 10) };
    });
    expect(bad.sw, `${path}: page scrolls sideways`).toBeLessThanOrEqual(bad.vw + 1);
    expect(bad.out, `${path}: elements past the edge`).toEqual([]);
  }
  await context.close();
});
