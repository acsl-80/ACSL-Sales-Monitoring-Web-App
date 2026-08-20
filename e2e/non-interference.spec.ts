import { test, expect } from "@playwright/test";
import { signIn, USERS } from "./helpers";

/**
 * The standing requirement for this whole module: the sales monitoring web app
 * must not notice it exists.
 *
 * These tests would have caught the `manageProfileService` defect, where a
 * hardcoded production URL broke the profile menu in every environment except
 * production, so they earn their place rather than restating the obvious.
 */
test.describe("the sales app is unaffected", () => {
  // A fresh context per role, not clearCookies(). Supabase persists its session
  // in localStorage, which clearCookies() does not touch, so reusing one context
  // leaves the previous user signed in and /login redirects straight past the
  // form.
  test("every seeded role can sign in", async ({ browser }) => {
    // Six full sign-ins on six fresh contexts, each bypassing the session
    // cache by design. That is six times the work of an ordinary test on the
    // same 60 s budget, and it had been finishing with seconds to spare. The
    // budget is sized to the work rather than left to luck.
    test.setTimeout(60_000 * Object.keys(USERS).length);

    for (const email of Object.values(USERS)) {
      const context = await browser.newContext();
      const page = await context.newPage();
      await signIn(page, email);
      await expect(page, `${email} did not reach the dashboard`).toHaveURL(
        /\/dashboard/,
      );
      await context.close();
    }
  });

  test("Sell Stove still loads and renders its form", async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto("/sales/create");

    await expect(page).toHaveURL(/\/sales\/create/);
    await expect(page.getByRole("heading", { name: /Record a New Sale/i })).toBeVisible();

    // The stove serial field is the one gated on partner selection, so its
    // presence proves the form mounted rather than erroring.
    await expect(page.locator("#stoveSerialNo")).toBeVisible();
  });

  test("Sales Records and Stove Users Data still load", async ({ page }) => {
    await signIn(page, USERS.admin);

    for (const path of ["/sales", "/end-user-records"]) {
      const response = await page.goto(path);
      expect(response?.status(), `${path} returned ${response?.status()}`).toBeLessThan(400);
      await expect(page).toHaveURL(new RegExp(path.replace("/", "\\/")));
    }
  });

  test("the profile menu resolves, which the hardcoded URL used to break", async ({
    page,
  }) => {
    const failures: string[] = [];
    page.on("response", (r) => {
      if (r.url().includes("/functions/v1/manage-profile") && r.status() >= 400) {
        failures.push(`${r.status()} ${r.url()}`);
      }
    });

    await signIn(page, USERS.admin);
    await page.waitForLoadState("domcontentloaded");

    expect(failures, `manage-profile failed: ${failures.join(", ")}`).toEqual([]);
  });

  test("no unhandled console errors on the core sales screens", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await signIn(page, USERS.admin);
    await page.goto("/sales/create");
    await page.waitForLoadState("domcontentloaded");

    expect(errors, `page errors: ${errors.join(" | ")}`).toEqual([]);
  });
});
