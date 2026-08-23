import { test, expect } from "@playwright/test";
import { signIn, dataCentreNavLink, USERS, callEdgeFunction } from "./helpers";

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

    // Viewer sees, editor changes. On the hub the import card is present and
    // locked, naming the grant it needs, so what a viewer must not get is the
    // way in rather than the word. Reaching /data-center/import directly is
    // refused too, which data-center-explore.spec.ts covers.
    await expect(page.getByRole("link", { name: "Open Bulk Import" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Open Stove Records" })).toBeVisible();
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

    // An editor holds import.upload and call_records.edit, so every area of
    // the data is open to them. Asserting the cards rather than a feature count
    // tests the gate itself instead of a label describing it.
    for (const area of ["Dashboard", "Call Centre", "Partner Records", "Stove Records", "Bulk Import"]) {
      await expect(page.getByRole("link", { name: `Open ${area}` })).toBeVisible({
        timeout: 20_000,
      });
    }

    // Settings is the exception, and deliberately. Administration is not an
    // editor's job: deciding who may enter the module and rewriting the
    // questions every agent answers are two things an editor does not do.
    await expect(page.getByRole("link", { name: "Open Settings" })).toHaveCount(0);
    await expect(page.getByText(/^Needs /)).toHaveText("Needs grants.manage");
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
    // Settings is administration, so a viewer sees it locked like any other
    // card they do not hold.
    await expect(page.getByRole("link", { name: "Open Settings" })).toHaveCount(0);
    await expect(page.getByText("grants.manage")).toBeVisible();
  });
});

/**
 * Administration lives on its own page now.
 *
 * It used to render as two panels below the Explore grid, which put a user list
 * and an audit log in front of everyone who opened the hub on their way to a
 * queue. The hub is six cards; the sixth opens these two.
 */
