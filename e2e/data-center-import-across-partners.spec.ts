import { test, expect, type Page } from "@playwright/test";
import { callEdgeFunction, signIn, USERS } from "./helpers";

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

    // Commit runs in slices; two rows is one slice.
    const committed = await callEdgeFunction(page, "data-center-import", {
      action: "commit",
      batchId,
    });
    expect(committed.status).toBe(200);

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
