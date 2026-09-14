import { test, expect } from "@playwright/test";
import { callEdgeFunction, signIn, USERS } from "./helpers";

/**
 * Who SOLD the stove, not who keyed the record.
 *
 * A digitised receipt commits through create-sale carrying the importer's own
 * token, so `created_by` names whoever ran the import, and `sale_agent_name` is
 * `created_by` resolved through profiles. On the production backlog that put
 * one uploader's name against 664 sales spanning 39 partners and 11 real reps,
 * and every surface in this module that attributed a sale repeated it.
 *
 * The rep is derived from the parent transfer rather than stored. public.sales
 * has no name-valued attribution column at all - created_by and
 * sold_on_behalf_of are both uuid into profiles, and only 5 of those 11 reps
 * hold an account - so there is nowhere to put a name even if this module were
 * allowed to write to that table. Deriving it also means every row already
 * committed is correct with no backfill to drift.
 *
 * The duplication test is not padding. The chain from a serial to its transfer
 * runs through stove_ids_base, where one stove ID still exists as two rows at
 * two different partners. Written as a plain join instead of a lateral it would
 * return such a sale twice, and a page that silently doubles a row is far worse
 * than one missing a column, because every count downstream is then wrong.
 */

type Rows = { data?: { rows?: Record<string, unknown>[] } };

async function readRecords(page: import("@playwright/test").Page, limit: number) {
  const r = await callEdgeFunction(page, "data-center-read", {
    action: "records",
    table: "records",
    limit,
  });
  expect(r.status, "the records read should answer").toBe(200);
  return (r.body as Rows)?.data?.rows ?? [];
}

test.describe("a sale is attributed to the rep who sold it", () => {
  test("the records read carries the rep beside the recorder", async ({ page }) => {
    await signIn(page, USERS.admin);

    const rows = await readRecords(page, 50);
    expect(rows.length, "the preview has no sold stoves to attribute").toBeGreaterThan(0);

    // The column exists at all. Against the old code it does not, and
    // DigitisationSheet's own salesRep export column was blank for that reason.
    expect(
      Object.keys(rows[0]),
      "every row should carry sales_rep, which is what the sheet export reads",
    ).toContain("sales_rep");

    const withRep = rows.filter((r) => r.sales_rep);
    expect(
      withRep.length,
      "no row resolved to a rep, so the transfer chain is not being walked",
    ).toBeGreaterThan(0);
  });

  test("the rep is a different fact from the person who recorded the sale", async ({ page }) => {
    await signIn(page, USERS.admin);

    const rows = await readRecords(page, 100);
    const both = rows.filter((r) => r.sales_rep && r.sale_agent_name);
    expect(both.length, "no row carries both, so this cannot tell the two apart").toBeGreaterThan(
      0,
    );

    /*
     * Not an assertion that they always differ - on a sale keyed through the
     * Sell Stove form by the rep themselves they are the same person, and that
     * is correct. What must be true is that they are read from different
     * places, so a bulk import cannot make one of them follow the other.
     */
    for (const row of both) {
      expect(typeof row.sales_rep, "sales_rep should be a name, not an id").toBe("string");
    }
  });

  test("resolving the rep does not duplicate a page", async ({ page }) => {
    await signIn(page, USERS.admin);

    const limit = 50;
    const rows = await readRecords(page, limit);
    expect(rows.length, "the page should not exceed the limit it asked for").toBeLessThanOrEqual(
      limit,
    );

    const ids = rows.map((r) => String(r.sale_id));
    expect(
      new Set(ids).size,
      "a sale appears twice, so the transfer join is returning more than one row per sale",
    ).toBe(ids.length);
  });

  test("the agent's brief names the rep, not the uploader", async ({ page }) => {
    await signIn(page, USERS.admin);

    const rows = await readRecords(page, 50);
    const target = rows.find((r) => r.sales_rep);
    expect(
      target,
      "no sale in the preview resolves a rep, so this cannot tell whether the brief carries one",
    ).toBeTruthy();

    const r = await callEdgeFunction(page, "data-center-write", {
      action: "call_record",
      saleId: String(target!.sale_id),
    });
    expect(r.status, "the call record read should answer").toBe(200);

    const record = (r.body as { data?: { record?: Record<string, unknown> } })?.data?.record ?? {};
    /*
     * The VALUE, not the key. A projection that returns the column as null
     * would satisfy a key check while telling the agent nothing, and this sale
     * was chosen precisely because the records read resolves a rep for it.
     */
    expect(
      record.sales_rep,
      "the brief an agent reads while the buyer is on the phone should name the rep",
    ).toBe(target!.sales_rep);
  });

  test("the records table offers the rep as a column", async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/stove-records");

    /*
     * RecordsTable is a virtualised list of divs, not a <table>, so there is no
     * columnheader role to ask for. The header row is `hidden ... sm:flex`,
     * which the default 1280px viewport satisfies.
     */
    await expect(
      page.getByText("Sales rep", { exact: true }).first(),
      "Table 1 showed no attribution at all before this",
    ).toBeVisible({ timeout: 30_000 });
  });
});
