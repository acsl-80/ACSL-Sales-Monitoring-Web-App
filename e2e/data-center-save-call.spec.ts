import { test, expect, type Page } from "@playwright/test";
import { signIn, USERS, branchSql, callEdgeFunction } from "./helpers";

/**
 * Save call: one save path on the call form (Phase 28, S2; D42 to D44).
 *
 * A save that carries an outcome writes the call, the record and the verdict
 * the outcome implies in one transaction; an explicit pill beats the map;
 * the same client key twice writes one call; the rules the server keeps
 * refuse what they should. On the form, a save with changes and no outcome
 * asks for one, and "No call was made, just save" writes the record alone.
 *
 * Red on main: save_call_record ignores `attempt`, the outcome map does not
 * exist, and the form has no Save call button.
 */

test.describe.configure({ timeout: 180_000 });

type Outcome = { id: string; value: string };
async function outcomes(): Promise<Record<string, string>> {
  const rows = await branchSql<Outcome>(`select id::text, value from data_center.option_values where list_key = 'call_outcome' and is_active`);
  return Object.fromEntries(rows.map((r) => [r.value, r.id]));
}
async function fresh(page: Page): Promise<{ sale_id: string; version: number | null }> {
  const [row] = await branchSql<{ sale_id: string; version: number | null }>(
    `select c.sale_id::text, c.call_record_version as version from data_center.v_call_center c
      where c.is_archived is not true and coalesce(c.attempt_count, 0) = 0 and c.correction_state = 'none'
      order by c.sales_date desc limit 1`,
  );
  expect(row, "a record with no calls to work on").toBeTruthy();
  return row;
}
async function state(saleId: string) {
  const [r] = await branchSql<{ verification_outcome: string | null; attempt_count: number; version: number; outcome: string | null; keys: number }>(
    `select cr.verification_outcome, cr.attempt_count, cr.version, o.value as outcome,
            (select count(*)::int from data_center.call_attempts a where a.sale_id = cr.sale_id) as keys
       from data_center.call_records cr left join data_center.option_values o on o.id = cr.call_outcome_id
      where cr.sale_id = '${saleId}'`,
  );
  return r ?? { verification_outcome: null, attempt_count: 0, version: 0, outcome: null, keys: 0 };
}
const uuid = () => crypto.randomUUID();

test("a save with an outcome writes the call and the verdict together, once per client key", async ({ page }) => {
  await signIn(page, USERS.admin);
  const o = await outcomes();
  const { sale_id, version } = await fresh(page);
  try {
    const key = uuid();
    const first = await callEdgeFunction(page, "data-center-write", {
      action: "save_call_record", saleId: sale_id, version, values: { other_comments: "e2e save call" },
      attempt: { outcomeId: o.verified, clientKey: key },
    });
    expect(first.status, JSON.stringify(first.body).slice(0, 300)).toBe(200);
    const body = (first.body as { data: { attemptNo: number; verificationOutcome: string; version: number } }).data;
    expect(body.attemptNo).toBe(1);
    expect(body.verificationOutcome).toBe("fully_verified");
    let s = await state(sale_id);
    expect([s.verification_outcome, s.attempt_count, s.outcome]).toEqual(["fully_verified", 1, "verified"]);

    // The same save again: nothing twice.
    const again = await callEdgeFunction(page, "data-center-write", {
      action: "save_call_record", saleId: sale_id, version: body.version, values: {},
      attempt: { outcomeId: o.verified, clientKey: key },
    });
    expect(again.status).toBe(200);
    s = await state(sale_id);
    expect(s.attempt_count).toBe(1);

    // An explicit pill beats the map: partly verified outcome, verdict unreachable by hand.
    const explicit = await callEdgeFunction(page, "data-center-write", {
      action: "save_call_record", saleId: sale_id, values: { verification_outcome: "unreachable" },
      attempt: { outcomeId: o.partially_verified, clientKey: uuid() },
    });
    expect(explicit.status).toBe(200);
    s = await state(sale_id);
    expect([s.verification_outcome, s.attempt_count, s.outcome]).toEqual(["unreachable", 2, "partially_verified"]);

    // A record-only save writes no call and moves the version by exactly one.
    const before = s.version;
    const only = await callEdgeFunction(page, "data-center-write", {
      action: "save_call_record", saleId: sale_id, version: before, values: { ward: "e2e ward" },
    });
    expect(only.status).toBe(200);
    s = await state(sale_id);
    expect([s.attempt_count, s.version]).toEqual([2, before + 1]);

    // What the server refuses.
    const noNote = await callEdgeFunction(page, "data-center-write", {
      action: "save_call_record", saleId: sale_id, values: {}, attempt: { outcomeId: o.other, clientKey: uuid() },
    });
    expect(noNote.status).toBe(400);
    const badTime = await callEdgeFunction(page, "data-center-write", {
      action: "save_call_record", saleId: sale_id, values: {}, attempt: { outcomeId: o.verified, callbackAt: new Date().toISOString(), clientKey: uuid() },
    });
    expect(badTime.status).toBe(400);
    const noOutcome = await callEdgeFunction(page, "data-center-write", {
      action: "save_call_record", saleId: sale_id, values: {}, attempt: { clientKey: uuid() },
    });
    expect(noOutcome.status).toBe(400);
  } finally {
    await branchSql(`delete from data_center.call_attempts where sale_id = '${sale_id}'`);
    await branchSql(`update data_center.call_records set verification_outcome = 'not_verified', call_outcome_id = null, ward = null, other_comments = null where sale_id = '${sale_id}'`);
  }
});

