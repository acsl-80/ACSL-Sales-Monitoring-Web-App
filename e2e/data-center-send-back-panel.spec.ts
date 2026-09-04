import { test, expect, type Page } from "@playwright/test";
import { signIn, USERS, branchSql } from "./helpers";

/**
 * The send-back panel inside the call editor.
 *
 * Every active reason is visible as a chip without opening anything; picking
 * a reason pre-ticks the fields Settings maps to it; the note is there, and
 * "something else" refuses without one; who receives it is said before it
 * goes; once sent, the same panel shows the episode and offers Withdraw.
 *
 * Red on main: the section is one dropdown labelled "Reason for sending it
 * back", with no radios, no field chips and no note.
 */

const SAFE_ID = /^[0-9a-f-]{36}$/;

test.describe.configure({ timeout: 240_000 });

type Sale = { sale_id: string; stove_serial_no: string };

async function liveSale(): Promise<Sale | null> {
  const rows = await branchSql<Sale>(
    `select s.id::text as sale_id, s.stove_serial_no
       from public.sales s
      where s.is_archived is not true and s.stove_serial_no is not null
        and not exists (select 1 from data_center.corrections c where c.sale_id = s.id)
      order by s.id limit 1`,
  );
  const row = rows[0] ?? null;
  if (row) expect(SAFE_ID.test(row.sale_id)).toBe(true);
  return row;
}

async function ensureRecord(saleId: string): Promise<() => Promise<void>> {
  const [before] = await branchSql<{ n: number }>(
    `select count(*)::int as n from data_center.call_records where sale_id = '${saleId}'`,
  );
  await branchSql(`insert into data_center.call_records (sale_id) values ('${saleId}') on conflict (sale_id) do nothing`);
  return async () => {
    await branchSql(`delete from data_center.corrections where sale_id = '${saleId}'`).catch(() => {});
    await branchSql(`delete from data_center.call_drafts where sale_id = '${saleId}'`).catch(() => {});
    if (Number(before.n) === 0) await branchSql(`delete from data_center.call_records where sale_id = '${saleId}'`);
  };
}

async function activeReasons(): Promise<{ value: string; label: string }[]> {
  return branchSql<{ value: string; label: string }>(
    `select value, label from data_center.option_values
      where list_key = 'correction_reason' and is_active order by sort_order`,
  );
}

async function openRecord(page: Page, serial: string) {
  await page.goto("/data-center/call-centre");
  await expect(page.getByRole("heading", { name: "Call Centre" })).toBeVisible({ timeout: 20_000 });
  const row = page.getByRole("button", { name: /^Open call record for/ }).filter({ hasText: serial }).first();
  await expect(row, `the queue should list ${serial}`).toBeVisible({ timeout: 20_000 });
  await row.click();
  await expect(page.getByRole("heading", { name: "Verification outcome" })).toBeVisible({ timeout: 15_000 });
  return page.getByRole("dialog");
}

test("every active reason is a visible chip, and the reason pre-ticks its fields", async ({ page }) => {
  const sale = await liveSale();
  test.skip(!sale, "no live sale without episodes on the branch");
  const cleanup = await ensureRecord(sale!.sale_id);
  try {
    const reasons = await activeReasons();
    expect(reasons.length).toBeGreaterThan(0);

    await signIn(page, USERS.admin);
    const dialog = await openRecord(page, sale!.stove_serial_no);
    const panel = dialog.locator("[data-send-back-state]");
    await expect(panel).toBeVisible({ timeout: 20_000 });
    await expect(panel).toHaveAttribute("data-send-back-state", "none");

    // No dropdown to open: the reasons are radios, all of them.
    await expect(dialog.getByRole("combobox", { name: /Reason for sending/ })).toHaveCount(0);
    const radios = panel.getByRole("radio");
    await expect(radios).toHaveCount(reasons.length);
    for (const r of reasons) await expect(panel.getByRole("radio", { name: r.label })).toBeVisible();

    // Picking the phone reason ticks the phone fields Settings maps to it.
    const phoneReason = reasons.find((r) => r.value === "wrong_phone");
    test.skip(!phoneReason, "wrong_phone is retired on this branch");
    await panel.getByRole("radio", { name: phoneReason!.label }).click();
    await expect(panel.getByRole("checkbox", { name: "Phone", exact: true })).toHaveAttribute("aria-checked", "true", { timeout: 15_000 });
    await expect(panel.getByRole("checkbox", { name: "Other phone" })).toHaveAttribute("aria-checked", "true");
    await expect(panel.getByRole("checkbox", { name: "End user name" })).toHaveAttribute("aria-checked", "false");

    // The note is right there, and who receives it is said before it goes.
    await expect(panel.getByLabel("Tell Sales what you heard")).toBeVisible();
    await expect(panel.getByText(/will see this in Corrections|standing recipient|Nobody is set up/)).toBeVisible({ timeout: 15_000 });
  } finally {
    await cleanup();
  }
});

test("something else refuses without a note; a send-back lands with its fields and can be withdrawn from the same panel", async ({ page }) => {
  const sale = await liveSale();
  test.skip(!sale, "no live sale without episodes on the branch");
  const cleanup = await ensureRecord(sale!.sale_id);
  try {
    const reasons = await activeReasons();
    const other = reasons.find((r) => r.value === "other");
    const phone = reasons.find((r) => r.value === "wrong_phone");
    test.skip(!other || !phone, "the seeded reasons are not on this branch");

    await signIn(page, USERS.admin);
    const dialog = await openRecord(page, sale!.stove_serial_no);
    const panel = dialog.locator("[data-send-back-state]");
    await expect(panel).toBeVisible({ timeout: 20_000 });

    await panel.getByRole("radio", { name: other!.label }).click();
    await expect(panel.getByRole("button", { name: "Send back to Sales" })).toBeDisabled();

    await panel.getByRole("radio", { name: phone!.label }).click();
    await expect(panel.getByRole("checkbox", { name: "Phone", exact: true })).toHaveAttribute("aria-checked", "true", { timeout: 15_000 });
    await panel.getByRole("checkbox", { name: "End user name" }).click();
    await panel.getByLabel("Tell Sales what you heard").fill("e2e: rings a different household, and the name on the receipt is not who answers");
    await panel.getByRole("button", { name: "Send back to Sales" }).click();

    await expect
      .poll(async () => {
        const [e] = await branchSql<{ state: string; fields: string[] | null }>(
          `select state, disputed_fields as fields from data_center.corrections where sale_id = '${sale!.sale_id}' order by seq desc limit 1`,
        );
        return e ? `${e.state}:${(e.fields ?? []).slice().sort().join(",")}` : "none";
      }, { timeout: 30_000 })
      .toBe("open:end_user_name,other_phone,phone");

    // The same panel now shows the episode, and offers the way back.
    await expect(panel).toHaveAttribute("data-send-back-state", "open", { timeout: 20_000 });
    await expect(panel.getByText("Waiting on Sales")).toBeVisible();
    await expect(panel.getByText("End user name")).toBeVisible();
    await panel.getByRole("button", { name: "Withdraw" }).click();
    await expect
      .poll(async () => {
        const [e] = await branchSql<{ state: string; review_outcome: string | null }>(
          `select state, review_outcome from data_center.corrections where sale_id = '${sale!.sale_id}' order by seq desc limit 1`,
        );
        return `${e?.state}:${e?.review_outcome}`;
      }, { timeout: 30_000 })
      .toBe("resolved:withdrawn");
    await expect(panel).toHaveAttribute("data-send-back-state", "none", { timeout: 20_000 });
  } finally {
    await cleanup();
  }
});
