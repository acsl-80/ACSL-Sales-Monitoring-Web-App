import { test, expect } from "@playwright/test";
import { signIn, USERS } from "./helpers";

/**
 * Bulk import through the real UI.
 *
 * The path itself (stage, validate, dry run, commit, rollback, and the race
 * between two imports for one stove) is proven against the server and written
 * up in src/app/data-center/IMPORT.md. That work needs 500,000 rows and real
 * stock, which the preview branch does not have.
 *
 * What these tests prove is the part that only the browser can show: that the
 * panel renders, that committing is gated separately from uploading, and that
 * nothing offers to move stock to someone who may not.
 */

test.describe("bulk import", () => {
  test("super admin sees the panel and the partner picker", async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center");

    await expect(page.getByRole("heading", { name: "Bulk Import" })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByLabel("Partner")).toBeVisible();

    // Choosing a file is refused until a partner is picked, because the stove
    // has to belong to someone and create-sale would refuse it anyway.
    await expect(page.getByRole("button", { name: /Choose a CSV/ })).toBeDisabled();
  });

  test("the panel says nothing is committed until asked", async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center");
    await expect(page.getByRole("heading", { name: "Bulk Import" })).toBeVisible({
      timeout: 20_000,
    });

    // The promise the whole four-step shape exists to keep, stated where the
    // operator will read it.
    await expect(
      page.getByText(/Nothing is committed until you say so/),
    ).toBeVisible();
  });

  test("an editor can stage but is not offered commit", async ({ page }) => {
    await signIn(page, USERS.callCentre);
    await page.goto("/data-center");

    // The editor level carries import.upload and import.exceptions, and
    // deliberately not import.commit: staging and correcting are clerical,
    // committing changes live inventory.
    await expect(page.getByRole("heading", { name: "Bulk Import" })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole("button", { name: /^Commit / })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Roll back / })).toHaveCount(0);
  });

  test("a viewer is not offered import at all", async ({ page }) => {
    await signIn(page, USERS.manager);
    await page.goto("/data-center");

    await expect(page.getByRole("heading", { name: "Data Center" })).toBeVisible({
      timeout: 20_000,
    });
    // The viewer level carries no import feature, so the panel is absent
    // rather than present and disabled.
    await expect(page.getByRole("heading", { name: "Bulk Import" })).toHaveCount(0);
  });
});
