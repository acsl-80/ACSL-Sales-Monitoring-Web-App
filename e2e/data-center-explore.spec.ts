import { test, expect } from "@playwright/test";
import { signIn, USERS } from "./helpers";

/**
 * The Explore hub and the pages behind it.
 *
 * The module used to be one long page carrying every surface. These tests hold
 * the shape it became: a hub of cards, one route per area, breadcrumbs and a
 * way back, and the sidebar staying correct throughout.
 *
 * The last of those is worth stating: it needs no code, because
 * DashboardLayout's deriveCurrentRouteFromPath already falls through to
 * segments[0]. The test exists so that if someone adds a case above that
 * fallthrough, they find out here rather than from a user.
 */

const AREAS = [
  { card: "Dashboard", path: "/data-center/dashboard", heading: "Dashboard" },
  { card: "Call Centre", path: "/data-center/call-centre", heading: "Call Centre" },
  { card: "Partner Records", path: "/data-center/partner-records", heading: "Partner Records" },
  { card: "Stove Records", path: "/data-center/stove-records", heading: "Stove Records" },
  { card: "Bulk Import", path: "/data-center/import", heading: "Bulk Import" },
];

test.describe("Explore is the landing view", () => {
  test("super admin sees a card for every area", async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center");

    for (const area of AREAS) {
      await expect(
        page.getByRole("link", { name: `Open ${area.card}` }),
      ).toBeVisible({ timeout: 20_000 });
    }
  });

  test("a card opens its own route, not a panel on the hub", async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center");

    await page.getByRole("link", { name: "Open Partner Records" }).click();

    // Its own URL is the whole point: it is what makes drill-through links and
    // browser back work without anything being written to make them.
    await expect(page).toHaveURL(/\/data-center\/partner-records/);
    await expect(
      page.getByRole("heading", { name: "Partner Records", exact: true }).first(),
    ).toBeVisible();
  });

  test("every area has breadcrumbs and a way back to Explore", async ({ page }) => {
    await signIn(page, USERS.admin);

    for (const area of AREAS) {
      await page.goto(area.path);
      await expect(
        page.getByRole("heading", { name: area.heading, exact: true }).first(),
      ).toBeVisible({ timeout: 20_000 });

      await expect(page.getByRole("link", { name: "Explore" })).toBeVisible();
      await expect(page.getByText("Data Center").first()).toBeVisible();
    }
  });

  test("back from an area returns to Explore", async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/stove-records");
    await expect(
      page.getByRole("heading", { name: "Stove Records", exact: true }).first(),
    ).toBeVisible({ timeout: 20_000 });

    await page.getByRole("link", { name: "Explore" }).click();

    await expect(page).toHaveURL(/\/data-center\/?$/);
    await expect(page.getByRole("link", { name: "Open Dashboard" })).toBeVisible();
  });

  test("the sidebar stays on Data Center across every child route", async ({ page }) => {
    await signIn(page, USERS.admin);

    for (const area of AREAS) {
      await page.goto(area.path);
      const nav = page.getByRole("navigation").getByRole("link", { name: "Data Center" });
      await expect(nav).toBeVisible({ timeout: 20_000 });
      // The active nav item carries the app's selected background.
      await expect(nav).toHaveClass(/bg-\[#4a5d0f\]/);
    }
  });

  test("a viewer sees import locked rather than hidden", async ({ page }) => {
    await signIn(page, USERS.manager);
    await page.goto("/data-center");

    // A viewer holds no import feature. The card is present and disabled, which
    // says what is missing instead of quietly shrinking the module.
    await expect(page.getByText("Bulk Import")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("link", { name: "Open Bulk Import" })).toHaveCount(0);
    await expect(page.getByText("import.upload")).toBeVisible();
  });

  test("reaching a locked area by URL is refused, with a way back", async ({ page }) => {
    await signIn(page, USERS.manager);
    await page.goto("/data-center/import");

    await expect(
      page.getByRole("heading", { name: "Not part of your access" }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("link", { name: /Back to Explore/ })).toBeVisible();
  });
});

test.describe("Partner Records shows the reconciliation funnel", () => {
  test("the funnel columns are present and say when they were computed", async ({
    page,
  }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/partner-records");

    await expect(
      page.getByRole("heading", { name: "Partner Records", exact: true }).first(),
    ).toBeVisible({ timeout: 20_000 });

    for (const column of ["Issued", "Received", "Digitalised", "Verified", "Outstanding"]) {
      await expect(page.getByText(column, { exact: true }).first()).toBeVisible();
    }

    // Figures are computed, so the page has to say as of when. Numbers with no
    // date on them get read as current.
    await expect(page.getByText(/computed |No transfers match/)).toBeVisible();
  });

  test("the funnel is read, never counted at page load", async ({ page }) => {
    const bodies: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/functions/v1/data-center-read")) {
        bodies.push(req.postData() ?? "");
      }
    });

    await signIn(page, USERS.admin);
    await page.goto("/data-center/partner-records");
    await expect(
      page.getByRole("heading", { name: "Partner Records", exact: true }).first(),
    ).toBeVisible({ timeout: 20_000 });

    await expect
      .poll(() => bodies.some((b) => b.includes('"transfer_funnel"')), { timeout: 15_000 })
      .toBe(true);
    for (const body of bodies) {
      expect(body).not.toContain('"offset"');
    }
  });

  test("an export button is offered", async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/partner-records");
    await expect(
      page.getByRole("heading", { name: "Partner Records", exact: true }).first(),
    ).toBeVisible({ timeout: 20_000 });

    await expect(page.getByRole("button", { name: /Export CSV/ })).toBeVisible();
  });
});
