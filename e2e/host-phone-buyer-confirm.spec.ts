import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { signIn, USERS, branchSql, callEdgeFunction } from "./helpers";

/**
 * Decision 2 of docs/plans/phone-and-buyer-rule.md (settled 2026-10-15).
 *
 * supabase/scripts/phone-buyer-confirm-verified.sql confirms on the register
 * the open rows of sales a call already fully verified, where the names on the
 * number differ; the same customer twice stays open for a call about the
 * second stove. Run by hand on production once, after the release. This proves:
 *
 *  1. Its block is the dry run's, and starts with the kind backfill's mark block.
 *  2. On real rows it confirms exactly the sales that pass every other gate of
 *     the creditable count: not an unverified sibling, not a repeat (labelled
 *     or only found by the mark block), not a sale labelled same_buyer, not
 *     another Save80 in the household, not an open correction, not partly
 *     verified, not incomplete, not an unconfirmed stove ID, and not a row
 *     already confirmed. It writes its note, keeps source and kind, and counts
 *     what it did.
 *  3. Run twice, it changes nothing the second time.
 *  4. The undo puts back what it changed and leaves a row the call centre
 *     confirmed since alone.
 */

const TAG = "E2EPBC";
const TWIN_A = "a0000000-0000-4000-8000-00000000000a";
const NOTE = "Confirmed from a full verification call (decision 2, 2026-10-15)";
const run = String(Date.now() % 1e6).padStart(6, "0");
const num = (slot: number) => `0807${run}${slot}`;
const spent = new Set<string>();
const file = (p: string) =>
  readFileSync(fileURLToPath(new URL(`../supabase/scripts/${p}`, import.meta.url)), "utf8").replace(
    /\r\n/g,
    "\n",
  );
/** The text between marker lines, which stand alone on their lines. */
const between = (sql: string, name: string) =>
  sql.slice(sql.indexOf(`\n-- >>> ${name}\n`), sql.indexOf(`\n-- <<< ${name}\n`) + 1);

async function freeStove(): Promise<string> {
  const rows = await branchSql<{ stove_id: string }>(
    `select stove_id from public.stove_ids_base
      where organization_id = '${TWIN_A}' and status = 'available' and sale_id is null
        and is_archived is not true
      order by stove_id desc limit 60`,
  );
  const free = rows.map((r) => r.stove_id).find((s) => !spent.has(s));
  expect(free, "a free stove").toBeTruthy();
  spent.add(free!);
  return free!;
}

let seq = 0;
async function sell(page: Page, first: string, surname: string, phone: string): Promise<string> {
  seq += 1;
  const [o] = await branchSql<{ name: string }>(
    `select partner_name as name from public.organizations where id = '${TWIN_A}'`,
  );
  const r = await callEdgeFunction(page, "create-sale", {
    transactionId: `${TAG}-${run}-${seq}`,
    stoveSerialNo: await freeStove(),
    organizationId: TWIN_A,
    partnerName: o.name,
    salesDate: "2026-09-01",
    amount: 25000,
    endUserFirstName: first,
    endUserSurname: surname,
    endUserName: `${first} ${surname}`,
    phone,
    contactPerson: "Spec Contact",
    contactPhone: phone,
    allowSharedPhone: true,
    termsAccepted: {
      poaGoverned: true,
      monitoring: true,
      noResell: true,
      emissionReductions: true,
      noExport: true,
      demonstration: true,
    },
    addressData: { fullAddress: `${TAG} Road`, state: "Kogi", city: "Lokoja" },
  });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return (r.body as { data: { id: string } }).data.id;
}

type Row = {
  sale_id: string;
  confirmed: boolean;
  note: string | null;
  source: string;
  kind: string;
  updated_at: string;
  updated_by: string | null;
};
const mine = `select id from public.sales where transaction_id like '${TAG}-${run}-%'`;
async function rows(): Promise<Record<string, Row>> {
  const r = await branchSql<Row>(
    `select sale_id::text, confirmed, note, source, kind, updated_at::text, updated_by::text
       from data_center.shared_phones where sale_id in (${mine})`,
  );
  return Object.fromEntries(r.map((x) => [x.sale_id, x]));
}