test("on the form: Save call top and bottom, the prompt with its way through, the verdict following the outcome", async ({ page }) => {
  await signIn(page, USERS.admin);
  const { sale_id } = await fresh(page);
  const [row] = await branchSql<{ end_user_name: string }>(`select end_user_name from data_center.v_call_center where sale_id = '${sale_id}'`);
  try {
    await page.goto("/data-center/call-centre/records");
    await expect(page.getByRole("heading", { name: "Call Centre" })).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: new RegExp(`^Open call record for ${row.end_user_name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    await expect(dialog.locator('[data-save-call="header"]')).toBeVisible({ timeout: 30_000 });
    await expect(dialog.locator('[data-save-call="footer"]')).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Log call" })).toHaveCount(0);

    // A change and no outcome: the band asks; nothing is written yet.
    const ward = dialog.getByText("Ward", { exact: true }).last().locator("xpath=following::input[1]");
    await ward.fill("e2e prompt");
    await dialog.locator('[data-save-call="footer"]').click();
    const band = dialog.locator("[data-outcome-prompt]");
    await expect(band).toBeVisible({ timeout: 15_000 });
    expect((await state(sale_id)).attempt_count).toBe(0);

    // The way through: the record alone.
    await band.getByRole("button", { name: "No call was made, just save" }).click();
    await expect(dialog.getByText("Saved.", { exact: true })).toBeVisible({ timeout: 15_000 });
    let s = await state(sale_id);
    expect(s.attempt_count).toBe(0);

    // Pick Verified: the verdict pill follows; Save call from the header writes the call.
    await dialog.getByRole("combobox", { name: "Outcome of this call" }).click();
    await page.getByRole("option", { name: "Verified", exact: true }).click();
    await expect(dialog.locator("[data-verdict-source]")).toContainText("Set by the outcome");
    await expect(dialog.getByRole("button", { name: "Verified", exact: true }).first()).toHaveAttribute("aria-pressed", "true");
    // The draft keeps the picked outcome while nothing is saved yet.
    await expect(dialog.locator("[data-draft-saved]")).toBeVisible({ timeout: 15_000 });
    await dialog.locator('[data-save-call="header"]').click();
    await expect(dialog.getByText("Call saved.", { exact: true })).toBeVisible({ timeout: 15_000 });
    s = await state(sale_id);
    expect([s.verification_outcome, s.attempt_count, s.outcome]).toEqual(["fully_verified", 1, "verified"]);
    await expect(dialog.locator("[data-draft-saved]")).toHaveCount(0);
    const [drafts] = await branchSql<{ n: number }>(`select count(*)::int as n from data_center.call_drafts where sale_id = '${sale_id}'`);
    expect(Number(drafts.n)).toBe(0);
  } finally {
    await branchSql(`delete from data_center.call_attempts where sale_id = '${sale_id}'`);
    await branchSql(`delete from data_center.call_drafts where sale_id = '${sale_id}'`);
    await branchSql(`update data_center.call_records set verification_outcome = 'not_verified', call_outcome_id = null, ward = null where sale_id = '${sale_id}'`);
  }
});
