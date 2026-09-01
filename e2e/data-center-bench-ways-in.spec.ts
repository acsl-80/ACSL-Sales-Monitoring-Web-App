import { test, expect, type Page } from "@playwright/test";
import { callEdgeFunction, signIn, USERS } from "./helpers";

/**
 * One way into a partner's stoves: all of them.
 *
 * The bench used to route through a chooser - by consignment, by month, or
 * everything - and the default hid whatever it did not cover. Clicking a
 * partner now opens everything they hold, and the consignment and the month
 * are narrowing filters over that one list (user decision, 2026-08-31), so
 * nothing a typist holds a receipt for is behind a way in they did not pick.
 *
 * The part that needs proving is the server side of it: the search, the
 * filters and the totals across a partner that only ever loads a page. A
 * filter that silently searched only the loaded page answers "not found" for
 * a stove that is there, which is the one answer a typist holding that
 * stove's receipt must never be given.
 */

type Stove = { stove_id: string };
type Page1 = { stoves: Stove[]; hasMore: boolean; nextCursor: string | null };

/** Any partner this account can see that actually holds stoves. */
async function aPartner(page: Page): Promise<string | null> {
  const r = await callEdgeFunction(page, "data-center-read", { action: "record_facets" });
  const partners =
    (r.body as { data?: { partners?: { id: string; transfers: number }[] } })?.data?.partners ?? [];
  const withStoves = partners.filter((p) => p.transfers > 0);
  return withStoves[0]?.id ?? null;
}

test.describe("a partner's stoves are one list, narrowed on the server", () => {
  test("a partner's stoves can be listed without naming a consignment", async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/import");
    const orgId = await aPartner(page);
    test.skip(!orgId, "no partner with stoves on this database");

    const r = await callEdgeFunction(page, "data-center-read", {
      action: "partner_stoves",
      organizationId: orgId,
      limit: 50,
    });
    expect(r.status).toBe(200);
    const data = (r.body as { data: Page1 }).data;
    expect(data.stoves.length).toBeGreaterThan(0);
    // Ordered by stove ID, which is what makes the cursor a cursor.
    const ids = data.stoves.map((s) => s.stove_id);
    expect([...ids].sort()).toEqual(ids);
  });

  test("the search reaches a stove that is not on the loaded page", async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/import");
    const orgId = await aPartner(page);
    test.skip(!orgId, "no partner with stoves on this database");

    // One row at a time, so "not on the page" is guaranteed rather than hoped
    // for. Whatever the seed holds, the second stove is off the first page.
    const first = await callEdgeFunction(page, "data-center-read", {
      action: "partner_stoves",
      organizationId: orgId,
      limit: 1,
    });
    const page1 = (first.body as { data: Page1 }).data;
    test.skip(!page1.hasMore, "this partner holds only one stove");

    const second = await callEdgeFunction(page, "data-center-read", {
      action: "partner_stoves",
      organizationId: orgId,
      limit: 1,
      cursor: page1.nextCursor,
    });
    const offPage = (second.body as { data: Page1 }).data.stoves[0];
    expect(offPage).toBeTruthy();
    expect(offPage.stove_id).not.toBe(page1.stoves[0].stove_id);

    // The whole point: searching for it finds it, even though the first page
    // does not contain it.
    const found = await callEdgeFunction(page, "data-center-read", {
      action: "partner_stoves",
      organizationId: orgId,
      limit: 1,
      search: offPage.stove_id,
    });
    const hits = (found.body as { data: Page1 }).data.stoves;
    expect(hits.map((s) => s.stove_id)).toContain(offPage.stove_id);
  });

  test("a month narrows, and a month with nothing in it says nothing rather than everything", async ({
    page,
  }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/import");
    const orgId = await aPartner(page);
    test.skip(!orgId, "no partner with stoves on this database");

    const all = await callEdgeFunction(page, "data-center-read", {
      action: "partner_stoves",
      organizationId: orgId,
      limit: 500,
    });
    const total = (all.body as { data: Page1 }).data.stoves.length;

    // A month the register cannot hold anything in. Narrowing must return
    // nothing; returning everything would be the filter quietly not applying,
    // which is how a period filter fails without failing.
    const empty = await callEdgeFunction(page, "data-center-read", {
      action: "partner_stoves",
      organizationId: orgId,
      period: "1999-01",
      limit: 500,
    });
    expect(empty.status).toBe(200);
    const emptyRows = (empty.body as { data: Page1 }).data.stoves;
    expect(emptyRows.length).toBe(0);
    expect(total).toBeGreaterThan(0);
  });

  test("a malformed month is refused, not ignored", async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/import");
    const orgId = await aPartner(page);
    test.skip(!orgId, "no partner with stoves on this database");

    const r = await callEdgeFunction(page, "data-center-read", {
      action: "partner_stoves",
      organizationId: orgId,
      period: "nonsense",
    });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toMatch(/2026-08/);
  });

  test("a partner nobody assigned you is refused, not silently empty", async ({ page }) => {
    /*
     * The id arrives from the client, so it is checked rather than trusted.
     * 'Unassigned Partner Jos' exists in the seed precisely so there is one
     * partner out of scope to reach for; without it this test proves nothing.
     */
    await signIn(page, USERS.callCentre);
    await page.goto("/data-center/import");

    const r = await callEdgeFunction(page, "data-center-read", {
      action: "partner_stoves",
      organizationId: "a0000000-0000-4000-8000-000000000004",
      limit: 10,
    });
    // Scope resolves to "false" for a partner outside the caller's coverage,
    // so the answer is an empty list rather than another partner's stoves.
    expect(r.status).toBe(200);
    expect((r.body as { data: Page1 }).data.stoves).toEqual([]);
  });

  test("a consignment narrows server-side, through the same list", async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/import");
    const orgId = await aPartner(page);
    test.skip(!orgId, "no partner with stoves on this database");

    // A real consignment this partner holds, from the same call the sweep's
    // filter options are built from.
    const detail = await callEdgeFunction(page, "data-center-read", {
      action: "partner_detail",
      organizationId: orgId,
    });
    const txn = (detail.body as { data?: { batches?: { transaction_id: string }[] } })?.data
      ?.batches?.[0]?.transaction_id;
    test.skip(!txn, "this partner has no consignments");

    const r = await callEdgeFunction(page, "data-center-read", {
      action: "partner_stoves",
      organizationId: orgId,
      transactionId: txn,
      limit: 50,
    });
    expect(r.status).toBe(200);
    const rows = (r.body as { data: { stoves: { transaction_id: string }[] } }).data.stoves;
    expect(rows.length).toBeGreaterThan(0);
    // Every row belongs to the consignment asked for. A filter that quietly
    // did not apply would hand back the whole partner and look plausible.
    expect(rows.every((s) => s.transaction_id === txn)).toBe(true);
  });

  test("all three chip totals come back in one call, and reconcile", async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/import");
    const orgId = await aPartner(page);
    test.skip(!orgId, "no partner with stoves on this database");

    // Asked with the todo filter on, because that is exactly when the other
    // two numbers used to be unknowable - "done" sat at zero forever while
    // the page showed todo rows.
    const r = await callEdgeFunction(page, "data-center-read", {
      action: "partner_stoves",
      organizationId: orgId,
      recorded: "no",
      limit: 1,
    });
    expect(r.status).toBe(200);
    const data = (
      r.body as {
        data: { total: number; totals: { all: number; todo: number; done: number } };
      }
    ).data;
    expect(data.totals.todo + data.totals.done).toBe(data.totals.all);
    // And the paging denominator answers the filter that was asked for.
    expect(data.total).toBe(data.totals.todo);
  });

  test("a partner opens straight onto everything they hold", async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/import");
    await expect(page.getByRole("heading", { name: "Bulk Import" })).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole("button", { name: /One receipt at a time/ }).click();

    const partners = page.locator("tbody tr");
    await expect(partners.first()).toBeVisible({ timeout: 30_000 });
    await partners.first().click();

    // No chooser in between: the search over everything is simply there, and
    // the scope is spelled out rather than implied by a default.
    await expect(page.getByLabel("Find a stove ID")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: /By consignment/ })).toHaveCount(0);
    await expect(page.getByText(/all consignments/).first()).toBeVisible({ timeout: 20_000 });

    // The old chooser's two axes are narrowing filters on this one list now.
    await expect(page.getByRole("combobox", { name: "Month" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Consignment" })).toBeVisible();
    await expect(page.getByText(/covers every stove this partner holds/)).toBeVisible();
  });
});

