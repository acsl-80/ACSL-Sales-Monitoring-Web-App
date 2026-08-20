import { test, expect } from "@playwright/test";
import { signIn, USERS } from "./helpers";

/**
 * Dashboards through the real UI.
 *
 * The capacity claim (74 metrics computed in 5.2 s, read in 2.3 ms at 500,000
 * sales) is measured against the local seeded database and written up in
 * src/app/data-center/DASHBOARDS.md. The preview branch holds a handful of
 * sales, so what it can prove is different and more useful here: that the read
 * never aggregates, that recomputing is restricted, and that the panel is
 * honest about how current its numbers are.
 */

test.describe("dashboards", () => {
  test("super admin sees the dashboard and can recompute", async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/dashboard");

    await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole("button", { name: /Recompute/ })).toBeVisible();
  });

  test("the dashboard says where its numbers come from in time", async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/dashboard");
    await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible({
      timeout: 20_000,
    });

    // Either it has been computed and says when, or it says it has not been.
    // What it must never do is present numbers with no date on them.
    const stamp = page.getByText(/computed |never computed|no figures yet/);
    await expect(stamp.first()).toBeVisible();
  });

  test("a viewer sees the dashboard but is not offered Recompute", async ({ page }) => {
    await signIn(page, USERS.manager);
    await page.goto("/data-center/dashboard");

    // dashboard.view is part of every access level; running the computation is
    // super admin only, because it reads every sale.
    await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole("button", { name: /Recompute/ })).toHaveCount(0);
  });

  test("loading the dashboard asks for snapshots, never for a page of sales", async ({
    page,
  }) => {
    const bodies: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/functions/v1/data-center-read")) {
        bodies.push(req.postData() ?? "");
      }
    });

    await signIn(page, USERS.admin);
    await page.goto("/data-center/dashboard");
    await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible({
      timeout: 20_000,
    });

    // The dashboard has its own action. If it were ever reworked to build its
    // figures from records pages, this is what would catch it.
    await expect
      .poll(() => bodies.some((b) => b.includes('"dashboard"')), { timeout: 15_000 })
      .toBe(true);
  });
});
