import { test, expect, type Page } from "@playwright/test";
import { branchSql, signIn, USERS } from "./helpers";

/**
 * Slice 7b of the 2026-09-02 review: the levers ask, the failures speak, the
 * sales rep can close a send-back.
 *
 * Levers (F19). Clear draft, Move record onto stove, Assign now, Reclaim and
 * Move went straight through on one click. Each now asks first, in the shape
 * Unassign already used, and No does nothing. Against the old code there is
 * no question: the click is the act.
 *
 * Finish later. A draft that could not be written was swallowed and the
 * editor closed, so the typing was gone and nobody was told. It now says so
 * and stays open, with a way to close anyway.
 *
 * The 409. Somebody else saving first was shown in the same amber as every
 * other error, with the word "Reload" in the text and nothing to press. It is
 * red now, with a Reload that reloads.
 *
 * The sales rep (F21). The role holds corrections.fix and nothing else, and
 * closing a send-back called two actions that both demanded call_records.edit,
 * so "Mark it fixed" answered "That did not save." It is one action now, and
 * that action answers to corrections.fix.
 */

const ACSL_AGENT_ID = "b0000000-0000-4000-8000-000000000003";
const SAFE_ID = /^[0-9a-f-]{36}$/;

test.describe.configure({ timeout: 240_000 });

type Sale = { sale_id: string; stove_serial_no: string; end_user_name: string };

async function liveSales(): Promise<Sale[]> {
  const rows = await branchSql<Sale>(
    `select s.id::text as sale_id, s.stove_serial_no, s.end_user_name
       from public.sales s
      where s.is_archived is not true and s.end_user_name is not null and s.stove_serial_no is not null
      order by s.id limit 5`,
  );
  expect(rows.length).toBeGreaterThanOrEqual(4);
  for (const r of rows) expect(SAFE_ID.test(r.sale_id)).toBe(true);
  return rows;
}

/** A call record exists for the sale; says whether it did before. */
async function ensureRecord(saleId: string): Promise<boolean> {
  const [before] = await branchSql<{ n: number }>(
    `select count(*)::int as n from data_center.call_records where sale_id = '${saleId}'`,
  );
  await branchSql(
    `insert into data_center.call_records (sale_id) values ('${saleId}') on conflict (sale_id) do nothing`,
  );
  return Number(before.n) > 0;
}

async function dropRecordUnless(saleId: string, existed: boolean) {
  await branchSql(`delete from data_center.call_drafts where sale_id = '${saleId}'`);
  if (!existed) await branchSql(`delete from data_center.call_records where sale_id = '${saleId}'`);
}

async function openQueue(page: Page) {
  await page.goto("/data-center/call-centre");
  await expect(page.getByRole("heading", { name: "Call Centre" })).toBeVisible({ timeout: 20_000 });
}

async function openRecord(page: Page, serial: string) {
  const row = page
    .getByRole("button", { name: /^Open call record for/ })
    .filter({ hasText: serial })
    .first();
  await expect(row, `the queue should list ${serial}`).toBeVisible({ timeout: 20_000 });
  await row.click();
  await expect(page.getByRole("heading", { name: "Verification outcome" })).toBeVisible({ timeout: 15_000 });
  return page.getByRole("dialog");
}

const wardInput = (page: Page) => page.getByText("Ward").last().locator("xpath=following::input[1]");

