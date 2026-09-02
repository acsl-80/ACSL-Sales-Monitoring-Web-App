import { test, expect, type Page } from "@playwright/test";
import { branchSql, callEdgeFunction, commitAndDrain, signIn, USERS } from "./helpers";

/**
 * A receipt is digitised once, and the refusal that says so is founded on the
 * SALE rather than on the stock flag.
 *
 * The import has never had an update path: create-sale only inserts, and
 * deletes only to undo its own insert. So a stove that has already been
 * enriched is refused rather than re-enriched, which is the intended
 * behaviour. What was wrong is what the refusal rested on -
 * stove_ids_base.status = 'sold', and nothing else. It never looked at
 * public.sales.
 *
 * That INFERS "this receipt is already in" from a mutable flag instead of
 * observing the record, so when the two disagree the refusal silently stops
 * working, and what it produces is a second live sale for one stove. They can
 * disagree: the sales app resets stock unscoped in two places
 * (adminSalesService.jsx:730-733, deleteOptions.ts:39-42), and one serial
 * exists as stock at two different partners.
 *
 * The first test has to arrange that disagreement, because no screen creates
 * it on purpose, which is exactly why it went unnoticed. Against the old code
 * that test finds the row VALID and a commit writes a second sale. Against the
 * new code it is an exception naming the record.
 *
 * The second test is the other half and matters just as much. This change can
 * only ever ADD a refusal, so the failure mode to guard is over-refusal, and
 * the case that would break is a legitimate one: a sale cancelled on purpose
 * and the receipt re-imported. Cancelling archives the sale, and the check
 * looks at live sales only. That test must be green before and after.
 */

const PARTNER = "a0000000-0000-4000-8000-00000000000a";

/** Interpolated into SQL, so it is checked rather than trusted. */
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,64}$/;

function safe(value: string, what: string): string {
  expect(SAFE_ID.test(value), `${what} "${value}" is not a shape this spec will put in SQL`).toBe(
    true,
  );
  return value;
}

test.describe.configure({ timeout: 240_000 });

async function freeStoves(page: Page, n: number): Promise<string[]> {
  const r = await callEdgeFunction(page, "data-center-read", {
    action: "partner_stoves",
    organizationId: PARTNER,
    limit: 200,
  });
  const stoves =
    (r.body as { data?: { stoves?: { stove_id: string; sale_id: string | null }[] } })?.data
      ?.stoves ?? [];
  return stoves
    .filter((s) => !s.sale_id)
    .slice(0, n)
    .map((s) => s.stove_id);
}

function receiptRow(serial: string, marker: string, i: number) {
  return {
    stove_serial_no: serial,
    sales_model: "Amina Model",
    first_name: "Digitised",
    last_name: `Spec${i}`,
    phone: `0805444${String(1000 + i).slice(-4)}`,
    sales_date: "2026-01-06",
    state: "Kogi",
    lga: "Isanlu",
    address: `${marker} Road ${i}`,
  };
}

async function stageAndValidate(page: Page, marker: string, serials: string[]): Promise<string> {
  const staged = await callEdgeFunction(page, "data-center-import", {
    action: "stage",
    filename: `${marker}.csv`,
    rows: serials.map((s, i) => receiptRow(s, marker, i)),
    // Every batch in this file carries the same serial on purpose, so the
    // content hash correctly calls the later ones repeats. That guard has its
    // own spec; it is not what is under test here.
    confirmDuplicate: true,
  });
  expect(staged.status, "the receipt should stage").toBe(200);
  const batchId = (staged.body as { data: { batchId: string } }).data.batchId;

  const validated = await callEdgeFunction(page, "data-center-import", {
    action: "validate",
    batchId,
  });
  expect(validated.status, "the receipt should check").toBe(200);
  return batchId;
}

async function rowsOf(page: Page, batchId: string) {
  const r = await callEdgeFunction(page, "data-center-import", { action: "rows", batchId });
  return (r.body as { data?: Record<string, unknown>[] })?.data ?? [];
}

const liveSalesFor = (serial: string) =>
  branchSql<{ n: number }>(
    `select count(*)::int as n from public.sales
      where upper(btrim(stove_serial_no)) = upper(btrim('${serial}'))
        and is_archived is not true`,
  );

