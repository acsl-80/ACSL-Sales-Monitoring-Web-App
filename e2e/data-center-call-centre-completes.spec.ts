import { test, expect, type Page } from "@playwright/test";
import { branchSql, callEdgeFunction, signIn, USERS } from "./helpers";

/**
 * Slice 4 of the 2026-09-02 review: a call centre save completes.
 *
 * "When a call is saved and the agent comes back to complete it, it stays
 * pending." Three causes, two of them here.
 *
 * The first: the editor seeds its form from the stored answers, so an answer
 * given while the record was partially verified (why_not_verified) came back
 * on every later save. Choosing "Fully verified" then made the server refuse
 * the whole save, "why_not_verified does not apply to this record", and the
 * record could never complete. Twenty-one live records were in that state.
 *
 * The second: the send-back reason was typed into the form's values, autosaved
 * into the draft, replayed on the next open, and refused by the record save
 * as an unknown field for ever after. Two live drafts.
 *
 * And two smaller things from the same review: an attempt could be logged
 * with no outcome, and the guard against arbitrary columns must survive the
 * fix. Each test names what it is red for against the old code.
 */

type Seeded = { sale_id: string; end_user_name: string; verification_outcome: string; answers: unknown };
const SAFE_ID = /^[0-9a-f-]{36}$/;

test.describe.configure({ timeout: 240_000 });

/** Two live sales with call records, creating the records where the seed has none. */
async function twoRecords(): Promise<Seeded[]> {
  await branchSql(
    `insert into data_center.call_records (sale_id, created_by)
     select s.id, (select id from public.profiles where email = '${USERS.admin}' limit 1)
       from public.sales s
      where s.is_archived is not true and s.end_user_name is not null
        and not exists (select 1 from data_center.call_records cr where cr.sale_id = s.id)
      order by s.created_at desc limit 2
     on conflict (sale_id) do nothing`,
  );
  return branchSql<Seeded>(
    `select cr.sale_id::text, s.end_user_name, cr.verification_outcome, cr.answers
       from data_center.call_records cr
       join public.sales s on s.id = cr.sale_id
      where s.is_archived is not true and s.end_user_name is not null
      order by s.created_at desc limit 2`,
  );
}

async function restore(r: Seeded) {
  await branchSql(
    `update data_center.call_records
        set verification_outcome = '${r.verification_outcome}',
            answers = '${JSON.stringify(r.answers ?? {}).replace(/'/g, "''")}'::jsonb
      where sale_id = '${r.sale_id}'`,
  );
  await branchSql(`delete from data_center.call_drafts where sale_id = '${r.sale_id}'`);
}

async function openRecord(page: Page, name: string, outcome?: string) {
  const search = outcome ? `?verificationOutcome=${outcome}` : "";
  await page.goto(`/data-center/call-centre${search}`);
  await expect(page.getByRole("heading", { name: "Call Centre" })).toBeVisible({ timeout: 20_000 });
  const first = name.trim().split(/\s+/)[0];
  await page
    .getByRole("button", { name: new RegExp(`^Open call record for .*${first}`, "i") })
    .first()
    .click();
  await expect(page.getByRole("heading", { name: "Verification outcome" })).toBeVisible({
    timeout: 15_000,
  });
}

test.describe("slice 4: a call centre save completes", () => {
  test("a record that answered 'why not verified' can still be moved to Fully verified", async ({
    page,
  }) => {
    const [r] = await twoRecords();
    expect(r, "the preview has no live sale to hold a call record").toBeTruthy();
    expect(SAFE_ID.test(r.sale_id)).toBe(true);
    try {
      // The production shape: partially verified, with the conditional question answered.
      await branchSql(
        `update data_center.call_records
            set verification_outcome = 'partially_verified',
                answers = coalesce(answers, '{}'::jsonb) || '{"why_not_verified": "phone off"}'::jsonb
          where sale_id = '${r.sale_id}'`,
      );
      await signIn(page, USERS.admin);
      await openRecord(page, r.end_user_name, "partially_verified");
      await page.getByRole("button", { name: "Fully verified" }).click();
      await page.getByRole("button", { name: "Save", exact: true }).click();

      // The whole point. Old code: "why_not_verified does not apply to this record".
      await expect(page.getByText(/does not apply to this record/)).toHaveCount(0);
      await expect(page.getByText("Saved.", { exact: true })).toBeVisible({ timeout: 15_000 });
      const [after] = await branchSql<{ verification_outcome: string }>(
        `select verification_outcome from data_center.call_records where sale_id = '${r.sale_id}'`,
      );
      expect(after.verification_outcome, "the record should now be fully verified").toBe("fully_verified");
    } finally {
      await restore(r);
    }
  });

  test("a draft that carried the send-back reason no longer poisons the save", async ({ page }) => {
    const rows = await twoRecords();
    const r = rows[1] ?? rows[0];
    expect(r).toBeTruthy();
    try {
      await branchSql(
        `update data_center.call_records set verification_outcome = 'not_verified' where sale_id = '${r.sale_id}'`,
      );
      // The production shape: a draft holding a key the record cannot take.
      await branchSql(
        `insert into data_center.call_drafts (sale_id, values, base_version, saved_at, saved_by)
         values ('${r.sale_id}', '{"ward": "Old ward", "correction_reason_id": "00000000-0000-4000-8000-000000000099"}'::jsonb,
                 null, now(), (select id from public.profiles where email = '${USERS.admin}' limit 1))
         on conflict (sale_id) do update set values = excluded.values, saved_at = now()`,
      );
      await signIn(page, USERS.admin);
      await openRecord(page, r.end_user_name);
      await page.locator("#dc-field-ward").fill("New ward");
      await page.getByRole("button", { name: "Save", exact: true }).click();

      // Old code: "Unknown field: correction_reason_id".
      await expect(page.getByText(/Unknown field/)).toHaveCount(0);
      await expect(page.getByText("Saved.", { exact: true })).toBeVisible({ timeout: 15_000 });
    } finally {
      await restore(r);
    }
  });

  test("an unknown key is still refused: the guard against arbitrary columns stands", async ({
    page,
  }) => {
    const [r] = await twoRecords();
    await signIn(page, USERS.admin);
    const res = await callEdgeFunction(page, "data-center-write", {
      action: "save_call_record",
      saleId: r.sale_id,
      values: { definitely_not_a_field: 1 },
      version: null,
    });
    expect(res.status, "a key the registry does not know must still be a 400").toBe(400);
  });

  test("a call cannot be logged without an outcome", async ({ page }) => {
    const [r] = await twoRecords();
    await signIn(page, USERS.admin);
    await openRecord(page, r.end_user_name, r.verification_outcome);
    // Old code: enabled, and an attempt with no outcome could be written.
    await expect(page.getByRole("button", { name: "Log call" })).toBeDisabled();
  });
});
