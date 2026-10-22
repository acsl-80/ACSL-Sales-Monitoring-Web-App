import { test, expect } from "@playwright/test";
import { signIn, USERS, branchSql } from "./helpers";

/**
 * D69: a record on Records to fix can be searched for, and a stove that is
 * not on it says where it is.
 *
 * His report of 22 October: typing in the search "does not let you type, it
 * jumps as soon as you type a character", and three Solar Sister stoves
 * "supposed to be fixed" could not be found. Production that day: the list
 * remounted its filter bar each time the typed text reached the URL, so the
 * cursor left the box; two of the three stoves were import rows stopped on
 * an exception that never became sales, and the third a sale nobody had sent
 * back. Neither kind is on this list, and the page said only "No record
 * matches these filters".
 *
 * Red on main: the box keeps one character, a phone typed as +234 or a TR
 * reference finds nothing, another tab's match is never mentioned, and no
 * stove's whereabouts are shown.
 *
 * The preview database is shared: what this makes it deletes, and nothing
 * else.
 */

const SAFE_ID = /^[0-9a-f-]{36}$/;
const SERIAL = /^[0-9A-Za-z-]+$/;

test.describe.configure({ mode: "serial", timeout: 240_000 });

type Sale = {
  sale_id: string;
  stove_serial_no: string;
  phone: string;
  transfer_reference: string;
  sales_rep: string;
  had_call_record: boolean;
};

/** A sale on a named consignment with an 0-prefixed phone and no send-back. */
async function freshSale(): Promise<Sale> {
  const [row] = await branchSql<Sale>(
    `select s.id::text as sale_id, s.stove_serial_no, s.phone, f.transaction_id as transfer_reference,
            trim(coalesce(f.sales_rep, '')) as sales_rep,
            exists (select 1 from data_center.call_records cr where cr.sale_id = s.id) as had_call_record
       from public.sales s
       join data_center.v_transfer_stoves b on b.stove_id = upper(trim(s.stove_serial_no))
       join data_center.transfer_funnel f on f.transfer_id = b.transfer_id
      where s.is_archived is not true and s.phone ~ '^0[0-9]{10}$' and f.transaction_id is not null
        and not exists (select 1 from data_center.corrections c where c.sale_id = s.id)
      order by s.id limit 1`,
  );
  expect(row, "a sale with a phone, on a consignment, never sent back").toBeTruthy();
  expect(SAFE_ID.test(row.sale_id)).toBe(true);
  expect(SERIAL.test(row.stove_serial_no)).toBe(true);
  return row;
}

async function sendBack(sale: Sale) {
  const repKey = sale.sales_rep.toLowerCase().replace(/'/g, "''");
  await branchSql(
    `insert into data_center.corrections (sale_id, seq, state, note, opened_at, routed_rep_key, disputed_fields, before)
     values ('${sale.sale_id}', 1, 'open', 'e2e: findable', now(), '${repKey}', '{phone}',
             data_center.sale_snapshot('${sale.sale_id}'))`,
  );
  return async () => {
    await branchSql(`delete from data_center.corrections where sale_id = '${sale.sale_id}'`).catch(() => {});
    if (!sale.had_call_record) {
      await branchSql(`delete from data_center.call_records where sale_id = '${sale.sale_id}'`).catch(() => {});
    }
  };
}

const rows = (page: import("@playwright/test").Page) => page.locator("[data-correction-row]");

test("the search box keeps the cursor and every character, and the page does not jump", async ({ page }) => {
  const sale = await freshSale();
  const undo = await sendBack(sale);
  try {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/corrections");
    await expect(page.getByRole("heading", { name: "Records to fix" })).toBeVisible({ timeout: 30_000 });

    // Room to scroll, then scrolled, so a reset to the top is visible.
    await page.evaluate(() => document.body.style.setProperty("min-height", "3000px"));
    await page.getByLabel("Search").scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, 120));
    const before = await page.evaluate(() => window.scrollY);

    // Slower than the 350 ms pause, so the URL is written after every key.
    const box = page.getByLabel("Search");
    await box.click();
    await box.pressSequentially(sale.stove_serial_no, { delay: 450 });
    // A digits-only value is written JSON-quoted (q=%22...%22).
    await expect(page).toHaveURL(new RegExp(`q=(%22)?${sale.stove_serial_no}`), { timeout: 10_000 });
    await expect(box).toBeFocused();
    await expect(box).toHaveValue(sale.stove_serial_no);
    await expect(rows(page).filter({ hasText: sale.stove_serial_no })).toHaveCount(1, { timeout: 30_000 });
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(Math.max(0, before - 5));

    // Back to an empty box from the chip, and the box follows the URL.
    await page.getByRole("button", { name: /Remove filter:/ }).click();
    await expect(box).toHaveValue("");
  } finally {
    await undo();
  }
});