test.describe("slice 7b: the levers ask first, and No does nothing", () => {
  test("clearing an unfinished form asks", async ({ page }) => {
    const [a] = await liveSales();
    const existed = await ensureRecord(a.sale_id);
    await branchSql(`delete from data_center.call_drafts where sale_id = '${a.sale_id}'`);
    try {
      await signIn(page, USERS.admin);
      await openQueue(page);
      let dialog = await openRecord(page, a.stove_serial_no);
      await wardInput(page).fill("Ward typed for 7b");
      await page.waitForTimeout(2_600); // the autosave debounce
      await dialog.getByRole("button", { name: "Finish later" }).click();
      await expect(dialog).toHaveCount(0, { timeout: 15_000 });

      dialog = await openRecord(page, a.stove_serial_no);
      const clear = dialog.getByRole("button", { name: /Clear it and start again/ });
      await expect(clear, "the unfinished form should be offered for clearing").toBeVisible({ timeout: 15_000 });
      await clear.click();

      const ask = page.getByRole("alertdialog");
      await expect(ask, "clearing should ask first").toBeVisible({ timeout: 10_000 });
      await expect(ask).toContainText("Clear this unfinished form?");
      await ask.getByRole("button", { name: "Keep the answers" }).click();
      await expect(ask).toHaveCount(0);
      await expect(clear, "No should leave the draft where it was").toBeVisible();
      await expect(wardInput(page)).toHaveValue("Ward typed for 7b");

      await clear.click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Clear it" }).click();
      await expect(dialog.getByText("Started again from the saved record.")).toBeVisible({ timeout: 15_000 });
    } finally {
      await dropRecordUnless(a.sale_id, existed);
    }
  });

  test("moving a record onto another stove asks, and No writes nothing", async ({ page }) => {
    const [, b] = await liveSales();
    const existed = await ensureRecord(b.sale_id);
    try {
      await signIn(page, USERS.admin);
      await openQueue(page);
      const dialog = await openRecord(page, b.stove_serial_no);
      await dialog.getByRole("button", { name: "Fix the stove ID" }).click();
      await dialog.getByLabel("Confirmed stove ID").fill("PRV999999");
      await dialog.getByRole("button", { name: "Move this record onto it" }).click();

      const ask = page.getByRole("alertdialog");
      await expect(ask, "the move should ask first").toBeVisible({ timeout: 10_000 });
      await expect(ask).toContainText("Move this record onto PRV999999?");
      await ask.getByRole("button", { name: "Leave it" }).click();
      await expect(ask).toHaveCount(0);

      const [after] = await branchSql<{ stove_serial_no: string }>(
        `select stove_serial_no from public.sales where id = '${b.sale_id}'`,
      );
      expect(after.stove_serial_no, "No must not have moved the record").toBe(b.stove_serial_no);
    } finally {
      await branchSql(
        `update public.sales set stove_serial_no = '${b.stove_serial_no}' where id = '${b.sale_id}'`,
      );
      await dropRecordUnless(b.sale_id, existed);
    }
  });

  test("Unassign still asks, through the same dialog", async ({ page }) => {
    await signIn(page, USERS.admin);
    await openQueue(page);
    await expect(page.getByRole("heading", { name: "Agents and their work" })).toBeVisible({ timeout: 40_000 });

  test("Assign now and Reclaim ask, and No runs nothing", async ({ page }) => {
    const calls: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/functions/v1/data-center-assign")) calls.push(r.postData() ?? "");
    });
    await signIn(page, USERS.admin);
    await openQueue(page);
    await expect(page.getByText("Assignment Log")).toBeVisible({ timeout: 40_000 });

    await page.getByRole("button", { name: "Assign now" }).click();
    let ask = page.getByRole("alertdialog");
    await expect(ask, "Assign now should ask first").toBeVisible({ timeout: 10_000 });
    await expect(ask).toContainText("Assign the pool now?");
    await ask.getByRole("button", { name: "Not now" }).click();
    await expect(ask).toHaveCount(0);

    await page.getByRole("button", { name: "Reclaim quiet batches" }).click();
    ask = page.getByRole("alertdialog");
    await expect(ask, "Reclaim should ask first").toBeVisible({ timeout: 10_000 });
    await expect(ask).toContainText("Reclaim quiet batches?");
    await ask.getByRole("button", { name: "Not now" }).click();
    await expect(ask).toHaveCount(0);

    await page.waitForTimeout(1_000);
    const acted = calls.filter((body) => /"action"\s*:\s*"(run|reclaim)"/.test(body));
    expect(acted, "No must not have run the assignment or the reclaim").toHaveLength(0);
  });

    const opener = page.getByRole("button", { name: /^What .* is holding$/ }).first();
    await expect(opener).toBeVisible({ timeout: 20_000 });
    await opener.click();
    await page.getByRole("button", { name: "Unassign batch" }).first().click();
    const ask = page.getByRole("alertdialog");
    await expect(ask).toBeVisible({ timeout: 10_000 });
    await expect(ask).toContainText("Return this work to the pool?");
    await ask.getByRole("button", { name: "Keep it assigned" }).click();
    await expect(ask).toHaveCount(0);
  });
});

test("Finish later says when the typing could not be kept, and offers to close anyway", async ({ page }) => {
  const [, , c] = await liveSales();
  const existed = await ensureRecord(c.sale_id);
  try {
    await signIn(page, USERS.admin);
    await openQueue(page);
    const dialog = await openRecord(page, c.stove_serial_no);
    // Past the server's ceiling for a draft, so keeping it is refused.
    await wardInput(page).fill("x".repeat(300_000));
    await dialog.getByRole("button", { name: "Finish later" }).click();

    const alert = dialog.getByRole("alert").filter({ hasText: "could not be kept" });
    await expect(alert, "the failure should be shown, not swallowed").toBeVisible({ timeout: 15_000 });
    await expect(dialog, "and the editor should still be open").toBeVisible();
    await alert.getByRole("button", { name: "Close anyway" }).click();
    await expect(dialog).toHaveCount(0, { timeout: 15_000 });
  } finally {
    await dropRecordUnless(c.sale_id, existed);
  }
});

