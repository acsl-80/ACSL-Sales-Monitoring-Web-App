import { test, expect } from "@playwright/test";
import { signIn, USERS, callEdgeFunction } from "./helpers";

/**
 * Settings: who is in, what the form asks, and what the rules read.
 *
 * The module's claim was that adding a question is data entry rather than a
 * release. It was half true - nothing hard-coded a question, and nothing could
 * add one either. These tests hold the half that was missing.
 */

test.describe("the call form is editable", () => {
  test("questions and dropdowns are both offered", async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/settings");

    await expect(page.getByRole("heading", { name: "Call form" })).toBeVisible({
      timeout: 20_000,
    });

    // Two halves, because they are two jobs. Questions is the default.
    await expect(page.getByRole("button", { name: "Questions", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByRole("button", { name: "Add question" })).toBeVisible();

    await page.getByRole("button", { name: "Dropdowns", exact: true }).click();
    await expect(page.getByRole("button", { name: "Add choice" })).toBeVisible();
  });

  test("the call outcomes include somewhere to say what else happened", async ({
    page,
  }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/settings");
    await expect(page.getByRole("heading", { name: "Call form" })).toBeVisible({
      timeout: 20_000,
    });

    await page.getByRole("button", { name: "Dropdowns", exact: true }).click();
    /*
     * A combobox rather than a native select now, so the option is clicked in
     * the popover instead of chosen by value. The list is small enough to sit
     * below the search threshold, which is why there is nothing to type into.
     */
    await page.getByRole("combobox", { name: "Dropdown" }).click();
    await page
      .getByRole("listbox")
      .getByRole("option", { name: /outcome/i })
      .first()
      .click();

    // The nine seeded outcomes came from a closed list. This is the tenth, and
    // it exists so an agent stops inventing one in a constrained column.
    await expect(page.getByText("Something else (say what)")).toBeVisible();
  });

  test("a question added through the panel is asked on the next load", async ({
    page,
  }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/settings");
    await expect(page.getByRole("heading", { name: "Call form" })).toBeVisible({
      timeout: 20_000,
    });

    // Through the endpoint rather than the form, because what is being proved
    // is that the registry drives the renderer, not that a text input types.
    const key = `e2e_probe_${Date.now()}`;
    const added = await callEdgeFunction(page, "data-center-admin", {
      action: "field_def_upsert",
      field: {
        key,
        label: "E2E probe question",
        section: "service",
        inputType: "text",
        sortOrder: 98,
      },
    });
    expect(added.status).toBe(200);

    await page.reload();
    await expect(page.getByRole("heading", { name: "Call form" })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText("E2E probe question")).toBeVisible();

    // Retiring keeps the row and stops the asking: records point at answers
    // already given, and history is not rewritten by a change of mind.
    const retired = await callEdgeFunction(page, "data-center-admin", {
      action: "field_def_upsert",
      field: {
        key,
        label: "E2E probe question",
        section: "service",
        inputType: "text",
        sortOrder: 98,
        isActive: false,
      },
    });
    expect(retired.status).toBe(200);
  });

  test("a question needs a key the database can live with", async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/settings");
    await expect(page.getByRole("heading", { name: "Access", exact: true })).toBeVisible({
      timeout: 20_000,
    });

    const bad = await callEdgeFunction(page, "data-center-admin", {
      action: "field_def_upsert",
      field: { key: "Not A Key", label: "x", section: "service", inputType: "text" },
    });
    expect(bad.status).toBe(400);

    // A dropdown with no list behind it would render an empty select.
    const noList = await callEdgeFunction(page, "data-center-admin", {
      action: "field_def_upsert",
      field: { key: "e2e_no_list", label: "x", section: "service", inputType: "select" },
    });
    expect(noList.status).toBe(400);
  });
});

test.describe("the variables are editable", () => {
  test("the numbers every rule reads are shown", async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/settings");

    await expect(page.getByRole("heading", { name: "Variables" })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByLabel("assignment.batch_size", { exact: true })).toBeVisible();
    await expect(page.getByLabel("callback_limit", { exact: true })).toBeVisible();
  });

  test("only a setting that already exists can be changed", async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/settings");
    await expect(page.getByRole("heading", { name: "Variables" })).toBeVisible({
      timeout: 20_000,
    });

    // A new key would be a setting nothing reads, which looks like it took
    // effect and never does.
    const invented = await callEdgeFunction(page, "data-center-admin", {
      action: "config_set",
      config: { key: "not.a.real.setting", value: 1 },
    });
    expect(invented.status).toBe(400);
  });
});

test.describe("features are ticked on per person", () => {
  test("opening a person shows the features they hold", async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/settings");
    await expect(page.getByRole("heading", { name: "Access", exact: true })).toBeVisible({
      timeout: 20_000,
    });

    await page.getByRole("button", { name: /^Features for / }).first().click();

    await expect(page.getByText("Extra features", { exact: true })).toBeVisible();
    // The level is the baseline and a tick is an addition; grants.manage is the
    // one that decides whether somebody who is not a super admin sees this page.
    await expect(page.getByText("grants.manage").first()).toBeVisible();
    await expect(page.getByText("registry.manage").first()).toBeVisible();
  });
});
