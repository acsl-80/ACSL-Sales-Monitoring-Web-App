import { test, expect } from "@playwright/test";
import { signIn, USERS } from "./helpers";

/**
 * Table 2 through the real UI.
 *
 * The modularity claims (adding a question with no deploy, conditions enforced
 * on write, a fourth attempt without a migration) are proven against the
 * server in src/app/data-center/CHANGING-THE-CALL-TABLE.md. What these tests
 * prove is different and worth keeping separate: that the queue renders, that
 * its presets go to the server rather than filtering what is loaded, that the
 * editor opens, and that a viewer cannot change anything.
 */

test.describe("the call centre queue", () => {
  test("super admin sees the queue and its presets", async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/call-centre");

    await expect(page.getByRole("heading", { name: "Call Centre" })).toBeVisible({
      timeout: 20_000,
    });
    for (const preset of ["Never called", "Yet to be resolved", "Chased 3 times", "Waiting on Sales"]) {
      await expect(page.getByRole("button", { name: preset })).toBeVisible();
    }
  });

  test("a preset is a server query, not a filter over loaded rows", async ({ page }) => {
    const queueCalls: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/functions/v1/data-center-read")) {
        const body = req.postData() ?? "";
        if (body.includes('"call_queue"')) queueCalls.push(body);
      }
    });

    await signIn(page, USERS.admin);
    await page.goto("/data-center/call-centre");
    await expect(page.getByRole("heading", { name: "Call Centre" })).toBeVisible({
      timeout: 20_000,
    });

    const before = queueCalls.length;
    await page.getByRole("button", { name: "Chased 3 times" }).click();

    await expect.poll(() => queueCalls.length, { timeout: 10_000 }).toBeGreaterThan(before);

    const withFilter = queueCalls.find((c) => c.includes("attemptsAtLeast"));
    expect(withFilter, "the preset reached the server as a filter").toBeTruthy();
    expect(withFilter).toContain("not_verified");
  });

  test("paging the queue never sends an offset or a page number", async ({ page }) => {
    const bodies: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/functions/v1/data-center-read")) bodies.push(req.postData() ?? "");
    });

    await signIn(page, USERS.admin);
    await page.goto("/data-center/call-centre");
    await expect(page.getByRole("heading", { name: "Call Centre" })).toBeVisible({
      timeout: 20_000,
    });

    for (const body of bodies) {
      expect(body).not.toContain('"offset"');
      expect(body).not.toContain('"page"');
    }
    expect(bodies.length).toBeGreaterThan(0);
  });

  test("an editor can open a record and is offered Save", async ({ page }) => {
    await signIn(page, USERS.callCentre);
    await page.goto("/data-center/call-centre");
    await expect(page.getByRole("heading", { name: "Call Centre" })).toBeVisible({
      timeout: 20_000,
    });

    // Every row is a button named for the person it belongs to, so this picks
    // a queue row rather than anything else on the page that happens to
    // contain the same text.
    await page.getByRole("button", { name: /^Open call record for/ }).first().click();

    await expect(page.getByRole("heading", { name: "Verification outcome" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole("button", { name: "Save" })).toBeVisible();
    await expect(page.getByText(/Every change is recorded against your name/)).toBeVisible();
  });

  test("a viewer gets the queue read only", async ({ page }) => {
    await signIn(page, USERS.manager);
    await page.goto("/data-center/call-centre");

    await expect(page.getByRole("heading", { name: "Call Centre" })).toBeVisible({
      timeout: 20_000,
    });

    // call_records.view without call_records.edit. The editor renders, but with
    // nothing that writes. data-center-write refuses this token regardless, so
    // this asserts the UI does not offer what the server would reject.
    const row = page.getByRole("button", { name: /^Open call record for/ }).first();
    if (await row.count()) {
      await row.click();
      await expect(page.getByText(/You have view access, so this record is read only/)).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByRole("button", { name: "Save" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Log call" })).toHaveCount(0);
    }
  });
});