test("a save that lost to somebody else is red, and Reload reloads", async ({ page }) => {
  const [, , , d] = await liveSales();
  const existed = await ensureRecord(d.sale_id);
  try {
    await signIn(page, USERS.admin);
    await openQueue(page);
    const dialog = await openRecord(page, d.stove_serial_no);
    // Somebody else saves while the editor is open.
    await branchSql(`update data_center.call_records set version = version + 1 where sale_id = '${d.sale_id}'`);
    await dialog.getByRole("button", { name: "Partly verified", exact: true }).click();
    await dialog.getByRole("button", { name: "Save", exact: true }).click();

    const alert = dialog.getByRole("alert").filter({ hasText: "Someone else changed this record" });
    await expect(alert).toBeVisible({ timeout: 15_000 });
    await expect(alert, "a conflict should be red, not the amber of every other error").toHaveClass(/red/);
    const reload = alert.getByRole("button", { name: "Reload" });
    await expect(reload, "and it should offer a Reload").toBeVisible();
    await reload.click();
    await expect(alert).toHaveCount(0, { timeout: 15_000 });

    await dialog.getByRole("button", { name: "Partly verified", exact: true }).click();
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog.getByText("Saved.", { exact: true })).toBeVisible({ timeout: 15_000 });
  } finally {
    await branchSql(
      `update data_center.call_records set verification_outcome = 'not_verified' where sale_id = '${d.sale_id}'`,
    );
    await dropRecordUnless(d.sale_id, existed);
  }
});

test("a sales rep can close a send-back routed to them, note and all", async ({ page }) => {
  const [e] = await liveSales();
  const existed = await ensureRecord(e.sale_id);
  const [access] = await branchSql<{ access_role: string | null }>(
    `select access_role from data_center.module_access where user_id = '${ACSL_AGENT_ID}'`,
  );
  const note = "Fixed the phone number on the receipt, 7b";
  try {
    await branchSql(
      `insert into data_center.module_access (user_id, access_role) values ('${ACSL_AGENT_ID}', 'sales_rep')
       on conflict (user_id) do update set access_role = 'sales_rep'`,
    );
    await branchSql(
      `update data_center.call_records
          set correction_requested_at = now(), correction_resolved_at = null, correction_resolved_by = null
        where sale_id = '${e.sale_id}'`,
    );

    await signIn(page, USERS.acslAgent);
    await page.goto("/data-center/corrections");
    await expect(page.getByRole("heading", { name: "Records to fix" })).toBeVisible({ timeout: 30_000 });
    const link = page.getByRole("link", { name: e.stove_serial_no });
    await expect(link, "the sent-back record should be listed for the sales rep").toBeVisible({ timeout: 20_000 });
    const row = link.locator("xpath=ancestor::li[1] | ancestor::tr[1] | ancestor::div[contains(@class,'flex')][1]").first();
    await row.getByRole("button", { name: /Mark it fixed/ }).click();
    await page.getByPlaceholder(/What did you do\?/).fill(note);
    await page.getByRole("button", { name: "Send it back to the call centre" }).click();

    await expect
      .poll(
        async () => {
          const [r] = await branchSql<{ resolved: boolean; other_comments: string | null }>(
            `select correction_resolved_at is not null as resolved, other_comments
               from data_center.call_records where sale_id = '${e.sale_id}'`,
          );
          return `${r.resolved}:${r.other_comments ?? ""}`;
        },
        { timeout: 20_000, message: "the send-back should be closed by the sales rep, with the note" },
      )
      .toBe(`true:${note}`);
    await expect(page.getByText("That did not save.")).toHaveCount(0);
  } finally {
    if (access?.access_role) {
      await branchSql(
        `update data_center.module_access set access_role = '${access.access_role}' where user_id = '${ACSL_AGENT_ID}'`,
      );
    } else {
      await branchSql(`delete from data_center.module_access where user_id = '${ACSL_AGENT_ID}'`);
    }
    await branchSql(
      `update data_center.call_records
          set correction_requested_at = null, correction_resolved_at = null, correction_resolved_by = null,
              other_comments = null
        where sale_id = '${e.sale_id}'`,
    );
    await dropRecordUnless(e.sale_id, existed);
  }
});
