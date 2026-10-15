import { test, expect } from "@playwright/test";
import { signIn, USERS, branchSql, callEdgeFunction } from "./helpers";

/**
 * The sales app's status rule matches its own form (decision D1).
 *
 * A sale with every required field and a valid signature reads completed the
 * moment it is written; the same sale without a signature reads pending; the
 * same sale without an LGA reads incomplete. The two images play no part. One
 * trigger computes it, and the Data Center's disagreement metric counts only
 * sales the app calls incomplete that the module calls complete.
 *
 * Red on main: the row function still demands the two images, so the first
 * sale reads incomplete; three triggers sit on the table; the metric counts
 * pending sales as disagreements.
 *
 * Since 11 September 2026 the required fields are dated (D34, D61): a rule in
 * public.sale_field_rules binds a sale only from its mandatory_from day on.
 * The four D1 fixtures are dated before that go-live so they test the status
 * rule and nothing else; two more, dated today, hold the dated rules: the same
 * sale reads incomplete without the dated fields and completed with them.
 */

test.describe.configure({ timeout: 240_000 });

const ORG = "a0000000-0000-4000-8000-000000000001";
const AGENT = "b0000000-0000-4000-8000-000000000005";
const TAG = "E2ESTAT";
const SIGNATURE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
/** The day before the first dated rule went live (2026-09-11). */
const BEFORE_DATED_RULES = "2026-09-10";

/** The spec's own address, with the city the dated rules ask for. */
async function addressId(): Promise<string> {
  const [made] = await branchSql<{ id: string }>(
    `insert into public.addresses (full_address, state, city) values ('${TAG} 1 Test Road', 'Kogi', 'Lokoja') returning id::text`,
  );
  return made.id;
}

/**
 * Every sale-table field a dated rule names, answered, up to the ones dated
 * 2027-01-05. The address's city is the other one, and the spec's address
 * carries it. A rule added later needs its field here.
 */
const DATED_FIELDS: Record<string, string> = {
  end_user_first_name: "'E2E'",
  end_user_surname: "'Status Buyer'",
  previous_stove_type: "'Three-stone fire'",
  selling_agent_name: "'E2E Status Agent'",
  terms_accepted: `'{"poaGoverned": true, "monitoring": true, "noResell": true, "emissionReductions": true, "noExport": true, "demonstration": true}'::jsonb`,
  cooking_fuel_source: "'Firewood'",
  heat_retention_device: "false",
  pot_quantity: "2",
};

type Shape = { signature?: string | null; lga?: string | null; today?: boolean; datedFields?: boolean };

/** One sale, written through the table so the triggers decide its status. */
async function writeSale(n: number, shape: Shape): Promise<string> {
  const addr = await addressId();
  const sig = shape.signature === undefined ? SIGNATURE : shape.signature;
  const lga = shape.lga === undefined ? "Lokoja" : shape.lga;
  const day = shape.today ? "current_date" : `'${BEFORE_DATED_RULES}'::date`;
  const dated = shape.datedFields ? Object.entries(DATED_FIELDS) : [];
  const [row] = await branchSql<{ status: string }>(
    `insert into public.sales (
       transaction_id, stove_serial_no, sales_date, end_user_name, phone,
       contact_person, contact_phone, partner_name, retailer_branch, state_backup,
       lga_backup, amount, total_paid, is_installment, payment_status,
       organization_id, created_by, platform, address_id, signature${dated.map(([c]) => `, ${c}`).join("")})
     values ('${TAG}-${n}', '${TAG}-S${n}', ${day}, 'E2E Status Buyer ${n}', '0801000010${n}',
             'E2E Status Contact', '0801000020${n}', 'E2E Partner', 'Main', 'Kogi',
             ${lga === null ? "null" : `'${lga}'`}, 43000, 43000, false, 'fully_paid',
             '${ORG}', '${AGENT}', 'web', '${addr}', ${sig === null ? "null" : `'${sig}'`}${dated.map(([, v]) => `, ${v}`).join("")})
     returning status`,
  );
  return row.status;
}

