import { test, expect } from "@playwright/test";
import { signIn, USERS } from "./helpers";

/**
 * Every host page opens without throwing.
 *
 * Slice 8a of the 2026-09-02 review touches fifty files across the host to
 * collapse its date and money formatters into two. A clean typecheck and a
 * green build say nothing about whether a page still renders, which is the
 * lesson the module's own pages-load spec carries. This is the host's copy:
 * sign in as the super admin, open every route the sidebar offers, and fail
 * on anything the page throws or on the error boundary.
 *
 * The Data Center has its own such spec and is left out here.
 */

const ROUTES = [
  "/dashboard",
  "/sales",
  "/sales/create",
  "/sales/cancelled",
  "/sales/cancelled-purchases",
  "/sales/financial-reports",
  "/end-user-records",
  "/end-user-records/api",
  "/partners/profiles",
  "/agents",
  "/agents/profiles",
  "/agents/partner-agents-profiles",
  "/stove-management",
  "/stove-transfer-history",
  "/user-management/users",
  "/user-management/user-groups",
  "/payment-models",
  "/settings/credentials",
  "/settings/system-config",
  "/settings/tools",
  "/user-guide",
  "/system-documentation",
  "/profile",
];

test.describe.configure({ timeout: 120_000 });

test.describe("every host page opens", () => {
  for (const route of ROUTES) {
    test(`${route} renders without throwing`, async ({ page }) => {
      const thrown: string[] = [];
      page.on("pageerror", (err) => thrown.push(err.message));
      await signIn(page, USERS.admin);
      await page.goto(route);
      await expect(page.getByText("CONTROL PANEL")).toBeVisible({ timeout: 30_000 });
      // Give the page its first data round trip before judging it.
      await page.waitForTimeout(2_500);
      await expect(page.getByText("Something went wrong"), "the error boundary should not be showing").toHaveCount(0);
      expect(thrown, `the page threw: ${thrown.join(" | ")}`).toHaveLength(0);
    });
  }
});
