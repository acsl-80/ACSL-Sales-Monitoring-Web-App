import { test, expect, type Page } from "@playwright/test";
import { signIn, USERS, branchSql } from "./helpers";

/**
 * Review and recall.
 *
 * A fixed episode is closed by the call centre. Closing with "ring again"
 * gives the record a fresh allowance of calls, so a record that had used all
 * of them comes back into v_callable_records; closing with "nothing to ring"
 * does not. The number the call centre heard is reconciled with the one Sales
 * saved: cleared when they agree, put to the reviewer when they do not.
 * "Send back again" opens the next episode. The queue has a preset for what
 * is awaiting review.
 *
 * Red on main: the view knows no allowance, nothing clears corrected_phone,
 * the panel has no phone check, and the queue has no such preset.
 */

const SAFE_ID = /^[0-9a-f-]{36}$/;

test.describe.configure({ timeout: 240_000 });

type Sale = { sale_id: string; phone: string; stove_serial_no: string | null };

async function liveSale(): Promise<Sale | null> {
  const rows = await branchSql<Sale>(
    `select s.id::text as sale_id, s.phone, s.stove_serial_no
       from public.sales s
      where s.is_archived is not true
        and length(regexp_replace(coalesce(s.phone, ''), '\\D', '', 'g')) >= 10
      order by s.id limit 1`,
  );
  const row = rows[0] ?? null;
  if (row) expect(SAFE_ID.test(row.sale_id)).toBe(true);
  return row;
}

async function callbackLimit(): Promise<number> {
  const rows = await branchSql<{ n: number }>(
    `select (value #>> '{}')::int as n from data_center.workflow_config where key = 'callback_limit'`,
  );
  return Number(rows[0]?.n ?? 3);
}

const q = (v: string | null | undefined) => (v == null ? "null" : `'${String(v).replace(/'/g, "''")}'`);

/**
 * One fixed episode on a record that has used every call it was allowed,
 * parked out of any batch so v_callable_records answers on the attempts alone.
 */
async function seedFixed(sale: Sale, heard: string | null) {
  const limit = await callbackLimit();
  const [was] = await branchSql<{
    attempt_count: number | null;
    verification_outcome: string | null;
    corrected_phone: string | null;
  }>(
    `select cr.attempt_count, cr.verification_outcome, cr.corrected_phone
       from data_center.call_records cr where cr.sale_id = '${sale.sale_id}'`,
  );
  await branchSql(
    `insert into data_center.call_records (sale_id) values ('${sale.sale_id}') on conflict (sale_id) do nothing`,
  );
  const parked = await branchSql<{ batch_id: string }>(
    `update data_center.assignment_items set is_active = false
      where sale_id = '${sale.sale_id}' and is_active
      returning batch_id::text`,
  );
  await branchSql(`delete from data_center.corrections where sale_id = '${sale.sale_id}'`);
  await branchSql(
    `update data_center.call_records
        set attempt_count = ${limit}, verification_outcome = 'not_verified', corrected_phone = ${q(heard)}
      where sale_id = '${sale.sale_id}'`,
  );
  await branchSql(
    `insert into data_center.corrections
       (sale_id, seq, state, note, opened_at, routed_rep_key, disputed_fields, before, fixed_at, fix_note, after)
     values ('${sale.sale_id}', 1, 'fixed', 'e2e: the number rings a different household',
             now() - interval '10 minutes', 'e2e rep', '{phone}',
             data_center.sale_snapshot('${sale.sale_id}'), now(), 'e2e: Sales corrected the number',
             data_center.sale_snapshot('${sale.sale_id}'))`,
  );
  const restore = async () => {
    await branchSql(`delete from data_center.corrections where sale_id = '${sale.sale_id}'`).catch(() => {});
    if (was) {
      await branchSql(
        `update data_center.call_records
            set attempt_count = ${was.attempt_count ?? "null"},
                verification_outcome = ${q(was.verification_outcome)},
                corrected_phone = ${q(was.corrected_phone)}
          where sale_id = '${sale.sale_id}'`,
      );
    } else {
      await branchSql(`delete from data_center.call_records where sale_id = '${sale.sale_id}'`);
    }
    if (parked.length > 0) {
      await branchSql(
        `update data_center.assignment_items set is_active = true
          where sale_id = '${sale.sale_id}'
            and batch_id in (${parked.map((p) => `'${p.batch_id}'`).join(",")})`,
      );
    }
  };
  return { limit, restore };
}

async function inPool(saleId: string): Promise<boolean> {
  const [r] = await branchSql<{ yes: boolean }>(
    `select exists (select 1 from data_center.v_callable_records r where r.sale_id = '${saleId}') as yes`,
  );
  return Boolean(r?.yes);
}

async function newestEpisode(saleId: string) {
  const [r] = await branchSql<{ seq: number; state: string; review_outcome: string | null; attempts_at_close: number | null }>(
    `select seq, state, review_outcome, attempts_at_close
       from data_center.corrections where sale_id = '${saleId}' order by seq desc limit 1`,
  );
  return r;
}

async function heardNumber(saleId: string): Promise<string | null> {
  const [r] = await branchSql<{ corrected_phone: string | null }>(
    `select corrected_phone from data_center.call_records where sale_id = '${saleId}'`,
  );
  return r?.corrected_phone ?? null;
}

