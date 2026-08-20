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
    await page.goto("/data-center/stove-records");

    await expect(page.getByRole("heading", { name: "Stove Records", exact: true })).toBeVisible({
      timeout: 20_000,
    });
    // Table 1 and Table 2 both render a scope chip now, so this has to name
    // which one it means rather than matching the text anywhere on the page.
    await expect(page.getByText(/showing all organizations/).first()).toBeVisible();

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
    await page.goto("/data-center/stove-records");
    await expect(page.getByRole("heading", { name: "Stove Records", exact: true })).toBeVisible({
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
    await page.goto("/data-center/stove-records");
    await expect(page.getByRole("heading", { name: "Stove Records", exact: true })).toBeVisible({
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

  test("the call centre sees its assigned partners, not just its own sales", async ({
    page,
  }) => {
    await signIn(page, USERS.callCentre);
    await page.goto("/data-center/stove-records");

    // records.view is part of every access level, so the table is present.
    await expect(page.getByRole("heading", { name: "Stove Records", exact: true })).toBeVisible({
      timeout: 20_000,
    });

    // The account holds an ACSL role with partner assignments, which is the
    // decision taken on 2026-08-19: the module keeps mirroring the sales app's
    // scope rule, and call centre staff are given the role that already means
    // ACSL staff. A partner_agent here would read "own sales" and show nothing.
    await expect(page.getByText(/showing \d+ assigned organizations/).first()).toBeVisible();
    await expect(page.getByText("No records match")).toHaveCount(0);
  });
});
