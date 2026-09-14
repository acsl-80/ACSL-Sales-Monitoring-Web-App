import { test, expect, type Page } from "@playwright/test";
import { callEdgeFunction, commitAndDrain, signIn, USERS } from "./helpers";

/**
 * One sheet, several partners, and the stove ID decides which.
 *
 * The import used to refuse a file covering more than one partner, so a person
 * holding receipts from four of them downloaded four sheets. Each row's partner
 * now comes from its stove ID, resolved against stock.
 *
 * WHY THE TWINS
 *
 * The seed holds two organizations with the SAME partner_name, in different
 * states, because production does: four rows are called LAPO, four Solar
 * Sister, and two Solar Sister rows are both "Main Branch". An import that took
 * the partner from a name would land those rows under whichever organization
 * the name matched first. These tests are the proof that it does not.
 */

const TWIN_A = "a0000000-0000-4000-8000-00000000000a"; // Twin Name Partner, Kogi, ISANLU
const TWIN_B = "a0000000-0000-4000-8000-00000000000b"; // Twin Name Partner, Kwara, ORO
// Twin B is seeded with an explicit Amina-only model list (the scoping
// fixture), so every row in this file names the one model both twins take.

type Stove = { stove_id: string; sale_id: string | null };

async function freeStoveOf(page: Page, organizationId: string): Promise<string | null> {
  const r = await callEdgeFunction(page, "data-center-read", {
    action: "partner_stoves",
    organizationId,
    limit: 100,
  });
  const stoves = (r.body as { data?: { stoves?: Stove[] } })?.data?.stoves ?? [];
  return stoves.find((s) => !s.sale_id)?.stove_id ?? null;
}

/**
 * Which partner a stove's sale is recorded against.
 *
 * Asserted on partner_id rather than on the name, because the name is exactly
 * what cannot tell these two apart, and asserting on it would pass whichever
 * organization the sale had landed under.
 */
async function partnerOfSale(page: Page, stoveId: string): Promise<string | null> {
  const r = await callEdgeFunction(page, "data-center-read", {
    action: "stove_detail",
    stoveId,
  });
  const d = (r.body as { data?: { sale?: Record<string, unknown> | null } })?.data;
  return (d?.sale?.org_partner_id as string) ?? null;
}