async function openReview(page: Page, saleId: string) {
  await page.goto(`/data-center/corrections/${saleId}`);
  await expect(page.getByRole("heading", { name: "Review the fix" })).toBeVisible({ timeout: 30_000 });
}

test("closing with ring again returns an exhausted record to the pool and clears the number the call centre heard", async ({ page }) => {
  const sale = await liveSale();
  test.skip(!sale, "no live sale with a phone on the branch");
  const digits = sale!.phone.replace(/\D/g, "").slice(-10);
  // The same number, typed the way an agent types it.
  const heard = `+234 ${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
  const { limit, restore } = await seedFixed(sale!, heard);
  try {
    expect(await inPool(sale!.sale_id), "exhausted before the close").toBe(false);

    await signIn(page, USERS.admin);
    await openReview(page, sale!.sale_id);
    await expect(page.getByText(/Sales saved the number the call centre heard/)).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "Close and ring again" }).click();

    await expect
      .poll(async () => {
        const e = await newestEpisode(sale!.sale_id);
        return `${e?.state}:${e?.review_outcome}:${e?.attempts_at_close}`;
      }, { timeout: 30_000, message: "the episode should close as recall with the attempts snapshotted" })
      .toBe(`resolved:recall:${limit}`);
    expect(await heardNumber(sale!.sale_id), "the call centre's note of the same number clears").toBeNull();
    expect(await inPool(sale!.sale_id), "a fresh allowance of calls").toBe(true);
    await expect(page.getByText("Closed", { exact: true })).toBeVisible({ timeout: 20_000 });
  } finally {
    await restore();
  }
});

test("closing with nothing to ring keeps it out of the pool", async ({ page }) => {
  const sale = await liveSale();
  test.skip(!sale, "no live sale with a phone on the branch");
  const { restore } = await seedFixed(sale!, null);
  try {
    await signIn(page, USERS.admin);
    await openReview(page, sale!.sale_id);
    await page.getByRole("button", { name: "Close, nothing to ring" }).click();
    await expect
      .poll(async () => (await newestEpisode(sale!.sale_id))?.review_outcome ?? null, { timeout: 30_000 })
      .toBe("no_recall");
    expect(await inPool(sale!.sale_id)).toBe(false);
  } finally {
    await restore();
  }
});

test("two different numbers are put to the reviewer, and using what Sales saved clears the other", async ({ page }) => {
  const sale = await liveSale();
  test.skip(!sale, "no live sale with a phone on the branch");
  const { restore } = await seedFixed(sale!, "0800 000 0000");
  try {
    await signIn(page, USERS.admin);
    await openReview(page, sale!.sale_id);
    await expect(page.getByText(/Call centre heard/)).toBeVisible({ timeout: 20_000 });

    // No choice, no close.
    await page.getByRole("button", { name: "Close and ring again" }).click();
    await expect(page.getByText(/Say which number stands/)).toBeVisible();
    expect((await newestEpisode(sale!.sale_id))?.state).toBe("fixed");

    await page.getByRole("radio", { name: /Use what Sales saved/ }).check();
    await page.getByRole("button", { name: "Close and ring again" }).click();
    await expect
      .poll(async () => (await newestEpisode(sale!.sale_id))?.state ?? null, { timeout: 30_000 })
      .toBe("resolved");
    expect(await heardNumber(sale!.sale_id)).toBeNull();
  } finally {
    await restore();
  }
});

test("sending it back again opens the next episode and closes this one as reopened", async ({ page }) => {
  const sale = await liveSale();
  test.skip(!sale, "no live sale with a phone on the branch");
  const { restore } = await seedFixed(sale!, null);
  try {
    await signIn(page, USERS.admin);
    await openReview(page, sale!.sale_id);
    await page.getByLabel("Note for the timeline").fill("e2e: still the wrong household");
    await page.getByRole("button", { name: "Send back to Sales again" }).click();
    await expect
      .poll(async () => {
        const e = await newestEpisode(sale!.sale_id);
        return `${e?.seq}:${e?.state}`;
      }, { timeout: 30_000 })
      .toBe("2:open");
    const [first] = await branchSql<{ review_outcome: string | null }>(
      `select review_outcome from data_center.corrections where sale_id = '${sale!.sale_id}' and seq = 1`,
    );
    expect(first?.review_outcome).toBe("reopened");
    await expect(page.getByText("Waiting on Sales", { exact: true }).first()).toBeVisible({ timeout: 20_000 });
  } finally {
    await restore();
  }
});

test("the queue's Awaiting review preset lists what Sales has fixed", async ({ page }) => {
  const sale = await liveSale();
  test.skip(!sale, "no live sale with a phone on the branch");
  const { restore } = await seedFixed(sale!, null);
  try {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/call-centre?preset=review");
    const chip = page.getByRole("button", { name: "Awaiting review" });
    await expect(chip).toBeVisible({ timeout: 30_000 });
    await expect(chip).toHaveAttribute("aria-pressed", "true");
    if (sale!.stove_serial_no) {
      await expect(page.getByText(sale!.stove_serial_no, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    }
  } finally {
    await restore();
  }
});
