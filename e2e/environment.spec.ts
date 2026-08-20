import { test, expect } from "@playwright/test";
import {
  signIn,
  trackSupabaseCalls,
  USERS,
  BRANCH_REF,
  PRODUCTION_REF,
} from "./helpers";

/**
 * The most important file in this suite.
 *
 * `src/lib/supabaseConfig.ts` ships the production URL and anon key as
 * hardcoded fallbacks, and treats a blank environment variable as missing. So a
 * misconfigured preview does not fail loudly: it quietly connects to the live
 * database, and anyone clicking through it writes real sales. These tests are
 * the thing standing between that mistake and production data.
 */
test.describe("preview environment isolation", () => {
  test("signing in talks to the branch and never to production", async ({ page }) => {
    const calls = trackSupabaseCalls(page);

    await signIn(page, USERS.admin);
    await page.waitForLoadState("networkidle");

    calls.assertBranchOnly();
  });

  test("production is not contacted while browsing the sales screens", async ({
    page,
  }) => {
    const calls = trackSupabaseCalls(page);

    await signIn(page, USERS.admin);
    await page.goto("/sales");
    await page.waitForLoadState("networkidle");
    await page.goto("/data-center");
    await page.waitForLoadState("networkidle");

    const contacted = [...calls.hosts];
    expect(
      contacted.filter((h) => h.includes(PRODUCTION_REF)),
      `production was contacted from the preview: ${contacted.join(", ")}`,
    ).toEqual([]);
  });

  test("the seeded preview database is the one answering", async ({ page }) => {
    test.skip(!BRANCH_REF, "BRANCH_SUPABASE_REF not provided");

    const calls = trackSupabaseCalls(page);
    await signIn(page, USERS.admin);

    // Poll for the thing being asserted rather than waiting for the network to
    // fall silent. `networkidle` needs a 500 ms gap with nothing in flight,
    // which an app that keeps a session alive may never give, and Playwright
    // discourages it for exactly that reason. It timed out here at 60 s while
    // the traffic it was waiting on had already happened.
    await expect
      .poll(() => [...calls.hosts].some((h) => h.includes(BRANCH_REF)), {
        timeout: 30_000,
        message: `expected traffic to the branch project ${BRANCH_REF}`,
      })
      .toBe(true);
  });
});
