import { test, expect } from "@playwright/test";
import { signIn, USERS, branchSql, callEdgeFunction } from "./helpers";

/**
 * Who is digitising, and how much (Phase 27, I2; D40).
 *
 * The read answers one row per person per day. Its numbers are checked
 * against the rows themselves: a bench row counts for whoever last edited it,
 * on the day they did; a file's rows count for whoever uploaded it, on the
 * day it came in. The page sums the period, draws the days, and takes the
 * shared period control. Somebody without records.view is refused.
 *
 * Red on main: the action does not exist and the page has no such mode.
 */

test.describe.configure({ timeout: 120_000 });

type Day = { user_id: string; day: string; typed: number; uploaded: number; landed: number; files: number };
type Answer = { data: { days: Day[]; from: string; to: string; tz: string } };

test("the read agrees with the rows, per person and per day", async ({ page }) => {
  await signIn(page, USERS.admin);
  const r = await callEdgeFunction(page, "data-center-read", { action: "digitisation_team", dateFrom: null, dateTo: null });
  expect(r.status, JSON.stringify(r.body).slice(0, 200)).toBe(200);
  const { days, from, to, tz } = (r.body as Answer).data;
  expect(from <= to).toBe(true);
  expect(tz).toBeTruthy();

  // The oracle, over the same window and the same timezone.
  const oracle = await branchSql<{ user_id: string; day: string; typed: number; uploaded: number; landed: number }>(
    `with bench as (
       select r.last_edited_by as user_id, timezone('${tz}', r.last_edited_at)::date as day,
              count(*) filter (where r.status <> 'draft')::int as typed, 0::int as uploaded, count(r.sale_id)::int as landed
         from data_center.import_rows r join data_center.import_batches b on b.id = r.batch_id
        where b.source = 'workbench' and r.last_edited_by is not null
          and timezone('${tz}', r.last_edited_at)::date between '${from}' and '${to}'
        group by 1, 2),
     bulk as (
       select b.uploaded_by as user_id, timezone('${tz}', b.uploaded_at)::date as day,
              0::int as typed, count(r.id)::int as uploaded, count(r.sale_id)::int as landed
         from data_center.import_batches b join data_center.import_rows r on r.batch_id = b.id
        where b.source in ('receipt', 'manual', 'field') and b.state <> 'rolled_back' and b.uploaded_by is not null
          and timezone('${tz}', b.uploaded_at)::date between '${from}' and '${to}'
        group by 1, 2)
     select user_id::text, day::text, sum(typed)::int as typed, sum(uploaded)::int as uploaded, sum(landed)::int as landed
       from (select * from bench union all select * from bulk) u group by 1, 2 order by 2, 1`,
  );
  const key = (d: { user_id: string; day: string }) => `${d.user_id}|${d.day}`;
  const byKey = new Map(days.map((d) => [key(d), d]));
  expect(oracle.length, "the branch has digitising to measure").toBeGreaterThan(0);
  for (const o of oracle) {
    const got = byKey.get(key(o));
    expect(got, `a row for ${o.user_id} on ${o.day}`).toBeTruthy();
    expect([got!.typed, got!.uploaded, got!.landed]).toEqual([o.typed, o.uploaded, o.landed]);
  }
});

test("the page shows the team for the period, with the days drawn", async ({ page }) => {
  await signIn(page, USERS.admin);
  await page.goto("/data-center/import?mode=team");
  await expect(page.getByRole("heading", { name: "Bulk Import" })).toBeVisible({ timeout: 30_000 });
  const team = page.locator("[data-digitisation-team]");
  await expect(team).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-import-mode="team"]')).toHaveAttribute("aria-pressed", "true");
  // The figures and at least one person, with their days drawn beside them.
  await expect(team.locator('[data-import-figure="entered"]')).toBeVisible();
  await expect(team.locator("[data-team-row]").first()).toBeVisible({ timeout: 30_000 });
  await expect(team.locator("[data-team-bars]").first()).toBeVisible();
  // The period control is the module's, and the export is there.
  await expect(team.getByRole("button", { name: /work for/ })).toBeVisible();
  await expect(team.getByRole("button", { name: "Export team" })).toBeVisible();
});

test("somebody without records.view is refused the read and never sees the mode", async ({ page }) => {
  await signIn(page, USERS.callCentre);
  const r = await callEdgeFunction(page, "data-center-read", { action: "digitisation_team" });
  expect(r.status).toBe(403);
});