test("a phone in any form and the TR reference find the record", async ({ page }) => {
  const sale = await freshSale();
  const undo = await sendBack(sale);
  try {
    await signIn(page, USERS.admin);
    const international = `+234 ${sale.phone.slice(1, 4)} ${sale.phone.slice(4)}`;
    await page.goto(`/data-center/corrections?q=${encodeURIComponent(international)}`);
    await expect(rows(page).filter({ hasText: sale.stove_serial_no })).toHaveCount(1, { timeout: 30_000 });

    await page.goto(`/data-center/corrections?q=${encodeURIComponent(sale.transfer_reference)}`);
    await expect(rows(page).filter({ hasText: sale.stove_serial_no })).toHaveCount(1, { timeout: 30_000 });
  } finally {
    await undo();
  }
});

test("a match in another tab is named, and one click shows it", async ({ page }) => {
  const sale = await freshSale();
  const undo = await sendBack(sale);
  try {
    await signIn(page, USERS.admin);
    await page.goto(`/data-center/corrections?tab=resolved&q=${sale.stove_serial_no}`);
    const go = page.getByRole("button", { name: /1 match in Waiting on Sales/ });
    await expect(go).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("tab", { name: /Waiting on Sales/ })).toContainText("1 of");
    await go.click();
    await expect(rows(page).filter({ hasText: sale.stove_serial_no })).toHaveCount(1, { timeout: 30_000 });
  } finally {
    await undo();
  }
});

test("a stove that is not on the list says where it is", async ({ page }) => {
  // A sale never sent back.
  const sold = await freshSale();

  // A stove in stock on a transfer, with no sale, given an import row stopped
  // on an exception in a committed file: the shape of 101093799 on production.
  // Digits only, as every stove ID is, so the link below carries a number.
  const [stock] = await branchSql<{ stove_id: string }>(
    `select sb.stove_id from public.stove_ids_base sb
       join data_center.v_transfer_stoves b on b.stove_id = sb.stove_id
      where sb.status = 'available' and sb.is_archived is not true and sb.stove_id ~ '^[0-9]+$'
        and not exists (select 1 from public.sales s where upper(s.stove_serial_no) = upper(sb.stove_id))
        and not exists (select 1 from data_center.import_rows r where r.stove_serial_no = sb.stove_id)
      order by sb.stove_id limit 1`,
  );
  expect(stock, "an available stove with no sale and no import").toBeTruthy();
  const [batch] = await branchSql<{ id: string }>(
    `insert into data_center.import_batches (source, state, filename, total_rows)
     values ('receipt', 'committed', 'e2e-whereabouts.csv', 1) returning id::text`,
  );
  await branchSql(
    `insert into data_center.import_rows (batch_id, row_number, raw, status, stove_serial_no, exception_reason)
     values ('${batch.id}', 7, '{}'::jsonb, 'exception', '${stock.stove_id}',
             'e2e: the partner is not assigned this sales model')`,
  );
  try {
    await signIn(page, USERS.admin);

    await page.goto(`/data-center/corrections?q=${stock.stove_id}`);
    const where = page.locator("[data-whereabouts]");
    await expect(where).toContainText(`Stove ${stock.stove_id} has no sale yet`, { timeout: 30_000 });
    await expect(where).toContainText("e2e-whereabouts.csv, row 7");
    await expect(where).toContainText("stopped on an exception (file committed)");
    await expect(where).toContainText("e2e: the partner is not assigned this sales model");
    // Under another filter it says nothing: the stove could be sent back to
    // somebody that filter hides.
    await page.goto(`/data-center/corrections?q=${stock.stove_id}&partner=e2e-no-such-partner`);
    await expect(page.getByText("No record matches these filters.")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("[data-whereabouts]")).toHaveCount(0);

    await page.goto(`/data-center/corrections?q=${stock.stove_id}`);
    await where.getByRole("link", { name: "Open the stove record" }).click();
    await expect(page).toHaveURL(new RegExp(`/data-center/stove/${stock.stove_id}`), { timeout: 30_000 });

    await page.goto(`/data-center/corrections?q=${sold.stove_serial_no}`);
    await expect(page.locator("[data-whereabouts]")).toContainText(
      "is a sale the call centre has not sent back",
      { timeout: 30_000 },
    );

    await page.goto("/data-center/corrections?q=NOSUCHSTOVE9");
    await expect(page.locator("[data-whereabouts]")).toContainText("no stove has that ID", { timeout: 30_000 });
  } finally {
    await branchSql(`delete from data_center.import_rows where batch_id = '${batch.id}'`).catch(() => {});
    await branchSql(`delete from data_center.import_batches where id = '${batch.id}'`).catch(() => {});
  }
});
