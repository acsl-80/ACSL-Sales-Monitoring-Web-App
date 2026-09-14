import { test, expect, type Page } from "@playwright/test";
import { signIn, USERS } from "./helpers";

/**
 * Slice 10c of the 2026-09-02 review: User Management asks once, not per
 * manager and not per column.
 *
 * Choosing the ACSL Agent group on the create form loaded every manager's
 * states and partners two requests at a time, to know which manager covers
 * which partner. Opening an ACSL agent's edit form asked three more times for
 * that agent, after probing an assignment table column by column for a column
 * that has always been agent_id, and then once more for the carve-outs. One
 * scopes call now answers all the managers, and one answers the edited agent.
 */

const AGENT_NAME = "Preview ACSL Agent";
const PER_AGENT = /\/functions\/v1\/super-admin-agents\/[0-9a-f-]{36}\/(states|organizations|scope)\b/;
const SCOPES = /\/functions\/v1\/super-admin-agents\/scopes\?/;
const PROBE = /\/rest\/v1\/super_admin_agent_organizations\?/;

test.describe.configure({ timeout: 180_000 });

function trackBackend(page: Page) {
  const calls: Array<{ url: string; at: number }> = [];
  // Quiet means no request issued and no response received: a call that follows
  // a slow answer must not slip past the window.
  let lastActivity = 0;
  const isBackend = (url: string) => /\.supabase\.co\/(rest|functions)\/v1\//.test(url) && !url.includes("/realtime/");
  page.on("request", (r) => {
    if (isBackend(r.url())) {
      lastActivity = Date.now();
      calls.push({ url: r.url(), at: lastActivity });
    }
  });
  page.on("response", (r) => {
    if (isBackend(r.url())) lastActivity = Date.now();
  });
  return {
    calls,
    async quietFor(ms: number, limit = 60_000) {
      const started = Date.now();
      for (;;) {
        if (Date.now() - lastActivity >= ms) return;
        if (Date.now() - started > limit) throw new Error("the page never went quiet");
        await page.waitForTimeout(250);
      }
    },
  };
}

async function openUsers(page: Page) {
  await signIn(page, USERS.admin);
  await page.goto("/user-management/users");
  await expect(page.getByRole("button", { name: "Create User" })).toBeVisible({ timeout: 45_000 });
  await expect(page.locator("tbody tr").first()).toBeVisible({ timeout: 45_000 });
}

test("choosing the ACSL Agent group loads every manager's scope in one request", async ({ page }) => {
  const backend = trackBackend(page);
  await openUsers(page);
  await backend.quietFor(1_500);

  const before = backend.calls.length;
  await page.getByRole("button", { name: "Create User" }).click();
  await page.getByRole("combobox", { name: /User Group/ }).click();
  await page.getByRole("option", { name: "ACSL Agent", exact: true }).click();
  await backend.quietFor(2_500);

  const since = backend.calls.slice(before).map((c) => c.url);
  const perManager = since.filter((u) => PER_AGENT.test(u));
  const scopes = since.filter((u) => SCOPES.test(u));
  expect(perManager.length, "no request should ask for one manager's states or partners at a time").toBe(0);
  expect(scopes.length, `the managers' scopes should come from one request; calls since the click: ${since.map((u) => u.replace(/^https:\/\/[^/]+/, "")).join(" | ") || "none"}`).toBe(1);
});

test("opening an ACSL agent's edit form asks for that agent once and probes no columns", async ({ page }) => {
  const backend = trackBackend(page);
  await openUsers(page);
  await backend.quietFor(1_500);

  const before = backend.calls.length;
  const row = page.locator("tbody tr").filter({ hasText: AGENT_NAME }).first();
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Edit user" }).click();
  await expect(page.getByRole("combobox", { name: /User Group/ })).toBeVisible({ timeout: 30_000 });
  await backend.quietFor(2_500);

  const since = backend.calls.slice(before).map((c) => c.url);
  const perAgent = since.filter((u) => PER_AGENT.test(u));
  const probes = since.filter((u) => PROBE.test(u));
  const scopes = since.filter((u) => SCOPES.test(u));
  expect(perAgent.length, "no request should ask for the agent's states, partners or scope one at a time").toBe(0);
  expect(probes.length, "no request should probe the assignment table for its column").toBe(0);
  expect(scopes.length, "the agent and the managers should come from at most two scope requests").toBeLessThanOrEqual(2);
  expect(scopes.length, "the agent's scope should have been asked for").toBeGreaterThanOrEqual(1);
});
