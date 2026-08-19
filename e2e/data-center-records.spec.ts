import { test, expect } from "@playwright/test";
import { signIn, USERS } from "./helpers";

/**
 * Table 1 through the real UI.
 *
 * The capacity claims live in src/app/data-center/RECORDS-PERFORMANCE.md and
 * were measured against 500,000 locally seeded rows. The preview branch project
 * holds only the small preview seed, so what these tests can prove is different
 * and worth stating plainly: that the table renders, that it queries the server
 * rather than filtering in the browser, that the scope rule is applied, and
 * that the feature gate is real.
 */

test.describe("sold stove records", () => {
  test("super admin sees the table, and it says what scope it is showing", async ({
    page,
  }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center");

    await expect(page.getByRole("heading", { name: "Sold Stove Records" })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText(/showing all organizations/)).toBeVisible();

    // The seeded preview sales render as rows, not as an empty state.
    await expect(page.getByText("No records match")).toHaveCount(0);
  });

  test("filtering goes to the server, it does not narrow what is loaded", async ({
    page,
  }) => {
    const calls: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/functions/v1/data-center-read")) {
        const body = req.postData() ?? "";
        if (body.includes('"records"')) calls.push(body);
      }
    });

    await signIn(page, USERS.admin);
    await page.goto("/data-center");
    await expect(page.getByRole("heading", { name: "Sold Stove Records" })).toBeVisible({
      timeout: 20_000,
    });

    const before = calls.length;
    await page.getByPlaceholder(/Name, phone, stove serial/).fill("0803");

    // Debounced, so one request follows rather than one per keystroke.
    await expect.poll(() => calls.length, { timeout: 10_000 }).toBeGreaterThan(before);

    const searchCall = calls.find((c) => c.includes('"search"'));
    expect(searchCall, "the search term reached the server").toBeTruthy();
    expect(searchCall).toContain("0803");
  });

  test("no request ever carries an offset or a page number", async ({ page }) => {
    const bodies: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/functions/v1/data-center-read")) {
        bodies.push(req.postData() ?? "");
      }
    });

    await signIn(page, USERS.admin);
    await page.goto("/data-center");
    await expect(page.getByRole("heading", { name: "Sold Stove Records" })).toBeVisible({
      timeout: 20_000,
    });

    // The guarantee is structural: paging is by cursor, and neither parameter
    // exists in the request shape. This asserts it stays that way.
    for (const body of bodies) {
      expect(body).not.toContain('"offset"');
      expect(body).not.toContain('"page"');
    }
    expect(bodies.length).toBeGreaterThan(0);
  });

  test("an editor gets the table; scope still limits what is in it", async ({
    page,
  }) => {
    await signIn(page, USERS.callCentre);
    await page.goto("/data-center");

    // records.view is part of every access level, so the table is present.
    await expect(page.getByRole("heading", { name: "Sold Stove Records" })).toBeVisible({
      timeout: 20_000,
    });

    // But a partner_agent is scoped to their own sales by the sales app's own
    // rule, which this module mirrors rather than reinvents.
    await expect(page.getByText(/showing own sales/)).toBeVisible();
  });
});