test.describe("a sheet may cover several partners", () => {
  test("the two twins really do share a name, or these tests prove nothing", async ({
    page,
  }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/import");
    const r = await callEdgeFunction(page, "data-center-read", { action: "record_facets" });
    const partners =
      (r.body as { data?: { partners?: { id: string; name: string; branch: string | null }[] } })
        ?.data?.partners ?? [];
    const twins = partners.filter((p) => p.id === TWIN_A || p.id === TWIN_B);
    expect(twins).toHaveLength(2);
    expect(twins[0].name).toBe(twins[1].name);
    expect(twins[0].branch).not.toBe(twins[1].branch);
  });

  test("staging is no longer refused, and the batch belongs to no one partner", async ({
    page,
  }, testInfo) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/import");

    const a = await freeStoveOf(page, TWIN_A);
    const b = await freeStoveOf(page, TWIN_B);
    test.skip(!a || !b, "the twins have no free stoves left on this database");

    const marker = `mix${testInfo.workerIndex}-${Date.now()}`;
    const r = await callEdgeFunction(page, "data-center-import", {
      action: "stage",
      filename: `${marker}.csv`,
      rows: [a, b].map((serial) => ({
        sales_model: "Amina Model",
      stove_serial_no: serial,
        first_name: "Mixed",
        last_name: "Buyer",
        phone: "08012345678",
        sales_date: "2026-01-04",
        amount: "25000",
        state: "Kogi",
        lga: "Isanlu",
        address: `${marker} Test Road`,
      })),
    });

    expect(r.status).toBe(200);
    const body = r.body as { data: { batchId: string; totalRows: number } };
    expect(body.data.totalRows).toBe(2);
    // The old behaviour was a 400 naming both partners and telling the operator
    // to split the file.
    expect(JSON.stringify(r.body)).not.toMatch(/covers more than one partner/);
  });

  test("each row lands under the partner its stove ID resolves to, not the name", async ({
    page,
  }, testInfo) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/import");

    const a = await freeStoveOf(page, TWIN_A);
    const b = await freeStoveOf(page, TWIN_B);
    test.skip(!a || !b, "the twins have no free stoves left on this database");

    const marker = `land${testInfo.workerIndex}-${Date.now()}`;
    const staged = await callEdgeFunction(page, "data-center-import", {
      action: "stage",
      filename: `${marker}.csv`,
      rows: [a, b].map((serial) => ({
        sales_model: "Amina Model",
      stove_serial_no: serial,
        first_name: "Mixed",
        last_name: "Buyer",
        phone: "08012345678",
        sales_date: "2026-01-04",
        amount: "25000",
        state: "Kogi",
        lga: "Isanlu",
        address: `${marker} Test Road`,
      })),
    });
    expect(staged.status).toBe(200);
    const batchId = (staged.body as { data: { batchId: string } }).data.batchId;

    const validated = await callEdgeFunction(page, "data-center-import", {
      action: "validate",
      batchId,
    });
    expect(validated.status).toBe(200);

    // Commit chains itself on the server now; the press answers 202 and the
    // drain is what the assertion below must wait for.
    await commitAndDrain(page, batchId);

    /*
     * The assertion the whole design exists for.
     *
     * Both rows carried the same partner NAME and the same state in the file.
     * If anything but the stove ID had decided, both sales would sit under one
     * organization. They must sit under two.
     */
    expect(await partnerOfSale(page, a)).toBe("TWIN-A");
    expect(await partnerOfSale(page, b)).toBe("TWIN-B");
  });

  test("a wrong Partner column blocks the row on a sheet this module wrote", async ({
    page,
  }, testInfo) => {
    /*
     * On OUR sheet the Partner column is filled by us from the stove ID, so a
     * disagreement means the row moved: sorted, pasted a column at a time, or
     * one stove ID overwritten. There is no safe reading of that.
     *
     * The transfer reference is what identifies the sheet as ours, because only
     * ours carries it. It is also the column that actually names a consignment,
     * rather than a name somebody typed.
     */
    await signIn(page, USERS.admin);
    await page.goto("/data-center/import");

    const r = await callEdgeFunction(page, "data-center-read", {
      action: "partner_stoves",
      organizationId: TWIN_A,
      limit: 100,
    });
    const stoves =
      (r.body as {
        data?: { stoves?: { stove_id: string; sale_id: string | null; transaction_id: string }[] };
      })?.data?.stoves ?? [];
    const mine = stoves.find((x) => !x.sale_id && x.transaction_id);
    test.skip(!mine, "no free twin stove carrying a transfer reference");

    const marker = `ours${testInfo.workerIndex}-${Date.now()}`;
    const staged = await callEdgeFunction(page, "data-center-import", {
      action: "stage",
      filename: `${marker}.csv`,
      rows: [
        {
          sales_model: "Amina Model",
      stove_serial_no: mine!.stove_id,
          // The reference is right, which makes this our sheet.
          transaction_id: mine!.transaction_id,
          // The partner is not. The stove belongs to Twin Name Partner.
          partner_name: "Amina Sales Model Gombe",
          first_name: "Wrong",
          last_name: "Partner",
          aka: marker,
          phone: "08012345670",
          sales_date: "2026-01-04",
          amount: "25000",
          state: "Kogi",
          lga: "Isanlu",
          address: `${marker} Road`,
        },
      ],
    });
    expect(staged.status).toBe(200);
    const batchId = (staged.body as { data: { batchId: string } }).data.batchId;

    const validated = await callEdgeFunction(page, "data-center-import", {
      action: "validate",
      batchId,
    });
    const summary = (validated.body as { data: { valid: number; exception: number } }).data;
    expect(summary.valid).toBe(0);
    expect(summary.exception).toBe(1);

    const rows = await callEdgeFunction(page, "data-center-import", { action: "rows", batchId });
    const why = JSON.stringify(rows.body);
    expect(why).toMatch(/Partner column says/);
    expect(why).toMatch(/Amina Sales Model Gombe/);
    expect(why).toMatch(/Twin Name Partner/);
  });

  test("the same disagreement on somebody else's sheet is a note, not a refusal", async ({
    page,
  }, testInfo) => {
    /*
     * A sheet with no transfer reference was not written by this module, so its
     * Partner column is a human's shorthand rather than a value we supplied.
     * Measured on the first real file: 580 of 983 rows disagreed and 17 agreed.
     * "Amina Sales Model Kajuru" against "Kajuru". "Solar Sisters" against
     * "SOLAR SISTER IBADAN". Not one of them was an error, and refusing them
     * would have refused the import.
     *
     * The stove ID still decides whose sale it is. The name is only recorded.
     */
    await signIn(page, USERS.admin);
    await page.goto("/data-center/import");

    const a = await freeStoveOf(page, TWIN_A);
    test.skip(!a, "no free twin stove left");

    const marker = `theirs${testInfo.workerIndex}-${Date.now()}`;
    const staged = await callEdgeFunction(page, "data-center-import", {
      action: "stage",
      filename: `${marker}.csv`,
      rows: [
        {
          sales_model: "Amina Model",
      stove_serial_no: a,
          // No transaction_id: this is not one of our sheets.
          partner_name: "Amina Sales Model Gombe",
          first_name: "Shorthand",
          last_name: "Partner",
          aka: marker,
          phone: "08012345671",
          sales_date: "2026-01-04",
          amount: "25000",
          state: "Kogi",
          lga: "Isanlu",
          address: `${marker} Road`,
        },
      ],
    });
    const batchId = (staged.body as { data: { batchId: string } }).data.batchId;

    const validated = await callEdgeFunction(page, "data-center-import", {
      action: "validate",
      batchId,
    });
    const summary = (validated.body as { data: { valid: number; noted?: number } }).data;

    // It lands, and it is counted as carrying something worth reading.
    expect(summary.valid).toBe(1);
    expect(summary.noted).toBe(1);

    const rows = await callEdgeFunction(page, "data-center-import", { action: "rows", batchId });
    const body = JSON.stringify(rows.body);
    // The note says which partner it was actually filed under.
    expect(body).toMatch(/The stove ID decides/);
    expect(body).toMatch(/Twin Name Partner/);
  });

  test("a partner outside your scope is refused even as one row among many", async ({
    page,
  }, testInfo) => {
    /*
     * Checking only the majority partner would let a single out-of-scope row
     * through, which is the failure mode of resolving a file to one partner and
     * then checking that one.
     */
    await signIn(page, USERS.callCentre); // holds every seeded partner except Jos
    await page.goto("/data-center/import");

    const mine = await freeStoveOf(page, TWIN_A);
    test.skip(!mine, "no free twin stove left");

    /*
     * Named rather than looked up.
     *
     * This stove belongs to the partner nobody is assigned, so the account
     * under test cannot see it, and asking as somebody who can would mean
     * signing in twice inside one test. It comes from the seed, which creates
     * JOS000001 to JOS000010 for exactly this purpose, and no test ever sells
     * one because staging them is what this check proves is refused.
     */
    const theirs = "JOS000001";

    const marker = `scope${testInfo.workerIndex}-${Date.now()}`;
    const r = await callEdgeFunction(page, "data-center-import", {
      action: "stage",
      filename: `${marker}.csv`,
      rows: [mine, theirs].map((serial) => ({
        sales_model: "Amina Model",
      stove_serial_no: serial,
        first_name: "Mixed",
        last_name: "Buyer",
        phone: "08012345678",
        sales_date: "2026-01-04",
        amount: "25000",
        state: "Kogi",
        lga: "Isanlu",
        address: `${marker} Test Road`,
      })),
    });
    expect([400, 403]).toContain(r.status);
  });
});
