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

/**
 * Undo a fixture batch, and say so out loud when it does not work.
 *
 * The first version of this file fired rollback and ignored the answer, which
 * left committed batches and their sales standing on the preview across four
 * runs, invisibly. Two separate causes hid behind that one silence: discard
 * refuses a batch that wrote sales, and rollback answers 200 even when it
 * deleted nothing. A cleanup that fails in silence is the same failure
 * this module's own rules single out everywhere else, and it is worse in a
 * spec, because the residue then shifts what the NEXT run sees.
 *
 * Rollback is refused while a commit lease is live, so it is retried rather
 * than attempted once. Anything else is reported with the server's own reason.
 *
 * Which undo to ask for is not interchangeable, and the silent version hid
 * that too: `discard` refuses any batch that has written sales ("Roll it back
 * first - that removes each sale properly and releases its stove"), so a
 * committed batch takes `rollback` and a staged one takes `discard`.
 */
async function undo(page: Page, batchId: string, kind: "rollback" | "discard") {
  for (let i = 0; i < 6; i++) {
    const r = await callEdgeFunction(page, "data-center-import", { action: kind, batchId });
    if (r.status === 200) {
      if (kind === "discard") return;
      /*
       * A 200 from rollback is not proof the sales went. It answers 200 having
       * failed to delete a single one, recording that only in last_error - and
       * the account these tests first used could not delete sales at all
       * ("Admin privileges required"), so six batches survived two green runs.
       * Ask the batch what happened rather than believing the status code.
       */
      const [b] = await branchSql<{ state: string; last_error: string | null }>(
        `select state, last_error from data_center.import_batches where id = '${batchId}'`,
      );
      if (b?.state === "rolled_back" && !b?.last_error) return;
      throw new Error(
        `cleanup: rollback on ${batchId} answered 200 but the batch is ` +
          `'${b?.state}' with last_error: ${b?.last_error ?? "(none)"}`,
      );
    }
    const code = (r.body as { code?: string })?.code;
    if (code === "commit_in_progress") {
      await page.waitForTimeout(3000);
      continue;
    }
    throw new Error(
      `cleanup: ${kind} on ${batchId} answered ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`,
    );
  }
  throw new Error(`cleanup: ${kind} on ${batchId} never stopped saying a commit was running`);
}

const liveSalesFor = (serial: string) =>
  branchSql<{ n: number }>(
    `select count(*)::int as n from public.sales
      where upper(btrim(stove_serial_no)) = upper(btrim('${serial}'))
        and is_archived is not true`,
  );

test.describe("a stove that already has a sale is not digitised twice", () => {
  test("refused even when the stock flag says the stove is free", async ({ page }, testInfo) => {
    await signIn(page, USERS.admin);

    const [serial] = await freeStoves(page, 1);
    expect(
      serial,
      "the preview has no free stove for this partner to build a fixture from",
    ).toBeTruthy();
    safe(serial, "stove id");

    const marker = `digitised${testInfo.workerIndex}-${Date.now()}`;
    let first: string | null = null;
    let second: string | null = null;
    let releasedStock = false;
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
      releasedStock = true;

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
      /*
       * Stock first, then the rollback. Leaving the release in place is not
       * cosmetic: a live sale sitting on free stock IS the drift this whole
       * change exists to catch, so a spec that walks away from it seeds the
       * very fault it asserts against, for every run after this one.
       *
       * Both columns move together because the check constraint on
       * stove_ids_base permits 'sold' only while sale_id is set.
       */
      if (releasedStock) {
        await branchSql(
          `update public.stove_ids_base b
              set status = 'sold', sale_id = s.id
             from public.sales s
            where upper(b.stove_id) = upper('${serial}')
              and upper(btrim(s.stove_serial_no)) = upper(btrim('${serial}'))
              and s.is_archived is not true`,
        );
      }
      if (second) await undo(page, second, "discard");
      if (first) await undo(page, first, "rollback");
    }
  });

  test("a sale cancelled on purpose does not block the receipt", async ({ page }, testInfo) => {
    await signIn(page, USERS.admin);

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
      // `second` never committed, so discard is its undo.
      if (second) await undo(page, second, "discard");

      /*
       * `first` DID commit, and discard refuses a batch that wrote sales:
       * "Roll it back first - that removes each sale properly and releases
       * its stove." Rollback is the right undo, and it needs the sale the way
       * the commit left it, because this test then archived it and released
       * the stove to imitate a cancellation.
       */
      if (first) {
        await branchSql(
          `update public.sales set is_archived = false
            where upper(btrim(stove_serial_no)) = upper(btrim('${serial}'))`,
        );
        await branchSql(
          `update public.stove_ids_base b
              set status = 'sold', sale_id = s.id
             from public.sales s
            where upper(b.stove_id) = upper('${serial}')
              and upper(btrim(s.stove_serial_no)) = upper(btrim('${serial}'))
              and s.is_archived is not true`,
        );
        await undo(page, first, "rollback");
      }
    }
  });

  test("a sale that lands between the check and the commit is refused at commit", async ({
    page,
  }, testInfo) => {
    await signIn(page, USERS.admin);

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
      if (b) await undo(page, b, "discard");
      if (a) await undo(page, a, "rollback");
    }
  });
});
