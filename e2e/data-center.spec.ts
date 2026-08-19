import { test, expect } from "@playwright/test";
import { signIn, dataCentreNavLink, USERS } from "./helpers";

/**
 * The two-tier permission model, exercised through the real UI.
 *
 * Tier 1 decides whether the module exists for a user at all, and lives in the
 * host app's static route map. Tier 2 decides what they can do inside it, and
 * is resolved per user from `data_center.feature_grants`.
 *
 * The seed grants `callcentre` three of the nine features on purpose, so the
 * partial case is testable rather than hypothetical.
 */
test.describe("tier 1: does the module exist for this user", () => {
  test("super admin sees the nav entry and can open the module", async ({ page }) => {
    await signIn(page, USERS.admin);

    await expect(dataCentreNavLink(page)).toBeVisible();

    await page.goto("/data-center");
    await expect(page).toHaveURL(/\/data-center/);
    await expect(page.getByRole("heading", { name: "Data Center" })).toBeVisible();
  });

  for (const [label, email] of [
    ["partner agent", USERS.agent],
    ["partner", USERS.partner],
  ] as const) {
    test(`${label} cannot see or reach the module`, async ({ page }) => {
      await signIn(page, email);

      // Absent from the sidebar.
      await expect(dataCentreNavLink(page)).toHaveCount(0);

      // And unreachable by typing the URL, which is the part that matters:
      // hiding a nav entry is not a permission.
      await page.goto("/data-center");
      await expect(page).toHaveURL(/\/unauthorized/, { timeout: 20_000 });
    });
  }
});

test.describe("tier 2: what can they do once inside", () => {
  test("super admin short-circuits to every feature", async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center");

    await expect(page.getByText(/every Data Center feature is available/i)).toBeVisible();

    // No surface should be showing its locked state.
    await expect(page.getByText(/^Requires /)).toHaveCount(0);
  });

  /**
   * KNOWN GAP, recorded rather than papered over.
   *
   * The call-centre account holds three tier-2 grants in the database, and the
   * edge function returns exactly those three when asked directly. But the
   * account's role is `partner_agent`, which carries no `data-center` route
   * key, so tier 1 stops it at the door and those grants are never consulted
   * by the UI.
   *
   * The consequence is that **no user can currently exercise a partial grant
   * through the interface**: the only role that reaches the module is
   * super_admin, and super_admin short-circuits tier 2 entirely. The mechanism
   * is proven at the function boundary and unproven at the UI boundary.
   *
   * This is the tier-1 limitation already recorded in ROADMAP.md Phase 7: a
   * static, role-keyed map cannot express "this particular non-admin user has
   * been enabled". Closing it is Phase 7 work, not a test fix, and the tests
   * below assert today's real behaviour so the gap stays visible.
   */
  test("call centre is stopped by tier 1, so its tier-2 grants never apply", async ({
    page,
  }) => {
    await signIn(page, USERS.callCentre);
    await page.goto("/data-center");

    await expect(
      page.getByRole("heading", { name: /Page Not Found/i }),
    ).toBeVisible();
    await expect(page.getByText(/logged in as partner_agent/i)).toBeVisible();

    // The module must not render at all for this user.
    await expect(page.getByRole("heading", { name: "Data Center" })).toHaveCount(0);
  });

  test("the module is reachable only by super_admin today", async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center");
    await expect(page.getByRole("heading", { name: "Data Center" })).toBeVisible();

    // Everyone else, including the account holding real tier-2 grants.
    for (const email of [USERS.callCentre, USERS.partner, USERS.agent]) {
      const ctx = await page.context().browser()!.newContext();
      const p = await ctx.newPage();
      await signIn(p, email);
      await p.goto("/data-center");
      await expect(p.getByRole("heading", { name: "Data Center" })).toHaveCount(0);
      await ctx.close();
    }
  });
});