test.describe("access and the log live on Settings, not on the hub", () => {
  test("the hub carries neither panel", async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center");

    await expect(page.getByRole("link", { name: "Open Settings" })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole("heading", { name: "Access", exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Recent changes" })).toHaveCount(0);
  });

  test("super admin opens Settings and finds access first, then the log", async ({
    page,
  }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center");
    await page.getByRole("link", { name: "Open Settings" }).click();

    await expect(page).toHaveURL(/\/data-center\/settings/);
    await expect(page.getByRole("heading", { name: "Access", exact: true })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole("heading", { name: "Recent changes" })).toBeVisible();

    // The seeded grants are listed with their levels.
    /**
     * Both anchored, for two different reasons that arrived a day apart.
     *
     * "manager@" is a substring of "datamanager@", so a loose match started
     * resolving to two people the day that account was seeded. And Settings
     * has since grown a send-back routing panel whose "Add somebody" select
     * lists every candidate as "Name - email", so every address on this page
     * now appears twice.
     *
     * Anchoring pins both to the grants list, where the row starts with the
     * address and the select option starts with the person name.
     */
    await expect(page.getByText(/^callcentre@preview\.acsl\.test/)).toBeVisible();
    await expect(page.getByText(/^manager@preview\.acsl\.test/)).toBeVisible();
  });

  test("an editor is refused Settings by URL, not merely offered no card", async ({
    page,
  }) => {
    await signIn(page, USERS.callCentre);
    await page.goto("/data-center/settings");

    await expect(
      page.getByRole("heading", { name: "Not part of your access" }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("heading", { name: "Access", exact: true })).toHaveCount(0);
  });
});

/**
 * The log reads as a log.
 *
 * It rendered the audit table as stored - an action word, a table name and a
 * primary key - which is a row of the database, not a record of the work.
 */
test.describe("the change log is readable and categorised", () => {
  test("changes read as sentences, filtered by part of the module", async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/settings");

    await expect(page.getByRole("heading", { name: "Recent changes" })).toBeVisible({
      timeout: 20_000,
    });

    // Every category the server can return is offered, plus everything.
    for (const chip of [
      "Everything", "Call records", "Calls logged", "Documents",
      "Imports", "Assignment", "Access", "Configuration",
    ]) {
      await expect(page.getByRole("button", { name: chip, exact: true })).toBeVisible();
    }

    // Access grants are seeded, so that category has entries and they name a
    // person and a thing rather than a table.
    await page.getByRole("button", { name: "Access", exact: true }).click();
    await expect(page.getByRole("button", { name: "Access", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(
      page.getByText(/granted an access grant|No access changes yet/).first(),
    ).toBeVisible({ timeout: 15_000 });

    // And nothing from another category is left underneath it. Picking a
    // category used to race the request already in flight, and "everything" is
    // the biggest page so it landed last: the chip read Access while the rows
    // were every category. Showing the wrong rows under a filter is worse than
    // showing none, because nothing about it looks wrong.
    // Scoped to the log's own card. Settings also carries the access list,
    // which is a list of people in exactly the same shape, so an unscoped
    // locator reads a name and asks why it is not an access grant.
    //
    // The first paragraph of each entry is the sentence; the second, when it
    // is there, lists the fields that moved. Matching on a verb caught both,
    // and "2 fields changed" is not a subject either.
    const log = page
      .getByRole("heading", { name: "Recent changes" })
      .locator("xpath=ancestor::div[contains(@class,'rounded-xl')][1]");
    const subjects = await log.locator("li div > p:first-child").allInnerTexts();
    expect(subjects.length).toBeGreaterThan(0);
    for (const line of subjects) {
      expect(line).toMatch(/access grant/);
    }

    // The raw table name never reaches the reader.
    await expect(page.getByText("data_center.module_access")).toHaveCount(0);
  });

  test("the log exports for analysis", async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/settings");

    await expect(page.getByRole("heading", { name: "Recent changes" })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole("button", { name: /Export CSV/ })).toBeVisible();
  });
});

/**
 * The call agent, the third level.
 *
 * Not a rung between viewer and editor. A different job: work the phone, read
 * the records behind the calls, import nothing. "Editor" used to cover both the
 * clerk clearing a receipt backlog and the agent making calls, which meant
 * everyone making calls also held import.upload, one step from import.commit
 * and the sales app's own inventory.
 */
test.describe("the call agent is its own level", () => {
  test("a call agent is admitted, and offered the call centre", async ({ page }) => {
    await signIn(page, USERS.acslAgent);

    await expect(dataCentreNavLink(page)).toBeVisible({ timeout: 20_000 });
    await page.goto("/data-center");

    await expect(page.getByRole("link", { name: "Open Call Centre" })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole("link", { name: "Open Dashboard" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open Stove Records" })).toBeVisible();
  });

  test("a call agent is offered no way to import", async ({ page }) => {
    await signIn(page, USERS.acslAgent);
    await page.goto("/data-center");

    // Locked rather than hidden, and it names the grant it wants, which is the
    // same treatment a viewer gets.
    await expect(page.getByText("Bulk Import")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("link", { name: "Open Bulk Import" })).toHaveCount(0);
    await expect(page.getByText("import.upload")).toBeVisible();
  });

  test("the import endpoint refuses a call agent, not just the card", async ({
    page,
  }) => {
    await signIn(page, USERS.acslAgent);
    await page.goto("/data-center");
    await expect(page.getByRole("link", { name: "Open Call Centre" })).toBeVisible({
      timeout: 20_000,
    });

    // A locked card is presentation. The permission is only real if the
    // endpoint refuses the token, whatever the browser sends.
    const refused = await callEdgeFunction(page, "data-center-import", {
      action: "partners",
    });
    expect(refused.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(refused.body)).toMatch(/import\.upload/);
  });

  test("a call agent may edit call records, which is the job", async ({ page }) => {
    await signIn(page, USERS.acslAgent);
    await page.goto("/data-center/call-centre");
    await expect(page.getByRole("heading", { name: "Call Centre" })).toBeVisible({
      timeout: 20_000,
    });

    // The write endpoint accepting the token is what proves the level reached
    // the server, rather than the UI having been told about it locally.
    const schema = await callEdgeFunction(page, "data-center-write", {
      action: "form_schema",
    });
    expect(schema.status).toBe(200);
  });
});

/**
 * F2: two of data-center-write's five actions are reads.
 *
 * `form_schema` returns the questions and `call_record` returns one record
 * with its history. Both were gated on call_records.edit, so a viewer could
 * reach the call centre table and open nothing on it. The existing read-only
 * test never caught it: the manager account has no assigned organizations, so
 * the queue is empty and the assertion behind its row guard never ran.
 */
test.describe("a viewer can read a call record", () => {
  test("form_schema answers a viewer rather than refusing", async ({ page }) => {
    await signIn(page, USERS.manager);
    await page.goto("/data-center/call-centre");
    await expect(page.getByRole("heading", { name: "Call Centre" })).toBeVisible({
      timeout: 20_000,
    });

    const schema = await callEdgeFunction(page, "data-center-write", {
      action: "form_schema",
    });
    expect(
      schema.status,
      "a viewer must be able to fetch the form definition, or the record editor never renders for them",
    ).toBe(200);
  });

  test("saving is still refused for a viewer", async ({ page }) => {
    await signIn(page, USERS.manager);
    await page.goto("/data-center/call-centre");
    await expect(page.getByRole("heading", { name: "Call Centre" })).toBeVisible({
      timeout: 20_000,
    });

    // The other half of the fix: opening a record loosened, writing did not.
    const saved = await callEdgeFunction(page, "data-center-write", {
      action: "save_call_record",
      saleId: "00000000-0000-4000-8000-000000000000",
      values: {},
      version: null,
    });
    expect(saved.status).toBe(403);
    expect(JSON.stringify(saved.body)).toMatch(/Not permitted to change call records/);
  });
});
