import { test, expect, type Page } from "@playwright/test";
import { signIn, USERS, branchSql, callEdgeFunction } from "./helpers";

/**
 * Phase 30, slice 2 (D57): a refused finish leaves a record.
 *
 * Found chasing a typist's report: stove 101114218 was typed, Finish was
 * pressed, and it stayed a draft. The receipt carried everything it needed and
 * an identical one for the same partner finished two minutes earlier, but
 * nothing could say what happened, because a refused finish answered 400 and
 * wrote nothing at all. The row kept whatever the twenty-second autosave last
 * left, which is indistinguishable from a receipt nobody ever finished.
 *
 *  - a refused finish now keeps the typing, stays a draft, and records what
 *    refused it, so the row can be asked tomorrow
 *  - opening the stove again says it, rather than only the second it happened
 *  - the autosave that follows a refusal does not erase the record
 *  - a finish that is accepted clears it
 */
test.describe.configure({ timeout: 240_000 });

const MARKER = "SAYSWHY";

/** A receipt that holds together, and the same one with its state left out. */
const whole = () => ({
  endUserName: "Says",
  endUserSurname: "Why",
  phone: "08015550661",
  salesDate: "2026-01-05",
  state: "Kogi",
  lga: "Isanlu",
  address: `${MARKER} Street`,
  salesModel: "Amina Model",
});
const missingState = () => {
  const r = whole();
  delete (r as Partial<ReturnType<typeof whole>>).state;
  return r;
};

type Row = {
  status: string;
  address: string | null;
  reason: string | null;
  at: string | null;
  by: string | null;
  has_refusal: boolean;
};

async function benchRow(stoveId: string): Promise<Row> {
  const [row] = await branchSql<Row>(
    `select r.status,
            r.draft_values ->> 'address' as address,
            r.finish_refusal ->> 'reason' as reason,
            r.finish_refusal ->> 'at' as at,
            r.finish_refusal ->> 'by' as by,
            (r.finish_refusal is not null) as has_refusal
       from data_center.import_rows r
       join data_center.import_batches b on b.id = r.batch_id
      where b.source = 'workbench' and r.stove_serial_no = '${stoveId}'
      limit 1`,
  );
  return row;
}

async function untypedStove(): Promise<string> {
  const rows = await branchSql<{ stove_id: string }>(
    `select sb.stove_id
       from public.stove_ids_base sb
       join data_center.v_stove_typed t on t.stove_id = sb.stove_id
       join data_center.v_transfer_stoves b on b.stove_id = sb.stove_id
      where t.typed_state = 'untyped' and sb.organization_id is not null
      order by sb.stove_id limit 1`,
  );
  expect(rows[0], "an untyped stove to type on").toBeTruthy();
  return rows[0].stove_id;
}

/** Undo the receipt this spec made, so the stove reads untyped again. */
async function forget(stoveId: string) {
  await branchSql(`delete from data_center.import_rows r using data_center.import_batches b
    where b.id = r.batch_id and b.source = 'workbench' and r.stove_serial_no = '${stoveId}' and r.sale_id is null`);
  await branchSql(`update data_center.import_batches b set state = 'staged'
    where b.source = 'workbench' and b.state = 'validated'
      and not exists (select 1 from data_center.import_rows r where r.batch_id = b.id and r.status = 'valid')`);
}

async function save(page: Page, stoveId: string, values: unknown, complete: boolean) {
  return callEdgeFunction(page, "data-center-import", {
    action: "workbench_save", stoveId, values, complete,
  });
}

test("a refused finish keeps the typing, stays a draft, and records what refused it", async ({ page }) => {
  await signIn(page, USERS.admin);
  const stove = await untypedStove();
  try {
    const refused = await save(page, stove, missingState(), true);
    expect(refused.status, JSON.stringify(refused.body)).toBe(400);
    expect((refused.body as { code: string }).code).toBe("incomplete");
    const said = (refused.body as { error: string }).error;

    // The work survives the refusal it just earned.
    const row = await benchRow(stove);
    expect(row, "the row was written rather than thrown away").toBeTruthy();
    expect(row.status, "a refused finish is still a draft").toBe("draft");
    expect(row.address, "the typing was kept").toBe(`${MARKER} Street`);

    // And the row can be asked why, tomorrow.
    expect(row.has_refusal, "the refusal was recorded").toBe(true);
    expect(row.reason, "the row says what the typist was told").toBe(said);
    expect(row.at, "it is dated").toBeTruthy();
    expect(row.by, "and attributed").toBeTruthy();

    // Opening the stove again says it, rather than only the second it happened.
    const open = await callEdgeFunction(page, "data-center-import", {
      action: "workbench_open", stoveId: stove,
    });
    expect(open.status, JSON.stringify(open.body)).toBe(200);
    const work = (open.body as { data: { work: { finish_refusal: { reason: string } | null } | null } }).data.work;
    expect(work?.finish_refusal?.reason, "the bench reads it back on open").toBe(said);
  } finally {
    await forget(stove);
  }
});

test("a refused change to an already finished receipt leaves it finished, and still says why", async ({ page }) => {
  await signIn(page, USERS.admin);
  const stove = await untypedStove();
  try {
    // Finished and waiting to be confirmed, which is a row the same typist may
    // still reopen and edit.
    const done = await save(page, stove, whole(), true);
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect((await benchRow(stove)).status).toBe("valid");

    /*
     * A later change the rules refuse. The receipt was accepted once and its
     * accepted shape is what the confirmation queue will commit, so it stays
     * finished: a fat-fingered edit must not pull somebody's finished work
     * back out of the queue. What it must not do is stay quiet about it.
     */
    const refused = await save(page, stove, missingState(), true);
    expect(refused.status, JSON.stringify(refused.body)).toBe(400);

    const row = await benchRow(stove);
    expect(row.status, "the accepted finish still stands").toBe("valid");
    expect(row.has_refusal, "and the refused change is on the record").toBe(true);

    const open = await callEdgeFunction(page, "data-center-import", {
      action: "workbench_open", stoveId: stove,
    });
    const work = (open.body as { data: { work: { status: string; finish_refusal: { reason: string } | null } | null } }).data.work;
    expect(work?.status).toBe("valid");
    expect(work?.finish_refusal?.reason, "so the bench can say it rather than read as finished and silent").toBeTruthy();
  } finally {
    await forget(stove);
  }
});

test("the autosave after a refusal does not erase it, and a finish that is accepted clears it", async ({ page }) => {
  await signIn(page, USERS.admin);
  const stove = await untypedStove();
  try {
    const refused = await save(page, stove, missingState(), true);
    expect(refused.status, JSON.stringify(refused.body)).toBe(400);
    expect((await benchRow(stove)).has_refusal).toBe(true);

    /*
     * The bench saves a draft every twenty seconds and again on the way out.
     * A draft save that cleared the record would erase it before anybody read
     * it, so a draft leaves it exactly where it is.
     */
    const draft = await save(page, stove, missingState(), false);
    expect(draft.status, JSON.stringify(draft.body)).toBe(200);
    const afterDraft = await benchRow(stove);
    expect(afterDraft.has_refusal, "a draft save leaves the record alone").toBe(true);
    expect(afterDraft.status).toBe("draft");

    // Fixed and finished: the row is finished and carries no refusal.
    const done = await save(page, stove, whole(), true);
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    const afterFinish = await benchRow(stove);
    expect(afterFinish.status, "the finish was accepted").toBe("valid");
    expect(afterFinish.has_refusal, "an accepted finish clears the record").toBe(false);
  } finally {
    await forget(stove);
  }
});
