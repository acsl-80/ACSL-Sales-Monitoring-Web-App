import { test, expect, type Page } from "@playwright/test";
import { callEdgeFunction, signIn, USERS } from "./helpers";

/**
 * A record is for the stove ID. Everything else is recorded when present.
 *
 * The first real digitisation file is a paper-receipt transcription: it has a
 * "Sales Model" column and no amount column, no LGA of its own, and no address
 * on 140 of its rows. Under the old rules every one of its 983 rows was
 * refused, for fields the digitiser was never given.
 *
 * So the price comes from the sales model, and the LGA and the address are
 * recorded when the file has them. What stays required is what a record is
 * for: the stove, the buyer, their phone, the date and the state.
 */

const PARTNER = "a0000000-0000-4000-8000-00000000000a";

async function freeStoves(page: Page, n: number): Promise<string[]> {
  const r = await callEdgeFunction(page, "data-center-read", {
    action: "partner_stoves",
    organizationId: PARTNER,
    limit: 200,
  });
  const stoves =
    (r.body as { data?: { stoves?: { stove_id: string; sale_id: string | null }[] } })?.data
      ?.stoves ?? [];
  return stoves.filter((s) => !s.sale_id).slice(0, n).map((s) => s.stove_id);
}

/**
 * Deliberately without an amount, an LGA or an address.
 *
 * `aka` carries a per-run marker and nothing else does. The duplicate-upload
 * guard hashes the parsed rows, so a fixed file matches the previous run and
 * answers 409 - which is the guard working, and would make this test fail for
 * a reason that has nothing to do with pricing.
 */
const receipt = (serial: string, model: string, phone: string, marker = "") => ({
  stove_serial_no: serial,
  sales_model: model,
  first_name: "Seeded",
  last_name: "Buyer",
  aka: marker,
  phone,
  sales_date: "2026-01-04",
  state: "Kogi",
});

type Row = {
  row_number: number;
  status: string;
  normalized: { amount?: number } | null;
  exception_reason: string | null;
  rejection_reason: string | null;
};

