import { test, expect, type Page } from "@playwright/test";
import { callEdgeFunction, commitAndDrain, signIn, USERS } from "./helpers";

/**
 * Expected comes from the sheet or the model. Paid is ONLY what was stated.
 *
 * The first committed run of the real digitisation file wrote every sale as
 * fully paid - 86 rows, paid = expected, `fully_paid` - when the sheet stated
 * no paid figure on a single one of them. create-sale's outright path coerces
 * paid to the full amount by design, and the import was using that path.
 *
 * The rule, as the operator gave it: the price is assigned as EXPECTED (stated
 * amount first, else the model's price); actual paid is treated case by case -
 * absent means nothing received yet, never full payment assumed; where both
 * are stated, both are assigned. The only door through create-sale where paid
 * can differ from expected is the installment path, so that is the door every
 * imported sale now takes - with the model resolved to the sales app's own
 * `payment_models` row, whose fixed_price is the one source of the number.
 */

const TWIN_A = "a0000000-0000-4000-8000-00000000000a";
const TWIN_B = "a0000000-0000-4000-8000-00000000000b";

async function freeStoves(page: Page, org: string, n: number): Promise<string[]> {
  const r = await callEdgeFunction(page, "data-center-read", {
    action: "partner_stoves",
    organizationId: org,
    limit: 200,
  });
  const stoves =
    (r.body as { data?: { stoves?: { stove_id: string; sale_id: string | null }[] } })?.data
      ?.stoves ?? [];
  return stoves.filter((s) => !s.sale_id).slice(0, n).map((s) => s.stove_id);
}

const receipt = (serial: string, marker: string, phone: string, extra: Record<string, string> = {}) => ({
  stove_serial_no: serial,
  sales_model: "Hakimi Sales Model",
  first_name: "Paid",
  last_name: "Rule",
  aka: marker,
  phone,
  sales_date: "2026-01-07",
  state: "Kogi",
  ...extra,
});

async function saleOf(page: Page, serial: string) {
  const detail = await callEdgeFunction(page, "data-center-read", {
    action: "stove_detail",
    stoveId: serial,
  });
  return (detail.body as {
    data?: {
      sale?: {
        amount: number;
        total_paid: number;
        payment_status: string;
        is_installment: boolean;
      } | null;
    };
  })?.data?.sale ?? null;
}

async function rollback(page: Page, batchId: string) {
  for (let i = 0; i < 20; i++) {
    const rb = await callEdgeFunction(page, "data-center-import", { action: "rollback", batchId });
    if ((rb.body as { data?: { done?: boolean } })?.data?.done) break;
  }
}

test.describe("paid is what the sheet said, never what the coercion assumed", () => {
  test.describe.configure({ timeout: 240_000 });

  test("unstated, part-stated, and fully-stated paid each land as themselves", async ({
    page,
  }, testInfo) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/import");

    const stoves = await freeStoves(page, TWIN_A, 3);
    test.skip(stoves.length < 3, "not enough free stoves");
    const marker = `paid${testInfo.workerIndex}-${Date.now()}`;

    const staged = await callEdgeFunction(page, "data-center-import", {
      action: "stage",
      filename: `${marker}.csv`,
      rows: [
        // Nothing stated: expected from the model, nothing received yet.
        receipt(stoves[0], marker, "08016660001"),
        // Part paid, stated: both assigned exactly as written.
        receipt(stoves[1], marker, "08016660002", { amount_received: "20000" }),
        // Fully stated: both assigned, and the sales app calls it fully paid.
        receipt(stoves[2], marker, "08016660003", {
          amount: "56975",
          amount_received: "56975",
        }),
      ],
    });
    expect(staged.status).toBe(200);
    const batchId = (staged.body as { data: { batchId: string } }).data.batchId;

    const v = await callEdgeFunction(page, "data-center-import", { action: "validate", batchId });
    expect(v.status).toBe(200);
    await commitAndDrain(page, batchId);

    try {
      const unstated = await saleOf(page, stoves[0]);
      expect(unstated, "the sale exists").toBeTruthy();
      expect(Number(unstated!.amount), "expected = the model's own price").toBe(56975);
      expect(Number(unstated!.total_paid), "nothing stated means nothing received yet").toBe(0);
      expect(unstated!.payment_status).toBe("partially_paid");
      expect(unstated!.is_installment, "the one door where paid can differ").toBe(true);

      const partial = await saleOf(page, stoves[1]);
      expect(Number(partial!.amount)).toBe(56975);
      expect(Number(partial!.total_paid), "paid exactly as the sheet stated").toBe(20000);
      expect(partial!.payment_status).toBe("partially_paid");

      const full = await saleOf(page, stoves[2]);
      expect(Number(full!.amount)).toBe(56975);
      expect(Number(full!.total_paid)).toBe(56975);
      expect(full!.payment_status, "stating paid in full IS full payment").toBe("fully_paid");
    } finally {
      await rollback(page, batchId);
    }
  });

  test("a partner not assigned the model is told so at check time, by name", async ({
    page,
  }, testInfo) => {
    /*
     * Twin B is seeded with an explicit model list holding ONLY the Amina
     * model - the shape 29 of 51 partners on the first real file have. A
     * Hakimi row for Twin B must become an exception when the batch is
     * CHECKED, naming the partner, the model, and where the assignment lives -
     * not a bare 403 in the middle of a commit run.
     */
    await signIn(page, USERS.admin);
    await page.goto("/data-center/import");

    const stoves = await freeStoves(page, TWIN_B, 1);
    test.skip(stoves.length < 1, "no free Twin B stove");
    const marker = `scope${testInfo.workerIndex}-${Date.now()}`;

    const staged = await callEdgeFunction(page, "data-center-import", {
      action: "stage",
      filename: `${marker}.csv`,
      rows: [receipt(stoves[0], marker, "08016660004")],
    });
    const batchId = (staged.body as { data: { batchId: string } }).data.batchId;
    await callEdgeFunction(page, "data-center-import", { action: "validate", batchId });

    const rows = ((await callEdgeFunction(page, "data-center-import", {
      action: "rows",
      batchId,
    })).body as { data?: { status: string; exception_reason: string | null }[] })?.data ?? [];
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe("exception");
    const why = rows[0].exception_reason ?? "";
    expect(why).toContain("is not assigned");
    expect(why).toContain("Hakimi Sales Model");
    expect(why).toMatch(/Partner Sales Models/);
  });
});
