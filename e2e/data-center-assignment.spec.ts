import { test, expect } from "@playwright/test";
import { signIn, USERS, callEdgeFunction } from "./helpers";

/**
 * The assignment engine, through its doorway.
 *
 * The engine itself lives in SQL under an advisory lock, and its behaviour
 * (assign, capacity, reclaim, the same-partner refusal) was proven directly
 * against the preview database. What the browser can add is the boundary: who
 * may pull which lever, and that the log renders what the engine did.
 */

test.describe("the assignment log", () => {
  test("it renders on the call centre page with the engine's work", async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/call-centre");

    await expect(page.getByText("Assignment Log")).toBeVisible({ timeout: 20_000 });

    // The preview seeding assigned one batch of 5 to the enabled agent, so
    // the log has rows, each carrying the batch state and the agent.
    await expect(page.getByRole("cell", { name: "open" }).first()).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole("button", { name: /Export CSV/ })).toBeVisible();
  });

  test("admins get the levers, and they answer in the same table", async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/call-centre");
    // An admin's call centre now draws the queue, the assignment console and
    // the log, so the access check has more waiting behind it than it did.
    // Seen stuck on "Checking your Data Center access..." for a full 20s once
    // and fine on either side of it.
    await expect(page.getByText("Assignment Log")).toBeVisible({ timeout: 40_000 });

    await expect(page.getByRole("button", { name: "Assign now" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Reclaim quiet batches" }),
    ).toBeVisible();

    /*
     * Pressing assign must ANSWER, and the assertion has to cover every way it
     * can. Two faults were in the old one.
     *
     * It matched the literal "batch(es) assigned", which `plural()` never
     * produces - the text is "0 batches assigned" or "1 batch assigned". So it
     * was passing entirely on the "Nothing to hand out" half, which only holds
     * while the callable pool is empty. The day preview has callable records it
     * would have failed for a reason unrelated to the feature.
     *
     * And it waited only for the success notice. When the call errors the page
     * renders an amber error block instead, so the test sat out its timeout and
     * reported "element(s) not found" - which says nothing about what happened.
     * It failed exactly that way once in a full-suite run and passed three times
     * in isolation, and the page's own explanation was never captured.
     *
     * So: wait for either, then say which. An error now fails immediately, with
     * its own text as the reason.
     */
    await page.getByRole("button", { name: "Assign now" }).click();
    // Since slice 7b the lever asks first; this is the yes.
    const ask = page.getByRole("alertdialog");
    await expect(ask).toContainText("Run the engine now?", { timeout: 10_000 });
    await ask.getByRole("button", { name: "Run", exact: true }).click();

    const answered = page.getByText(/assigned\.|Nothing to hand out/i);
    const failed = page.getByText(/The engine could not run|Reclaim failed/i);
    await expect(answered.or(failed)).toBeVisible({ timeout: 20_000 });
    await expect(
      failed,
      "assignment answered with an error rather than a result",
    ).toHaveCount(0);
  });

  test("an editor sees the log without the levers", async ({ page }) => {
    await signIn(page, USERS.callCentre);
    await page.goto("/data-center/call-centre");
    await expect(page.getByText("Assignment Log")).toBeVisible({ timeout: 20_000 });

    await expect(page.getByRole("button", { name: "Assign now" })).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Reclaim quiet batches" }),
    ).toHaveCount(0);
  });

  test("the run lever is refused server-side for a non-admin", async ({ page }) => {
    await signIn(page, USERS.callCentre);
    await page.goto("/data-center/call-centre");
    await expect(page.getByText("Assignment Log")).toBeVisible({ timeout: 20_000 });

    // A hidden button is not a permission. The endpoint is the boundary.
    const refused = await callEdgeFunction(page, "data-center-assign", {
      action: "run",
    });
    expect(refused.status).toBe(403);
    /**
     * The refusal names the permission and how to get it.
     *
     * It used to say "Only a super admin", which stopped being true when the
     * data manager level was added: assignment is theirs to run too. A message
     * that names the wrong authority sends people to the wrong person.
     */
    const said = JSON.stringify(refused.body);
    expect(said).toMatch(/assignment\.manage/);
    expect(said).toMatch(/data manager/);
  });

  test("a call agent can read their own batches", async ({ page }) => {
    await signIn(page, USERS.acslAgent);
    await page.goto("/data-center/call-centre");
    await expect(
      page.getByRole("heading", { name: "Call Centre" }),
    ).toBeVisible({ timeout: 20_000 });

    // The one action agents call. Scoped to the token: there is no parameter
    // for asking about anyone else's queue.
    const mine = await callEdgeFunction(page, "data-center-assign", {
      action: "my_batches",
    });
    expect(mine.status).toBe(200);
    const items = (mine.body as { data?: { items: { partner_name: string }[] } })?.data
      ?.items ?? [];
    expect(items.length).toBeGreaterThan(0);
    // Every item in one batch is one partner; the seeded pool is all Gombe.
    for (const item of items) {
      expect(item.partner_name).toBe("Amina Sales Model Gombe");
    }
  });

  test("the log is keyset paginated, never offset", async ({ page }) => {
    const bodies: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/functions/v1/data-center-read")) {
        bodies.push(req.postData() ?? "");
      }
    });

    await signIn(page, USERS.admin);
    await page.goto("/data-center/call-centre");
    await expect(page.getByText("Assignment Log")).toBeVisible({ timeout: 20_000 });

    await expect
      .poll(() => bodies.some((b) => b.includes('"assignment_log"')), { timeout: 15_000 })
      .toBe(true);
    for (const body of bodies) {
      expect(body).not.toContain('"offset"');
    }
  });
});
