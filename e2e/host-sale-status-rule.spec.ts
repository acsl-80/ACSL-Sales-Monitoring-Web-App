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
 */

test.describe.configure({ timeout: 240_000 });

const ORG = "a0000000-0000-4000-8000-000000000001";
const AGENT = "b0000000-0000-4000-8000-000000000005";
const TAG = "E2ESTAT";
const SIGNATURE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

async function addressId(): Promise<string> {
  const [row] = await branchSql<{ id: string }>(
    `select id::text from public.addresses where nullif(trim(coalesce(full_address, '')), '') is not null order by id limit 1`,
  );
  if (row?.id) return row.id;
  const [made] = await branchSql<{ id: string }>(
    `insert into public.addresses (full_address, state) values ('${TAG} 1 Test Road', 'Kogi') returning id::text`,
  );
  return made.id;
}

type Shape = { signature?: string | null; lga?: string | null };

/** One sale, written through the table so the triggers decide its status. */
async function writeSale(n: number, shape: Shape): Promise<string> {
  const addr = await addressId();
  const sig = shape.signature === undefined ? SIGNATURE : shape.signature;
  const lga = shape.lga === undefined ? "Lokoja" : shape.lga;
  const [row] = await branchSql<{ status: string }>(
    `insert into public.sales (
       transaction_id, stove_serial_no, sales_date, end_user_name, phone,
       contact_person, contact_phone, partner_name, retailer_branch, state_backup,
       lga_backup, amount, total_paid, is_installment, payment_status,
       organization_id, created_by, platform, address_id, signature)
     values ('${TAG}-${n}', '${TAG}-S${n}', current_date, 'E2E Status Buyer ${n}', '0801000010${n}',
             'E2E Status Contact', '0801000020${n}', 'E2E Partner', 'Main', 'Kogi',
             ${lga === null ? "null" : `'${lga}'`}, 43000, 43000, false, 'fully_paid',
             '${ORG}', '${AGENT}', 'web', '${addr}', ${sig === null ? "null" : `'${sig}'`})
     returning status`,
  );
  return row.status;
}

test.beforeAll(async () => {
  await branchSql(`delete from public.sales where transaction_id like '${TAG}-%'`);
});

test.afterAll(async () => {
  await branchSql(`delete from public.sales where transaction_id like '${TAG}-%'`).catch(() => {});
});

test("every required field and a valid signature reads completed the moment it is written", async () => {
  expect(await writeSale(1, {})).toBe("completed");
});

test("every required field and no signature reads pending, not incomplete", async () => {
  expect(await writeSale(2, { signature: null })).toBe("pending");
});

test("a missing LGA reads incomplete, signature or not", async () => {
  expect(await writeSale(3, { lga: null })).toBe("incomplete");
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
  // The pending sale written above is complete by the module's rule and must
  // not count, or this assertion could pass with the old definition by luck.
  expect(Number(pendingComplete.n)).toBeGreaterThan(0);
  expect(reported).toBe(Number(oracle.n));
});
