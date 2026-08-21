import { test, expect } from "@playwright/test";
import { signIn, USERS } from "./helpers";

/**
 * Every page renders. That is the whole test, and it is not a trivial one.
 *
 * The Call Centre page shipped once with a hook declared above the callback it
 * depended on. TypeScript was clean, the build was clean, and the page threw
 * "Cannot access 'load' before initialization" the moment React ran it - so
 * both of the gates this repo relies on passed a surface that could not be
 * opened. Nothing but loading it would have found that.
 *
 * So: open each one, collect what the page throws, and fail with the message
 * rather than with a missing heading. A page error is not a symptom of a
 * broken assertion somewhere else, it is the defect, and naming it directly is
 * the difference between a two-minute fix and an afternoon.
 */

const PAGES = [
  { path: "/data-center", heading: "Data Center" },
  { path: "/data-center/dashboard", heading: "Dashboard" },
  { path: "/data-center/call-centre", heading: "Call Centre" },
  { path: "/data-center/partner-records", heading: "Partner Records" },
  { path: "/data-center/stove-records", heading: "Stove Records" },
  { path: "/data-center/import", heading: "Bulk Import" },
  { path: "/data-center/settings", heading: "Settings" },
];

test.describe("every Data Centre page opens", () => {
  for (const { path, heading } of PAGES) {
    test(`${path} renders without throwing`, async ({ page }) => {
      const thrown: string[] = [];
      page.on("pageerror", (e) => thrown.push(e.message));

      await signIn(page, USERS.admin);
      await page.goto(path);

      // The heading proves the route resolved and the component mounted; the
      // empty error list proves it did not then fall over. Both matter: a page
      // can throw after painting a heading, and a page that never paints one
      // may have thrown nothing at all and simply routed somewhere else.
      await expect(
        page.getByRole("heading", { name: heading, exact: true }).first(),
      ).toBeVisible({ timeout: 30_000 });

      // Give the surfaces that fetch on mount time to fail if they are going
      // to. Most of the module's panels load their own data, and a throw in
      // one of those arrives after the heading, not with it.
      await page.waitForTimeout(4_000);

      expect(thrown, `${path} threw: ${thrown.join(" | ")}`).toEqual([]);
    });
  }

  test("the stove record opens without throwing", async ({ page }) => {
    const thrown: string[] = [];
    page.on("pageerror", (e) => thrown.push(e.message));

    await signIn(page, USERS.admin);
    await page.goto("/data-center/stove-records");
    const serial = page.locator('a[href^="/data-center/stove/"]').first();
    await expect(serial).toBeVisible({ timeout: 30_000 });
    await serial.click();

    await expect(page.getByRole("heading", { name: /^PRV/ })).toBeVisible({
      timeout: 30_000,
    });
    await page.waitForTimeout(4_000);
    expect(thrown, `the stove record threw: ${thrown.join(" | ")}`).toEqual([]);
  });
});
