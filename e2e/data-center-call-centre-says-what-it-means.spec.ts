import { test, expect, type Page } from "@playwright/test";
import { branchSql, signIn, USERS } from "./helpers";

/**
 * Slice 7a of the 2026-09-02 review: the call centre says what it means.
 *
 * Words. Every screen turned an outcome into words its own way, and
 * "unverified" meant two things. One vocabulary now: Verified, Partly
 * verified, Unreachable, Yet to be resolved. Against the old code the queue
 * says "not verified" for a record nobody has resolved and offers a preset
 * called "Still to verify"; the editor's buttons say "Fully verified".
 *
 * Tones. The queue's tone map had no key for unreachable, so an unreachable
 * pill rendered with the class "undefined": no colour at all. 141 live
 * records sat in that state on 2026-09-03.
 *
 * The corrected buyer. The queue listed the receipt's name and phone while
 * the editor showed the corrected ones. The row payload carried both all
 * along; the queue now shows what the caller established, with a mark that
 * says the receipt differed.
 *
 * The stove ID another caller took. The preset could find those records but
 * no row could be marked as one, because the payload did not carry the flag.
 * It does now, and the serial wears the mark.
 *
 * Time. A call was shown by its date alone, in the browser's zone. It now
 * shows date and time in Lagos.
 */

type Snap = {
  sale_id: string;
  stove_serial_no: string;
  end_user_name: string;
  existed: boolean;
  verification_outcome: string | null;
  corrected_end_user_name: string | null;
  corrected_phone: string | null;
  serial_unconfirmed_at: string | null;
  attempt_count: number | null;
  last_attempt_at: string | null;
};

const SAFE_ID = /^[0-9a-f-]{36}$/;
const CORRECTED_NAME = "Corrected Buyer Seven";
const ATTEMPT_AT = "2026-03-05 22:30:00+00";
const ATTEMPT_NO = 97;

test.describe.configure({ timeout: 240_000 });

async function pick(): Promise<Snap[]> {
  const sales = await branchSql<{ sale_id: string; stove_serial_no: string; end_user_name: string }>(
    `select s.id::text as sale_id, s.stove_serial_no, s.end_user_name
       from public.sales s
      where s.is_archived is not true and s.end_user_name is not null and s.stove_serial_no is not null
      order by s.id limit 3`,
  );
  expect(sales.length, "the seed should hold three live sales").toBe(3);
  const out: Snap[] = [];
  for (const s of sales) {
    expect(SAFE_ID.test(s.sale_id)).toBe(true);
    const [r] = await branchSql<Omit<Snap, "sale_id" | "stove_serial_no" | "end_user_name" | "existed">>(
      `select verification_outcome, corrected_end_user_name, corrected_phone,
              serial_unconfirmed_at::text, attempt_count, last_attempt_at::text
         from data_center.call_records where sale_id = '${s.sale_id}'`,
    );
    out.push({
      ...s,
      existed: Boolean(r),
      verification_outcome: r?.verification_outcome ?? null,
      corrected_end_user_name: r?.corrected_end_user_name ?? null,
      corrected_phone: r?.corrected_phone ?? null,
      serial_unconfirmed_at: r?.serial_unconfirmed_at ?? null,
      attempt_count: r?.attempt_count ?? null,
      last_attempt_at: r?.last_attempt_at ?? null,
    });
  }
  return out;
}

const lit = (v: string | number | null) => (v == null ? "null" : `'${String(v).replace(/'/g, "''")}'`);

async function restore(snaps: Snap[]) {
  for (const s of snaps) {
    await branchSql(`delete from data_center.call_attempts where sale_id = '${s.sale_id}' and attempt_no = ${ATTEMPT_NO}`);
    if (!s.existed) {
      await branchSql(`delete from data_center.call_records where sale_id = '${s.sale_id}'`);
    } else {
      await branchSql(
        `update data_center.call_records
            set verification_outcome = ${lit(s.verification_outcome)},
                corrected_end_user_name = ${lit(s.corrected_end_user_name)},
                corrected_phone = ${lit(s.corrected_phone)},
                serial_unconfirmed_at = ${lit(s.serial_unconfirmed_at)}::timestamptz,
                attempt_count = ${lit(s.attempt_count)},
                last_attempt_at = ${lit(s.last_attempt_at)}::timestamptz
          where sale_id = '${s.sale_id}'`,
      );
    }
  }
}

async function openQueue(page: Page) {
  await page.goto("/data-center/call-centre");
  await expect(page.getByRole("heading", { name: "Call Centre" })).toBeVisible({ timeout: 20_000 });
}

/**
 * The row for a stove, found by the serial in its text. The seed holds a
 * handful of sales, all rendered, so nothing needs the search box; and the
 * row's own name changes with this slice (it carries the corrected buyer),
 * which is why the serial is the handle and not the name.
 */
