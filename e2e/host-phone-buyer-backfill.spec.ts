import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { signIn, USERS, branchSql, callEdgeFunction } from "./helpers";
import { nameKey, phoneTail } from "../supabase/functions/_shared/buyerKey";

/**
 * The kind backfill, Phase 5 of docs/plans/phone-and-buyer-rule.md.
 *
 * supabase/scripts/phone-buyer-kind-backfill.sql marks the register rows that
 * hold the same customer twice, on numbers registered before create-sale
 * marked repeats itself. It is run by hand on production, once, so what this
 * proves is that the file does what its header says:
 *
 *  1. Its mark block is the dry run's, character for character.
 *  2. The block's name key and phone tail agree with buyerKey.ts on every row
 *     of buyer-key-vectors.json (the same check every implementation passes).
 *  3. On real rows: a repeat is marked; a family is not; a call that corrected
 *     one name apart splits a pair; a call that corrected a name together joins
 *     one; an archived twin leaves its live match alone; a confirmed number is
 *     marked without being confirmed again or touched in time; titles and
 *     brackets reduce as the key says; a call that moved both sales to one
 *     other number keeps them together, one that moved only one (the other's
 *     correction too short to be a number) parts them; a correction of only
 *     whitespace is no correction. The result row counts what it did.
 *  4. Run twice, it changes nothing the second time.
 *  5. The undo puts back exactly what was there.
 * (Red before the scripts existed: there was nothing to run.)
 */

const TAG = "E2EPBK";
const TWIN_A = "a0000000-0000-4000-8000-00000000000a";
const run = String(Date.now() % 1e6).padStart(6, "0");
const num = (slot: number) => `0806${run}${slot}`;
const tail = (phone: string) => phone.slice(1);
const spent = new Set<string>();
const file = (p: string) =>
  readFileSync(fileURLToPath(new URL(`../supabase/scripts/${p}`, import.meta.url)), "utf8").replace(
    /\r\n/g,
    "\n",
  );
/** The text between the marker lines, which stand alone on their lines. */
const markBlock = (sql: string) =>
  sql.slice(sql.indexOf("\n-- >>> mark\n"), sql.indexOf("\n-- <<< mark\n") + 1);

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
/** A digitised sale: the import's door, which lets one customer repeat. */
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

type Row = { sale_id: string; kind: string; confirmed: boolean; updated_at: string };
const mine = `select id from public.sales where transaction_id like '${TAG}-${run}-%'`;
async function rows(): Promise<Record<string, Row>> {
  const r = await branchSql<Row>(
    `select sale_id::text, kind, confirmed, updated_at::text from data_center.shared_phones
      where sale_id in (${mine})`,
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
  await branchSql(`drop table if exists data_center.shared_phones_kind_backfill`).catch(() => {});
});

