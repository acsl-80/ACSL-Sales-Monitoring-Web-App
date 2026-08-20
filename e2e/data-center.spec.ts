import { test, expect } from "@playwright/test";
import { signIn, dataCentreNavLink, USERS } from "./helpers";

/**
 * The access model, exercised through the real UI.
 *
 * Entry is granted per USER, case by case, never per role: super_admin always
 * passes, everyone else needs a data_center.module_access row carrying viewer
 * or editor. The seed grants callcentre editor and manager viewer, and leaves
 * partner and agent with nothing, so every path is testable.
 *
 * This replaces the earlier static tier 1, whose gap this suite originally
 * proved: no non-admin could reach the module, so partial grants were
 * unprovable at the UI boundary. They are provable now, and tested below.
 */

test.describe("entry is per user, case by case", () => {
  test("super admin needs no grant: nav entry and module both available", async ({
    page,
  }) => {
    await signIn(page, USERS.admin);

    await expect(dataCentreNavLink(page)).toBeVisible();
    await page.goto("/data-center");
    await expect(page.getByRole("heading", { name: "Data Center" })).toBeVisible();
  });

  test("an editor grant admits the call centre account", async ({ page }) => {
    await signIn(page, USERS.callCentre);

    // The nav entry appears through the per-user check, not the role map.
    await expect(dataCentreNavLink(page)).toBeVisible({ timeout: 20_000 });

    await page.goto("/data-center");
    await expect(page.getByRole("heading", { name: "Data Center" })).toBeVisible();
    await expect(page.getByText("Editor", { exact: true })).toBeVisible();
  });

  test("a viewer grant admits the manager account, read-only", async ({ page }) => {
    await signIn(page, USERS.manager);

    await page.goto("/data-center");
    await expect(page.getByRole("heading", { name: "Data Center" })).toBeVisible();
    await expect(page.getByText("Viewer", { exact: true })).toBeVisible();

    // Viewer sees, editor changes. Since Phase 5 the import surface is a real
    // panel rather than a locked placeholder card, so a viewer gets no import
    // surface at all. Absent is a stronger guarantee than present-and-disabled.
    await expect(page.getByRole("heading", { name: "Bulk Import" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Stove Records", exact: true })).toBeVisible();
  });

  for (const [label, email] of [
    ["partner", USERS.partner],
    ["partner agent", USERS.agent],
  ] as const) {
    test(`${label} has no grant: no nav entry, denied in the module`, async ({
      page,
    }) => {
      await signIn(page, email);

      await expect(dataCentreNavLink(page)).toHaveCount(0);

      await page.goto("/data-center");
      await expect(
        page.getByRole("heading", { name: "No Data Center access" }),
      ).toBeVisible();
      // Assert on module content, not the heading: DashboardLayout renders
      // "Data Center" as the page title in every state, denied included, so
      // matching that would be testing the layout chrome rather than the gate.
      await expect(page.getByText("Sold Stove Records")).toHaveCount(0);
      await expect(page.getByRole("link", { name: /^Open / })).toHaveCount(0);
    });
  }
});

test.describe("viewer and editor are different animals", () => {
  test("editor: every card on the hub is open", async ({ page }) => {
    await signIn(page, USERS.callCentre);
    await page.goto("/data-center");

    // An editor holds import.upload and call_records.edit, so nothing on the
    // hub is locked. Asserting the cards rather than a feature count tests the
    // gate itself instead of a label describing it.
    for (const area of ["Dashboard", "Call Centre", "Partner Records", "Stove Records", "Bulk Import"]) {
      await expect(page.getByRole("link", { name: `Open ${area}` })).toBeVisible({
        timeout: 20_000,
      });
    }
    await expect(page.getByText(/^Needs /)).toHaveCount(0);
  });

  test("viewer: the reading areas open, the writing one does not", async ({ page }) => {
    await signIn(page, USERS.manager);
    await page.goto("/data-center");

    // A viewer holds records.view, call_records.view and dashboard.view.
    for (const area of ["Dashboard", "Call Centre", "Partner Records", "Stove Records"]) {
      await expect(page.getByRole("link", { name: `Open ${area}` })).toBeVisible({
        timeout: 20_000,
      });
    }
    // Import is shown locked rather than hidden, so the missing grant is named.
    // The card still says "Bulk Import"; what a viewer must not get is the link.
    await expect(page.getByRole("link", { name: "Open Bulk Import" })).toHaveCount(0);
    await expect(page.getByText("Bulk Import")).toBeVisible();
    await expect(page.getByText("import.upload")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Access", exact: true })).toHaveCount(0);
  });
});

test.describe("the access section is for access only", () => {
  test("super admin sees the access manager and the tracked changes", async ({
    page,
  }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center");

    await expect(page.getByRole("heading", { name: "Access", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Recent changes" })).toBeVisible();

    // The seeded grants are listed with their levels.
    await expect(page.getByText("callcentre@preview.acsl.test")).toBeVisible();
    await expect(page.getByText("manager@preview.acsl.test")).toBeVisible();
  });

  test("an editor does not see the access section", async ({ page }) => {
    await signIn(page, USERS.callCentre);
    await page.goto("/data-center");

    await expect(page.getByRole("heading", { name: "Data Center" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Access", exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Recent changes" })).toHaveCount(0);
  });
});