test.afterAll(async () => {
  const all = `select id from public.sales where transaction_id like '${TAG}-%'`;
  await branchSql(`delete from data_center.call_records where sale_id in (${all})`).catch(() => {});
  await branchSql(`delete from data_center.shared_phones where sale_id in (${all})`).catch(
    () => {},
  );
  await branchSql(
    `update public.stove_ids_base set status = 'available', sale_id = null where sale_id in (${all})`,
  ).catch(() => {});
  await branchSql(`delete from public.installment_payments where sale_id in (${all})`).catch(
    () => {},
  );
  await branchSql(`delete from public.sales where transaction_id like '${TAG}-%'`).catch(() => {});
  await branchSql(`delete from public.addresses where full_address like '${TAG}%'`).catch(() => {});
  await branchSql(`drop table if exists data_center.shared_phones_confirm_backfill`).catch(
    () => {},
  );
});

test.describe.serial("confirming verified family sales", () => {
  test.beforeEach(() => test.setTimeout(240_000));

  test("the script confirms with the dry run's block, built on the mark block", () => {
    const dry = between(file("phone-buyer-confirm-verified-dryrun.sql"), "confirm");
    expect(dry.length).toBeGreaterThan(1000);
    expect(between(file("phone-buyer-confirm-verified.sql"), "confirm")).toBe(dry);
    const mark = between(file("phone-buyer-kind-backfill-dryrun.sql"), "mark");
    expect(mark.length).toBeGreaterThan(500);
    expect(dry).toContain(mark);
  });

  const ids: Record<string, string> = {};
  /** The register as it was just before the confirm script first ran. */
  let original: Record<string, Row> = {};
  test("it confirms exactly the verified sales held only by the register", async ({ page }) => {
    await signIn(page, USERS.admin);
    // Family, one verified: the verified one is confirmed, its sibling stays open.
    ids.famOk = await sell(page, "Musa", "Bello", num(1));
    ids.famUncalled = await sell(page, "Hauwa", "Bello", num(1));
    // The same customer twice, both verified, no label: the mark block keeps it open.
    ids.rep1 = await sell(page, "Bala", "Tanko", num(2));
    ids.rep2 = await sell(page, "bala", "TANKO", num(2));
    // Different names, one labelled same_buyer: the label keeps that one open.
    ids.labelled = await sell(page, "Sani", "Umar", num(3));
    ids.labelOk = await sell(page, "Amina", "Umar", num(3));
    // Household question: another Save80 there keeps it open.
    ids.hhOk = await sell(page, "Ali", "Garba", num(4));
    ids.hhOthers = await sell(page, "Zainab", "Garba", num(4));
    // Open correction; partly verified.
    ids.corr = await sell(page, "Yusuf", "Abba", num(5));
    ids.partly = await sell(page, "Maryam", "Abba", num(5));
    // Incomplete (no signature); stove ID unconfirmed.
    ids.incomplete = await sell(page, "Idris", "Lawan", num(6));
    ids.serial = await sell(page, "Fatima", "Lawan", num(6));
    // A row the call centre already confirmed is not rewritten.
    ids.done = await sell(page, "Chika", "Eze", num(7));
    ids.doneSibling = await sell(page, "Ngozi", "Eze", num(7));

    for (let i = 0; i < 40; i++) {
      if (Object.keys(await rows()).length >= 14) break;
      await page.waitForTimeout(500);
    }
    expect(Object.keys(await rows())).toHaveLength(14);

    // As numbers looked before Phase 4: no label. Then the one label this case needs.
    await branchSql(
      `update data_center.shared_phones set kind = 'shared_number' where sale_id in (${mine})`,
    );
    await branchSql(
      `update data_center.shared_phones set kind = 'same_buyer' where sale_id = '${ids.labelled}'`,
    );
    // Complete: a signature on every sale but the incomplete one (dated before
    // 11 Sep, so the later rules do not apply).
    await branchSql(`update public.sales set signature = 'spec-signature'
                      where id in (${mine}) and id <> '${ids.incomplete}'`);
    const verified = Object.entries(ids)
      .filter(([k]) => !["famUncalled", "partly"].includes(k))
      .map(([, id]) => `('${id}', 'fully_verified', 1, '{"double_counting":"only_stove"}'::jsonb)`)
      .join(", ");
    await branchSql(`insert into data_center.call_records (sale_id, verification_outcome, attempt_count, answers)
      values ${verified}, ('${ids.partly}', 'partially_verified', 1, '{}'::jsonb)
      on conflict (sale_id) do update set verification_outcome = excluded.verification_outcome,
        attempt_count = excluded.attempt_count, answers = excluded.answers`);
    await branchSql(`update data_center.call_records
                        set answers = '{"double_counting":"has_others"}'::jsonb
                      where sale_id = '${ids.hhOthers}'`);
    await branchSql(`update data_center.call_records set correction_requested_at = now()
                      where sale_id = '${ids.corr}'`);
    await branchSql(`update data_center.call_records set serial_unconfirmed_at = now()
                      where sale_id = '${ids.serial}'`);
    await branchSql(`update data_center.shared_phones
                        set confirmed = true, source = 'call_centre', note = 'agent note',
                            updated_at = '2026-10-01T10:00:00Z'
                      where sale_id = '${ids.done}'`);
    await branchSql(`drop table if exists data_center.shared_phones_confirm_backfill`);

    const before = await rows();
    original = before;
    const [dry] = await branchSql<{ rows_to_confirm: number }>(
      file("phone-buyer-confirm-verified-dryrun.sql"),
    );
    const [res] = await branchSql<{
      rows_matched: number;
      rows_confirmed: number;
      rows_snapshotted: number;
    }>(file("phone-buyer-confirm-verified.sql"));
    expect(res.rows_matched).toBe(dry.rows_to_confirm);
    expect(res.rows_snapshotted).toBe(res.rows_confirmed);

    const r = await rows();
    const confirmedNow = Object.keys(ids)
      .filter((k) => r[ids[k]].confirmed && !before[ids[k]].confirmed)
      .sort();
    expect(confirmedNow).toEqual(["doneSibling", "famOk", "hhOk", "labelOk"]);
    for (const k of confirmedNow) {
      expect(r[ids[k]], k).toMatchObject({
        note: NOTE,
        source: "digitalisation",
        kind: "shared_number",
      });
    }
    // Already confirmed: untouched.
    expect(r[ids.done]).toEqual(before[ids.done]);
    // The repeat stays open, labelled or not.
    expect(r[ids.rep1].confirmed).toBe(false);
    expect(r[ids.labelled]).toMatchObject({ confirmed: false, kind: "same_buyer" });

    const [snap] = await branchSql<{ n: number }>(
      `select count(*)::int as n from data_center.shared_phones_confirm_backfill b
         join data_center.shared_phones sp on sp.id = b.id where sp.sale_id in (${mine})`,
    );
    expect(snap.n).toBe(4);
  });

  test("run twice, it changes nothing the second time", async () => {
    const before = await rows();
    const [res] = await branchSql<{ rows_confirmed: number; rows_snapshotted: number }>(
      file("phone-buyer-confirm-verified.sql"),
    );
    expect(res).toMatchObject({ rows_confirmed: 0, rows_snapshotted: 0 });
    expect(await rows()).toEqual(before);
  });

  test("the undo puts back what it changed, and leaves a later call's confirm alone", async () => {
    // A call confirms one of them after the script ran.
    await branchSql(`update data_center.shared_phones
                        set source = 'call_centre', note = 'agent confirmed'
                      where sale_id = '${ids.hhOk}'`);
    const [res] = await branchSql<{ rows_restored: number }>(
      file("phone-buyer-confirm-verified-undo.sql"),
    );
    expect(res.rows_restored).toBeGreaterThanOrEqual(3);
    const r = await rows();
    // Back exactly as they were, time and last editor included.
    for (const k of ["famOk", "labelOk", "doneSibling"]) {
      expect(r[ids[k]], k).toEqual(original[ids[k]]);
    }
    expect(r[ids.hhOk]).toMatchObject({ confirmed: true, note: "agent confirmed" });
    expect(r[ids.done]).toMatchObject({ confirmed: true, note: "agent note" });
    const [again] = await branchSql<{ rows_restored: number }>(
      file("phone-buyer-confirm-verified-undo.sql"),
    );
    expect(again.rows_restored).toBe(0);
  });
});