test.describe("a row is priced by its sales model", () => {
  test("a known model is priced, an unknown one is refused with somewhere to go", async ({
    page,
  }, testInfo) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/import");

    const stoves = await freeStoves(page, 3);
    test.skip(stoves.length < 3, "not enough free stoves on this database");

    const marker = `price${testInfo.workerIndex}-${Date.now()}`;
    const staged = await callEdgeFunction(page, "data-center-import", {
      action: "stage",
      filename: `${marker}.csv`,
      rows: [
        receipt(stoves[0], "Amina Model", "08014440001", marker),
        receipt(stoves[1], "Partner Sales", "08014440002", marker),
        receipt(stoves[2], "No Such Model", "08014440003", marker),
      ],
    });
    expect(staged.status).toBe(200);
    const batchId = (staged.body as { data: { batchId: string } }).data.batchId;

    const v = await callEdgeFunction(page, "data-center-import", { action: "validate", batchId });
    expect(v.status).toBe(200);

    const rows = ((await callEdgeFunction(page, "data-center-import", {
      action: "rows",
      batchId,
    })).body as { data?: Row[] })?.data ?? [];
    const at = (n: number) => rows.find((r) => r.row_number === n)!;

    // Priced from the table, not from the file, which carried no amount at all.
    expect(at(1).status).toBe("valid");
    expect(Number(at(1).normalized?.amount)).toBe(42000);
    expect(at(2).status).toBe("valid");
    expect(Number(at(2).normalized?.amount)).toBe(56975);

    /*
     * An unpriced model refuses ONE row, not the file, and the reason says
     * where to fix it. create-sale will not accept an amount at or below zero
     * and this module may not change it, so a price is genuinely required -
     * the question is only whether the operator is told where it comes from.
     */
    expect(at(3).status).toBe("rejected");
    const why = at(3).rejection_reason ?? at(3).exception_reason ?? "";
    expect(why).toMatch(/sales model has no price/i);
  });

  test("an amount in the file always beats the model's price", async ({ page }, testInfo) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/import");
    const stoves = await freeStoves(page, 1);
    test.skip(stoves.length < 1, "no free stove");

    const marker = `beats${testInfo.workerIndex}-${Date.now()}`;
    const staged = await callEdgeFunction(page, "data-center-import", {
      action: "stage",
      filename: `${marker}.csv`,
      rows: [{ ...receipt(stoves[0], "Amina Model", "08014440004", marker), amount: "31500" }],
    });
    const batchId = (staged.body as { data: { batchId: string } }).data.batchId;
    await callEdgeFunction(page, "data-center-import", { action: "validate", batchId });

    const rows = ((await callEdgeFunction(page, "data-center-import", {
      action: "rows",
      batchId,
    })).body as { data?: Row[] })?.data ?? [];
    // The table says 42,000 for this model. The file said 31,500 and wins,
    // because the table fills a blank and never overrides what was recorded.
    expect(Number(rows[0]?.normalized?.amount)).toBe(31500);
  });

  test("no LGA and no address is a record, not a rejection", async ({ page }, testInfo) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/import");
    const stoves = await freeStoves(page, 1);
    test.skip(stoves.length < 1, "no free stove");

    const marker = `sparse${testInfo.workerIndex}-${Date.now()}`;
    const staged = await callEdgeFunction(page, "data-center-import", {
      action: "stage",
      filename: `${marker}.csv`,
      rows: [receipt(stoves[0], "Amina Model", "08014440005", marker)],
    });
    const batchId = (staged.body as { data: { batchId: string } }).data.batchId;
    await callEdgeFunction(page, "data-center-import", { action: "validate", batchId });

    const rows = ((await callEdgeFunction(page, "data-center-import", {
      action: "rows",
      batchId,
    })).body as { data?: Row[] })?.data ?? [];
    expect(rows[0]?.status).toBe("valid");
  });

  test("what a record is FOR is still required", async ({ page }, testInfo) => {
    /*
     * The relaxations are not a general loosening. A row with no buyer, or no
     * phone, or no date, cannot be reconciled to anything later and is not a
     * record of a sale - it is a stove ID with a gap after it.
     */
    await signIn(page, USERS.admin);
    await page.goto("/data-center/import");
    const stoves = await freeStoves(page, 2);
    test.skip(stoves.length < 2, "not enough free stoves");

    const marker = `core${testInfo.workerIndex}-${Date.now()}`;
    const noName = { ...receipt(stoves[0], "Amina Model", "08014440006", marker) };
    delete (noName as Record<string, unknown>).first_name;
    delete (noName as Record<string, unknown>).last_name;
    const noPhone = { ...receipt(stoves[1], "Amina Model", "08014440007", marker) };
    delete (noPhone as Record<string, unknown>).phone;

    const staged = await callEdgeFunction(page, "data-center-import", {
      action: "stage",
      filename: `${marker}.csv`,
      rows: [noName, noPhone],
    });
    const batchId = (staged.body as { data: { batchId: string } }).data.batchId;
    await callEdgeFunction(page, "data-center-import", { action: "validate", batchId });

    const rows = ((await callEdgeFunction(page, "data-center-import", {
      action: "rows",
      batchId,
    })).body as { data?: Row[] })?.data ?? [];
    expect(rows.every((r) => r.status === "rejected")).toBe(true);
  });

  test("the bench prices a typed record the same way a file does", async ({ page }, testInfo) => {
    /*
     * One validator, whatever the channel. The price lookup lived inside the
     * bulk path, so a Partner Sales receipt in a FILE was priced and the same
     * receipt typed by hand was refused for having no amount. This is the
     * assertion that keeps the two together.
     */
    await signIn(page, USERS.admin);
    await page.goto("/data-center/import");
    const stoves = await freeStoves(page, 1);
    test.skip(stoves.length < 1, "no free stove");

    const marker = `typed${testInfo.workerIndex}-${Date.now()}`;
    const r = await callEdgeFunction(page, "data-center-import", {
      action: "manual_entry",
      organizationId: PARTNER,
      record: { ...receipt(stoves[0], "Partner Sales", "08014440008", marker), source_note: marker },
    });
    // Accepted, and accepted without an amount in the record.
    expect(r.status, JSON.stringify(r.body).slice(0, 200)).toBe(200);
  });
});