/**
 * The fixtures are written once, before every test, so a retried test
 * (CI runs with one retry, in a fresh worker) still finds them, and so the
 * metric test below does not depend on which test ran before it.
 */
const status: Record<number, string> = {};

test.beforeAll(async () => {
  await branchSql(`delete from public.sales where transaction_id like '${TAG}-%'`);
  await branchSql(`delete from public.addresses where full_address like '${TAG} %'`);
  status[1] = await writeSale(1, {});
  status[2] = await writeSale(2, { signature: null });
  status[3] = await writeSale(3, { lga: null });
  // A scrawl too short to be a valid signature: the app calls this pending,
  // the module (which asks only that the column be present) calls it complete.
  status[4] = await writeSale(4, { signature: "scrawl" });
  // Sale 1 again, dated today: once without the dated fields, once with them.
  status[5] = await writeSale(5, { today: true });
  status[6] = await writeSale(6, { today: true, datedFields: true });
});

test.afterAll(async () => {
  await branchSql(`delete from public.sales where transaction_id like '${TAG}-%'`).catch(() => {});
  await branchSql(`delete from public.addresses where full_address like '${TAG} %'`).catch(() => {});
});

test("every required field and a valid signature reads completed the moment it is written", async () => {
  expect(status[1]).toBe("completed");
});

test("every required field and no signature reads pending, not incomplete", async () => {
  expect(status[2]).toBe("pending");
});

test("a missing LGA reads incomplete, signature or not", async () => {
  expect(status[3]).toBe("incomplete");
});

test("a signature too short to count reads pending", async () => {
  expect(status[4]).toBe("pending");
});

test("a sale dated after the go-live without the dated fields reads incomplete", async () => {
  expect(status[5]).toBe("incomplete");
});

test("a sale dated after the go-live with every dated field reads completed", async () => {
  expect(status[6]).toBe("completed");
});

test("one trigger computes the status, and the zero-argument function is gone", async () => {
  const triggers = await branchSql<{ tgname: string; def: string }>(
    `select tgname, pg_get_triggerdef(t.oid) as def from pg_trigger t
      where tgrelid = 'public.sales'::regclass and not tgisinternal
        and pg_get_triggerdef(t.oid) ilike '%status%'`,
  );
  expect(triggers.map((t) => t.tgname).sort()).toEqual(["trigger_update_sale_status"]);
  const [fn] = await branchSql<{ n: number }>(
    `select count(*)::int as n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
      where ns.nspname = 'public' and p.proname = 'calculate_sale_status' and p.pronargs = 0`,
  );
  expect(Number(fn.n)).toBe(0);
});

test("the module's disagreement metric counts only sales the app calls incomplete", async ({ page }) => {
  await signIn(page, USERS.admin);
  const run = await callEdgeFunction(page, "data-center-compute", { action: "run" });
  expect(run.status, JSON.stringify(run.body)).toBe(200);
  const read = await callEdgeFunction(page, "data-center-read", { action: "dashboard" });
  expect(read.status).toBe(200);
  const metrics = (read.body as { data: { metrics: { metric_key: string; value_num: string | number }[] } }).data.metrics;
  const reported = metrics
    .filter((m) => m.metric_key === "sales.status_disagreement")
    .reduce((n, m) => n + Number(m.value_num ?? 0), 0);

  const [pred] = await branchSql<{ sql: string }>(`select data_center.completeness_predicate('s') as sql`);
  const [oracle] = await branchSql<{ n: number }>(
    `select count(*)::int as n from public.sales s
      where s.is_archived is not true and s.status = 'incomplete' and (${pred.sql})`,
  );
  const [pendingComplete] = await branchSql<{ n: number }>(
    `select count(*)::int as n from public.sales s
      where s.is_archived is not true and s.status = 'pending' and (${pred.sql})`,
  );
  // Sale 4 above is pending to the app and complete to the module, and must
  // not count, or this assertion could pass with the old definition by luck.
  expect(Number(pendingComplete.n)).toBeGreaterThan(0);
  expect(reported).toBe(Number(oracle.n));
});
