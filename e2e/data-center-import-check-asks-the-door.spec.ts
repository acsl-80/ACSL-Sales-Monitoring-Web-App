import { test, expect, type Page } from "@playwright/test";
import { branchSql, callEdgeFunction, commitAndDrain, signIn, USERS } from "./helpers";

/**
 * The check refuses what the commit would refuse, and a commit that writes
 * nothing does not read as committed.
 *
 * Both halves of the 2026-09-02 report. The rule that a part payment needs a
 * sales model lived only in the commit, so a file of such rows checked as
 * "ready", and when the commit then refused every one, the batch was stamped
 * committed with a zero beside it. The rule is now one function asked at the
 * bench, at check and at commit, and "committed" is only written when a row
 * was.
 *
 * Test 1 stages one part-paid row with no model and checks it: old code marks
 * it valid, new code marks it an exception naming the missing model.
 *
 * Test 2 reproduces the production shape exactly - a VALID row that the commit
 * will refuse - by staging a fully paid row (which is legitimately valid), then
 * turning it into a part payment in SQL behind the check's back, and pressing
 * commit. Old code: batch `committed`, committed_rows 0. New code: the row is
 * an exception and the batch stays open.
 */

const PARTNER = "a0000000-0000-4000-8000-00000000000a";
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,64}$/;

test.describe.configure({ timeout: 240_000 });

async function freeStove(page: Page, skip: string[] = []): Promise<string | null> {
  const r = await callEdgeFunction(page, "data-center-read", {
    action: "partner_stoves",
    organizationId: PARTNER,
    limit: 200,
  });
  const stoves =
    (r.body as { data?: { stoves?: { stove_id: string; sale_id: string | null }[] } })?.data
      ?.stoves ?? [];
  return stoves.find((s) => !s.sale_id && !skip.includes(s.stove_id))?.stove_id ?? null;
}

function receipt(serial: string, filename: string, amountReceived: string) {
  return {
    stove_serial_no: serial,
    first_name: "Door",
    last_name: "Check",
    phone: "08054449002",
    sales_date: "2026-01-07",
    state: "Kogi",
    lga: "Isanlu",
    address: `${filename} Road`,
    amount: "1000",
    amount_received: amountReceived,
    // Deliberately no sales_model column.
  };
}

async function stage(page: Page, filename: string, row: Record<string, string>) {
  const staged = await callEdgeFunction(page, "data-center-import", {
    action: "stage",
    filename,
    rows: [row],
    confirmDuplicate: true,
  });
  expect(staged.status, "the receipt should stage").toBe(200);
  return (staged.body as { data: { batchId: string } }).data.batchId;
}

async function rowOf(batchId: string) {
  const [r] = await branchSql<{ status: string; reason: string | null }>(
    `select status, exception_reason as reason from data_center.import_rows
      where batch_id = '${batchId}' limit 1`,
  );
  return r;
}

async function dropBatch(batchId: string | null) {
  if (!batchId) return;
  await branchSql(`delete from data_center.import_batches where id = '${batchId}'`);
}

test.describe("the door rule, at check and at commit", () => {
  test("a part payment with no sales model is refused at the check, by name", async ({
    page,
  }, testInfo) => {
    await signIn(page, USERS.admin);
    const serial = await freeStove(page);
    expect(serial, "the preview has no free stove for this partner").toBeTruthy();
    expect(SAFE_ID.test(serial as string)).toBe(true);
    const filename = `door-check${testInfo.workerIndex}-${Date.now()}.csv`;
    let batchId: string | null = null;
    try {
      batchId = await stage(page, filename, receipt(serial as string, filename, "500"));
      const validated = await callEdgeFunction(page, "data-center-import", {
        action: "validate",
        batchId,
      });
      expect(validated.status, "the check should answer").toBe(200);

      const row = await rowOf(batchId);
      expect(row.status, "a row the commit is certain to refuse must not check as valid").toBe(
        "exception",
      );
      expect(row.reason ?? "").toMatch(/names no sales model but states a part payment/);
    } finally {
      await dropBatch(batchId);
    }
  });

  test("a commit that writes nothing leaves the batch open instead of stamping it committed", async ({
    page,
  }, testInfo) => {
    await signIn(page, USERS.admin);
    const serial = await freeStove(page);
    expect(serial, "the preview has no free stove for this partner").toBeTruthy();
    expect(SAFE_ID.test(serial as string)).toBe(true);
    const filename = `door-commit${testInfo.workerIndex}-${Date.now()}.csv`;
    let batchId: string | null = null;
    try {
      // Paid in full, so it checks as valid on old and new code alike.
      batchId = await stage(page, filename, receipt(serial as string, filename, "1000"));
      const validated = await callEdgeFunction(page, "data-center-import", {
        action: "validate",
        batchId,
      });
      expect(validated.status).toBe(200);
      expect((await rowOf(batchId)).status, "the fully paid row should be valid").toBe("valid");

      // Behind the check's back, make it the production shape: valid, part
      // paid, no model. This is what twenty-five bench rows looked like.
      await branchSql(
        `update data_center.import_rows
            set normalized = normalized || '{"amountReceived": 500}'::jsonb
          where batch_id = '${batchId}'`,
      );

      const done = await commitAndDrain(page, batchId);
      const [batch] = await branchSql<{ state: string; committed: number; last_error: string | null }>(
        `select state,
                (select count(*)::int from data_center.import_rows
                  where batch_id = b.id and status = 'committed') as committed,
                last_error
           from data_center.import_batches b where id = '${batchId}'`,
      );
      expect(batch.committed, "nothing should have been written").toBe(0);
      expect(
        batch.state,
        `a batch that wrote nothing must not read as committed (drain answered ${JSON.stringify(done)})`,
      ).not.toBe("committed");
      expect((await rowOf(batchId)).status, "the refused row should be an exception").toBe(
        "exception",
      );

      // And the history says what it needs rather than showing a zero.
      await page.goto("/data-center/import");
      await expect(page.getByRole("heading", { name: "Bulk Import" })).toBeVisible({
        timeout: 30_000,
      });
      const row = page
        .getByRole("cell", { name: filename, exact: true })
        .first()
        .locator("xpath=ancestor::tr[1]");
      await expect(row).toBeVisible({ timeout: 30_000 });
      await expect(row.getByText("committed", { exact: true })).toHaveCount(0);
      const step = row.locator("xpath=following-sibling::tr[1]");
      await expect(step.getByText(/needs a person first/)).toBeVisible();
    } finally {
      await dropBatch(batchId);
    }
  });
});