test.describe("a stove that already has a sale is not digitised twice", () => {
  test("refused even when the stock flag says the stove is free", async ({ page }, testInfo) => {
    await signIn(page, USERS.dataManager);

    const [serial] = await freeStoves(page, 1);
    expect(
      serial,
      "the preview has no free stove for this partner to build a fixture from",
    ).toBeTruthy();
    safe(serial, "stove id");

    const marker = `digitised${testInfo.workerIndex}-${Date.now()}`;
    let first: string | null = null;
    let second: string | null = null;
    try {
      // Give the stove a real sale, through the real path.
      first = await stageAndValidate(page, `${marker}-a`, [serial]);
      const done = await commitAndDrain(page, first);
      expect(done.state, "the fixture batch should commit").toBe("committed");

      const live = await liveSalesFor(serial);
      expect(live[0].n, "the fixture should have produced exactly one live sale").toBe(1);

      /*
       * Now the state the old refusal could not see: the sale stands, and
       * stock has been released underneath it. This is what an unscoped stove
       * reset does, and it is the only way the two get out of step.
       */
      await branchSql(
        `update public.stove_ids_base set status = 'available'
          where upper(stove_id) = upper('${serial}')`,
      );

      second = await stageAndValidate(page, `${marker}-b`, [serial]);
      const rows = await rowsOf(page, second);
      expect(rows.length, "the second batch should hold the one row").toBe(1);

      // The whole point. Old code: "valid", and a commit writes a second sale.
      expect(
        rows[0].status,
        "a stove with a live sale must not be checkable just because stock was released",
      ).toBe("exception");
      expect(
        String(rows[0].exception_reason ?? ""),
        "the reason should name the record that exists, not the stock flag",
      ).toMatch(/already has a sale recorded/i);
      expect(
        String(rows[0].exception_reason ?? ""),
        "the reason should say where to go about it",
      ).toMatch(/sales app/i);
    } finally {
      if (second) {
        await callEdgeFunction(page, "data-center-import", { action: "discard", batchId: second });
      }
      if (first) {
        await callEdgeFunction(page, "data-center-import", { action: "rollback", batchId: first });
      }
    }
  });

  test("a sale cancelled on purpose does not block the receipt", async ({ page }, testInfo) => {
    await signIn(page, USERS.dataManager);

    const [serial] = await freeStoves(page, 1);
    expect(
      serial,
      "the preview has no free stove for this partner to build a fixture from",
    ).toBeTruthy();
    safe(serial, "stove id");

    const marker = `cancelled${testInfo.workerIndex}-${Date.now()}`;
    let first: string | null = null;
    let second: string | null = null;
    try {
      first = await stageAndValidate(page, `${marker}-a`, [serial]);
      const done = await commitAndDrain(page, first);
      expect(done.state, "the fixture batch should commit").toBe("committed");

      /*
       * Cancel it the way the sales app does: the sale is archived, not
       * deleted, and the stove goes back to available. Re-importing the
       * receipt after that is a legitimate act, and refusing it would be this
       * change breaking something that already works.
       */
      await branchSql(
        `update public.sales set is_archived = true
          where upper(btrim(stove_serial_no)) = upper(btrim('${serial}'))`,
      );
      await branchSql(
        `update public.stove_ids_base set status = 'available', sale_id = null
          where upper(stove_id) = upper('${serial}')`,
      );

      second = await stageAndValidate(page, `${marker}-b`, [serial]);
      const rows = await rowsOf(page, second);
      expect(rows.length, "the second batch should hold the one row").toBe(1);
      expect(
        rows[0].status,
        `a cancelled sale must not block the receipt (reason given: ${rows[0].exception_reason})`,
      ).toBe("valid");
    } finally {
      for (const id of [second, first]) {
        if (id) {
          await callEdgeFunction(page, "data-center-import", { action: "discard", batchId: id });
        }
      }
      /*
       * The fixture sale was archived out from under its batch, so rollback
       * cannot find it by status. Remove it here and put the stove back, or
       * the next run finds one fewer free stove than it expects.
       */
      await branchSql(
        `delete from public.sales
          where upper(btrim(stove_serial_no)) = upper(btrim('${serial}'))`,
      );
      await branchSql(
        `update public.stove_ids_base set status = 'available', sale_id = null
          where upper(stove_id) = upper('${serial}')`,
      );
    }
  });

  test("a sale that lands between the check and the commit is refused at commit", async ({
    page,
  }, testInfo) => {
    await signIn(page, USERS.dataManager);

    const [serial] = await freeStoves(page, 1);
    expect(
      serial,
      "the preview has no free stove for this partner to build a fixture from",
    ).toBeTruthy();
    safe(serial, "stove id");

    const marker = `race${testInfo.workerIndex}-${Date.now()}`;
    let a: string | null = null;
    let b: string | null = null;
    try {
      /*
       * Both batches are checked while the stove is still free, so both hold a
       * valid row. Committing the first is what makes the second stale, which
       * is the real shape of "somebody keyed this sale in the app while the
       * sheet was being worked" - and it needs no SQL to arrange.
       */
      a = await stageAndValidate(page, `${marker}-a`, [serial]);
      b = await stageAndValidate(page, `${marker}-b`, [serial]);

      const beforeB = await rowsOf(page, b);
      expect(
        beforeB[0].status,
        "the second batch should check out valid, before the first one lands",
      ).toBe("valid");

      const doneA = await commitAndDrain(page, a);
      expect(doneA.state, "the first batch should commit").toBe("committed");

      await commitAndDrain(page, b);
      const afterB = await rowsOf(page, b);
      expect(
        afterB[0].status,
        "the second batch's row must not become a second sale for one stove",
      ).toBe("exception");
      expect(
        String(afterB[0].exception_reason ?? ""),
        "the reason should say the sale appeared after the batch was checked",
      ).toMatch(/after this batch was checked/i);

      const live = await liveSalesFor(serial);
      expect(live[0].n, "one stove, one live sale").toBe(1);
    } finally {
      if (b) await callEdgeFunction(page, "data-center-import", { action: "discard", batchId: b });
      if (a) await callEdgeFunction(page, "data-center-import", { action: "rollback", batchId: a });
    }
  });
});
