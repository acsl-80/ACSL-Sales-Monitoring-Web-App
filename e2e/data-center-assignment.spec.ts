import { test, expect } from "@playwright/test";
import { signIn, USERS, callEdgeFunction } from "./helpers";

/**
 * The engine's levers and the feed that shows its work (Phase 26, C2 moved
 * these from the assignment log to the shift board and the activity feed).
 */
test.describe("the control centre's levers and feed", () => {
  test("it renders on the call centre page with the engine's work", async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/call-centre");
    await expect(page.getByRole("heading", { name: "Agents and their work" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("heading", { name: /^What happened/ })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Export agents" })).toBeVisible();
  });

  test("admins get the levers, and they answer on the board", async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/call-centre");
    await expect(page.getByRole("heading", { name: "Agents and their work" })).toBeVisible({ timeout: 40_000 });
    await expect(page.getByRole("button", { name: "Assign now" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reclaim quiet batches" }).first()).toBeVisible();
    await page.getByRole("button", { name: "Assign now" }).click();
    const ask = page.getByRole("alertdialog");
    await expect(ask).toContainText("Run the engine now?", { timeout: 10_000 });
    await ask.getByRole("button", { name: "Run", exact: true }).click();
    const answered = page.getByText(/assigned\.|Nothing to hand out/i);
    const failed = page.getByText(/The engine could not run|Reclaim failed/i);
    await expect(answered.or(failed)).toBeVisible({ timeout: 20_000 });
    await expect(failed, "assignment answered with an error rather than a result").toHaveCount(0);
  });

  test("an editor gets the activity page, their own rows, and no levers", async ({ page }) => {
    await signIn(page, USERS.callCentre);
    await page.goto("/data-center/call-centre");
    await expect(page.getByRole("heading", { name: "Call Centre" }).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Assign now" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Reclaim quiet batches" })).toHaveCount(0);
    await page.goto("/data-center/call-centre/activity");
    await expect(page.getByRole("heading", { name: "Activity" }).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Your own activity. A manager sees everyone's.")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByLabel("Agent")).toHaveCount(0);
  });

  test("the run lever is refused server-side for a non-admin", async ({ page }) => {
    await signIn(page, USERS.callCentre);
    await page.goto("/data-center/call-centre");
    await expect(page.getByRole("heading", { name: "Call Centre" }).first()).toBeVisible({ timeout: 20_000 });
    const refused = await callEdgeFunction(page, "data-center-assign", { action: "run" });
    expect(refused.status).toBe(403);
    const said = JSON.stringify(refused.body);
    expect(said).toMatch(/assignment\.manage/);
    expect(said).toMatch(/data manager/);
  });

  test("a call agent can read their own batches", async ({ page }) => {
    await signIn(page, USERS.acslAgent);
    await page.goto("/data-center/call-centre");
    await expect(page.getByRole("heading", { name: "Call Centre" })).toBeVisible({ timeout: 20_000 });
    const mine = await callEdgeFunction(page, "data-center-assign", { action: "my_batches" });
    expect(mine.status).toBe(200);
    const items = (mine.body as { data?: { items: { partner_name: string }[] } })?.data?.items ?? [];
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.partner_name).toBe("Amina Sales Model Gombe");
    }
  });

  test("the feed and the activity page are keyset paginated, never offset", async ({ page }) => {
    const bodies: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/functions/v1/data-center-assign")) bodies.push(req.postData() ?? "");
    });
    await signIn(page, USERS.admin);
    await page.goto("/data-center/call-centre/activity");
    await expect(page.getByRole("heading", { name: "Activity" }).first()).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => bodies.some((b) => b.includes('"activity"')), { timeout: 15_000 }).toBe(true);
    for (const body of bodies.filter((b) => b.includes('"activity"') || b.includes('"pool_partners"'))) {
      expect(body).not.toContain('"offset"');
      expect(body).not.toContain('"page"');
    }
    await expect(page.getByRole("button", { name: "Previous page" })).toBeDisabled();
    await expect(page.getByLabel("Per page")).toBeVisible();
  });
});