test.describe.serial("the kind backfill", () => {
  test.beforeEach(() => test.setTimeout(240_000));

  test("the backfill marks with the dry run's block", () => {
    const dry = markBlock(file("phone-buyer-kind-backfill-dryrun.sql"));
    expect(dry.length).toBeGreaterThan(500);
    expect(markBlock(file("phone-buyer-kind-backfill.sql"))).toBe(dry);
  });

  test("the block's key agrees with buyerKey.ts on every vector", async () => {
    const vectors = JSON.parse(
      readFileSync(
        fileURLToPath(
          new URL("../supabase/functions/_shared/buyer-key-vectors.json", import.meta.url),
        ),
        "utf8",
      ),
    ) as {
      cases: {
        firstName: string | null;
        surname: string | null;
        joinedName: string | null;
        phone: string;
      }[];
    };
    /*
     * Whitespace the shared vectors do not carry. JavaScript's \s (and Dart's)
     * counts these as spaces, so "Aisha<no-break space>Bello" is two words; a
     * SQL class that missed one would read it as one word, "aishabello".
     */
    const cases = [
      ...vectors.cases,
      { firstName: "Aisha\u00a0Bello", surname: null, joinedName: null, phone: "08031234567" },
      {
        firstName: "Aisha\tMusa",
        surname: "\u3000Bello\ufeff",
        joinedName: null,
        phone: "08031234567",
      },
      { firstName: "\u2028", surname: null, joinedName: "Musa\u2002Bello", phone: "08031234567" },
      {
        firstName: "Bello\u2009/\u205fAisha",
        surname: null,
        joinedName: null,
        phone: "08031234567",
      },
    ];
    const lit = (v: string | null) => (v === null ? "null" : `'${v.replace(/'/g, "''")}'`);
    const values = cases
      .map(
        (c, i) =>
          `(${i}, ${lit(c.firstName)}, ${lit(c.surname)}, ${lit(c.joinedName)}, ${lit(c.phone)})`,
      )
      .join(",\n");
    // The block reads live sales; here its `live` reads the vectors instead.
    const block = markBlock(file("phone-buyer-kind-backfill-dryrun.sql"));
    const start = block.indexOf("live as (");
    const end = block.indexOf("),\nraw as (");
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const probe =
      "with\n" +
      block.slice(0, start) +
      `live as (
  select ('00000000-0000-4000-8000-' || lpad(v.i::text, 12, '0'))::uuid as id, v.f, v.su, v.j,
         null::text as cn,
         regexp_replace(coalesce(v.p, ''), '[^0-9]', '', 'g') as d_written, '' as d_corrected
    from (values ${values}) as v(i, f, su, j, p)` +
      block.slice(end) +
      "select right(id::text, 12)::int as id, tail, name_key from keyed order by 1";
    const got = await branchSql<{ id: number; tail: string | null; name_key: string | null }>(
      probe,
    );
    expect(got).toHaveLength(cases.length);
    for (const g of got) {
      const c = cases[g.id];
      expect({ i: g.id, tail: g.tail ?? "", name: g.name_key ?? "" }).toEqual({
        i: g.id,
        tail: phoneTail(c.phone),
        name: nameKey(c.firstName, c.surname, c.joinedName),
      });
    }
  });

  const ids: Record<string, string> = {};
  test("on real rows it marks repeats, and only repeats, by the call's facts", async ({ page }) => {
    await signIn(page, USERS.admin);
    ids.rep1 = await sell(page, "Musa", "Bello", num(1));
    ids.rep2 = await sell(page, "BELLO,", "musa", num(1));
    ids.fam1 = await sell(page, "Musa", "Bello", num(2));
    ids.fam2 = await sell(page, "Hauwa", "Bello", num(2));
    ids.split1 = await sell(page, "Ali", "Garba", num(3));
    ids.split2 = await sell(page, "Ali", "Garba", num(3));
    ids.join1 = await sell(page, "Ali", "Garba", num(4));
    ids.join2 = await sell(page, "Aly", "Garba", num(4));
    ids.arch1 = await sell(page, "Sani", "Umar", num(5));
    ids.arch2 = await sell(page, "Sani", "Umar", num(5));
    ids.conf1 = await sell(page, "Bala", "Tanko", num(6));
    ids.conf2 = await sell(page, "Bala", "Tanko", num(6));
    ids.title1 = await sell(page, "Alhaji Musa (Baba)", "Danjuma", num(7));
    ids.title2 = await sell(page, "musa", "danjuma", num(7));
    ids.moved1 = await sell(page, "Yusuf", "Abba", num(8));
    ids.moved2 = await sell(page, "Yusuf", "Abba", num(8));
    ids.parted1 = await sell(page, "Idris", "Lawan", num(9));
    ids.parted2 = await sell(page, "Idris", "Lawan", num(9));

    // Wait for create-sale's register writes (after the reply), then put every
    // row back to how numbers registered before Phase 4 look: no kind named.
    for (let i = 0; i < 40; i++) {
      if (Object.keys(await rows()).length >= 18) break;
      await page.waitForTimeout(500);
    }
    expect(Object.keys(await rows())).toHaveLength(18);
    await branchSql(
      `update data_center.shared_phones set kind = 'shared_number' where sale_id in (${mine})`,
    );
    // The calls: one split, one joined. A trailing space is no correction.
    await branchSql(`insert into data_center.call_records (sale_id, corrected_end_user_name)
      values ('${ids.split2}', 'Zainab Garba'), ('${ids.join2}', 'ALI garba'), ('${ids.join1}', '   ')
      on conflict (sale_id) do update set corrected_end_user_name = excluded.corrected_end_user_name`);
    // A tab and a no-break space: still no correction, so the repeat holds.
    await branchSql(`insert into data_center.call_records (sale_id, corrected_end_user_name)
      values ('${ids.rep1}', chr(9) || chr(160))`);
    // The phones: both moved to one other number (written two ways) stay
    // together; one moved, the other's correction too short, parts them.
    await branchSql(`insert into data_center.call_records (sale_id, corrected_phone)
      values ('${ids.moved1}', '0803 555 0101'), ('${ids.moved2}', '+2348035550101'),
             ('${ids.parted1}', '08035550199'), ('${ids.parted2}', '12345')`);
    await branchSql(`update public.sales set is_archived = true where id = '${ids.arch2}'`);
    await branchSql(`update data_center.shared_phones
                        set confirmed = true, updated_at = '2026-10-01T10:00:00Z'
                      where sale_id in ('${ids.conf1}', '${ids.conf2}')`);
    await branchSql(`drop table if exists data_center.shared_phones_kind_backfill`);

    const [dry] = await branchSql<{ rows_to_mark: number }>(
      file("phone-buyer-kind-backfill-dryrun.sql"),
    );
    const [res] = await branchSql<{
      rows_matched: number;
      rows_marked: number;
      rows_snapshotted: number;
    }>(file("phone-buyer-kind-backfill.sql"));
    expect(res.rows_matched).toBe(dry.rows_to_mark);
    expect(res.rows_snapshotted).toBe(res.rows_marked);

    const r = await rows();
    const kind = (k: string) => r[ids[k]].kind;
    expect(Object.fromEntries(Object.keys(ids).map((k) => [k, kind(k)]))).toEqual({
      rep1: "same_buyer",
      rep2: "same_buyer",
      fam1: "shared_number",
      fam2: "shared_number",
      split1: "shared_number",
      split2: "shared_number",
      join1: "same_buyer",
      join2: "same_buyer",
      arch1: "shared_number",
      arch2: "shared_number",
      conf1: "same_buyer",
      conf2: "same_buyer",
      title1: "same_buyer",
      title2: "same_buyer",
      moved1: "same_buyer",
      moved2: "same_buyer",
      parted1: "shared_number",
      parted2: "shared_number",
    });
    // A label, not a call: still confirmed, and its time untouched.
    expect(r[ids.conf1]).toMatchObject({ confirmed: true });
    expect(new Date(r[ids.conf1].updated_at).toISOString()).toBe("2026-10-01T10:00:00.000Z");
    // Every one of this spec's marks was snapshotted with what it had before.
    const [snap] = await branchSql<{ n: number; before: string[] }>(
      `select count(*)::int as n, array_agg(distinct b.kind_before) as before
         from data_center.shared_phones_kind_backfill b
         join data_center.shared_phones sp on sp.id = b.id
        where sp.sale_id in (${mine})`,
    );
    expect(snap).toEqual({ n: 10, before: ["shared_number"] });
  });

  test("run twice, it changes nothing the second time", async () => {
    const before = await rows();
    const [res] = await branchSql<{ rows_marked: number; rows_snapshotted: number }>(
      file("phone-buyer-kind-backfill.sql"),
    );
    expect(res).toMatchObject({ rows_marked: 0, rows_snapshotted: 0 });
    expect(await rows()).toEqual(before);
  });

  test("the undo puts back exactly what was there", async () => {
    const [res] = await branchSql<{ rows_restored: number }>(
      file("phone-buyer-kind-backfill-undo.sql"),
    );
    expect(res.rows_restored).toBeGreaterThanOrEqual(10);
    const r = await rows();
    for (const k of Object.keys(ids)) expect(r[ids[k]].kind, k).toBe("shared_number");
    expect(r[ids.conf1]).toMatchObject({ confirmed: true });
    const [again] = await branchSql<{ rows_restored: number }>(
      file("phone-buyer-kind-backfill-undo.sql"),
    );
    expect(again.rows_restored).toBe(0);
  });
});