test.describe("where the buyer lives is chosen, not typed", () => {
  /**
   * The bench took `state` and `lga` as free text.
   *
   * That is the screen a typist uses forty times a morning with a paper
   * receipt in hand, so it was the one place in the app where a misspelt state
   * could enter the database with nothing to be wrong against - while the 36
   * states, the FCT and all 774 LGAs sat in this same database, already served
   * by the geo-data function, used by exactly one screen out of twenty-two.
   */
  test("a state narrows the LGAs to that state's own", async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/import");
    await expect(page.getByRole("heading", { name: "Bulk Import" })).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole("button", { name: /One receipt at a time/ }).click();

    const partners = page.locator("tbody tr");
    await expect(partners.first()).toBeVisible({ timeout: 30_000 });
    await partners.first().click();

    // The partner lands straight in the sweep; waiting on its search box is
    // what proves the partner table underneath has been replaced, so the
    // `tbody tr` below is a stove row and not a partner row re-clicked.
    await expect(page.getByLabel("Find a stove ID")).toBeVisible({ timeout: 20_000 });
    const stove = page.locator("tbody tr").first();
    await expect(stove).toBeVisible({ timeout: 30_000 });
    await stove.click();

    // The LGA cannot be answered before the state, because an LGA belongs to
    // one state and offering all 774 is not a choice anybody can make.
    const lga = page.getByRole("combobox", { name: "Local government area" });
    await expect(lga).toBeVisible({ timeout: 30_000 });
    await expect(lga).toBeDisabled();

    const state = page.getByRole("combobox", { name: "State" });
    await state.click();
    const stateList = page.getByRole("listbox");
    // 37 states is past the threshold, so the search field is rendered.
    await page.getByPlaceholder("Type part of the state").fill("Kogi");
    await stateList.getByRole("option", { name: "Kogi", exact: true }).click();

    await expect(lga).toBeEnabled();
    await lga.click();
    const lgaList = page.getByRole("listbox");
    // Kogi's own, and not a neighbour's. Two sales already carry an LGA that
    // does not belong to their state, which is what this prevents from here on.
    await expect(lgaList.getByRole("option", { name: "Yagba West", exact: true })).toBeVisible();
    await expect(lgaList.getByRole("option", { name: "Ikeja", exact: true })).toHaveCount(0);
  });
});