async function rowFor(page: Page, serial: string) {
  const row = page
    .getByRole("button", { name: /^Open call record for/ })
    .filter({ hasText: serial })
    .first();
  await expect(row, `the queue should list ${serial}`).toBeVisible({ timeout: 20_000 });
  return row;
}

let snaps: Snap[] = [];

test.beforeAll(async () => {
  snaps = await pick();
  const [a, b, c] = snaps;
  for (const s of snaps) {
    await branchSql(`insert into data_center.call_records (sale_id) values ('${s.sale_id}') on conflict (sale_id) do nothing`);
  }
  await branchSql(
    `update data_center.call_records
        set verification_outcome = 'unreachable',
            corrected_end_user_name = '${CORRECTED_NAME}',
            corrected_phone = '08011112222',
            serial_unconfirmed_at = null
      where sale_id = '${a.sale_id}'`,
  );
  await branchSql(
    `update data_center.call_records
        set verification_outcome = 'not_verified', serial_unconfirmed_at = null
      where sale_id = '${b.sale_id}'`,
  );
  await branchSql(
    `update data_center.call_records set serial_unconfirmed_at = now() where sale_id = '${c.sale_id}'`,
  );
  // One call on the record, at a known instant, so the time on screen can be
  // compared with the same instant said in Lagos.
  await branchSql(
    `insert into data_center.call_attempts (sale_id, attempt_no, attempted_at)
     values ('${a.sale_id}', ${ATTEMPT_NO}, '${ATTEMPT_AT}'::timestamptz)`,
  );
});

test.afterAll(async () => {
  await restore(snaps);
});

test("the queue says it in one word, shows the corrected buyer, and marks a stove ID another caller took", async ({
  page,
}) => {
  const [a, b, c] = snaps;
  await signIn(page, USERS.admin);
  await openQueue(page);

  await expect.soft(page.getByRole("button", { name: "Yet to be resolved", exact: true })).toBeVisible();
  await expect.soft(page.getByRole("button", { name: "Still to verify", exact: true })).toHaveCount(0);

  // The corrected buyer, with the mark, and an unreachable pill that has a tone.
  const rowA = await rowFor(page, a.stove_serial_no);
  await expect.soft(rowA, "the queue should show the name the caller established").toContainText(CORRECTED_NAME);
  await expect.soft(rowA.getByText("corrected", { exact: true }).first(), "and say the receipt differed").toBeVisible();
  const pill = rowA.getByText("Unreachable", { exact: true });
  await expect.soft(pill).toBeVisible();
  await expect.soft(pill, "an unreachable pill should carry its tone, not the class undefined").toHaveClass(/orange/);
  await expect.soft(pill).not.toHaveClass(/undefined/);

  // A record nobody has resolved.
  const rowB = await rowFor(page, b.stove_serial_no);
  await expect.soft(rowB.getByText("Yet to be resolved", { exact: true })).toBeVisible();
  await expect.soft(rowB.getByText("not verified", { exact: true })).toHaveCount(0);

  // The stove ID another caller took, marked on the row and not only findable.
  await page.getByRole("button", { name: "Serial number unconfirmed", exact: true }).click();
  const rowC = page
    .getByRole("button", { name: /^Open call record for/ })
    .filter({ hasText: c.stove_serial_no })
    .first();
  await expect.soft(rowC).toBeVisible({ timeout: 20_000 });
  await expect.soft(rowC.getByText("unconfirmed", { exact: true }), "the serial should wear the mark").toBeVisible();
});

test("the editor uses the same words and shows when a call was made, in Lagos time", async ({ page }) => {
  const [a] = snaps;
  await signIn(page, USERS.admin);
  await openQueue(page);
  const row = await rowFor(page, a.stove_serial_no);
  await row.click();
  await expect(page.getByRole("heading", { name: "Verification outcome" })).toBeVisible({ timeout: 15_000 });

  const dialog = page.getByRole("dialog");
  for (const word of ["Verified", "Partly verified", "Unreachable", "Yet to be resolved"]) {
    await expect(dialog.getByRole("button", { name: word, exact: true }), `a button called ${word}`).toBeVisible();
  }
  await expect(dialog.getByRole("button", { name: "Fully verified", exact: true })).toHaveCount(0);

  // The instant 2026-03-05 22:30 UTC is 23:30 on the 5th in Lagos.
  const expected = new Intl.DateTimeFormat("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Africa/Lagos",
  }).format(new Date("2026-03-05T22:30:00Z"));
  expect(expected).toBe("5 Mar 2026, 23:30");
  await expect(
    dialog.getByText(expected, { exact: true }),
    "the call should show its date and time in Lagos, not the date alone in the browser's zone",
  ).toBeVisible({ timeout: 15_000 });
});
