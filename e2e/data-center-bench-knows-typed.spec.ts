import { test, expect, type Page } from "@playwright/test";
import { signIn, USERS, branchSql, callEdgeFunction } from "./helpers";

/**
 * Phase 29, slice 1 (D53): the bench knows what is typed before anyone types.
 *
 *  - a receipt finished at the bench leaves Still to type and reads finished,
 *    awaiting confirmation, though no sale exists yet
 *  - a sale made through create-sale, the sales app's own door, reads typed
 *    with the channel named, and after a call it reads called
 *  - the bench list shows both pills; a typed stove opens read only with a
 *    door to its record
 *  - the save refuses a stove with a live sale, and a receipt another typist
 *    finished, before writing anything
 *  - the list re-reads on the configured interval
 */
test.describe.configure({ timeout: 240_000 });

const receipt = (marker: string) => ({
  endUserName: "Knows",
  endUserSurname: "Typed",
  phone: "08015550777",
  salesDate: "2026-01-04",
  state: "Kogi",
  lga: "Isanlu",
  address: `${marker} Street`,
  salesModel: "Amina Model",
});

type Stove = { stove_id: string; typed_state: string; typed_via: string | null; standing: string | null; attempt_count: number | null; sale_id: string | null };
type PartnerPage = { stoves: Stove[]; totals: { all: number; todo: number; awaiting: number; done: number }; refreshSeconds: number };

async function partnerStoves(page: Page, organizationId: string, recorded: string | null = null): Promise<PartnerPage> {
  const r = await callEdgeFunction(page, "data-center-read", { action: "partner_stoves", organizationId, recorded, limit: 500 });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return (r.body as { data: PartnerPage }).data;
}

/** A partner with at least two untyped stoves, and the two stoves. */
async function twoUntyped(page: Page): Promise<{ organizationId: string; a: string; b: string }> {
  const rows = await branchSql<{ organization_id: string; stove_id: string }>(`
    select sb.organization_id::text, sb.stove_id
      from public.stove_ids_base sb
      join data_center.v_stove_typed t on t.stove_id = sb.stove_id
      join data_center.v_transfer_stoves b on b.stove_id = sb.stove_id
     where t.typed_state = 'untyped' and sb.organization_id is not null
     order by sb.organization_id, sb.stove_id`);
  const byOrg = new Map<string, string[]>();
  for (const r of rows) byOrg.set(r.organization_id, [...(byOrg.get(r.organization_id) ?? []), r.stove_id]);
  const pick = [...byOrg.entries()].find(([, ids]) => ids.length >= 2);
  expect(pick, "a partner with two untyped stoves").toBeTruthy();
  return { organizationId: pick![0], a: pick![1][0], b: pick![1][1] };
}

/** Undo a bench receipt the spec made, so the stove reads untyped again. */
async function forget(stoveId: string) {
  await branchSql(`delete from data_center.import_rows r using data_center.import_batches b
    where b.id = r.batch_id and b.source = 'workbench' and r.stove_serial_no = '${stoveId}' and r.sale_id is null`);
  // A finish moved its batch to validated; with the row gone the batch is a
  // drafts-only one again, which is what the other bench specs expect to find.
  await branchSql(`update data_center.import_batches b set state = 'staged'
    where b.source = 'workbench' and b.state = 'validated'
      and not exists (select 1 from data_center.import_rows r where r.batch_id = b.id and r.status = 'valid')`);
}

test("a finished receipt leaves Still to type and reads awaiting confirmation; another typist cannot save over it", async ({ browser }) => {
  const typist = await (await browser.newContext()).newPage();
  await signIn(typist, USERS.admin);
  const other = await (await browser.newContext()).newPage();
  await signIn(other, USERS.dataManager);
  const { organizationId, a } = await twoUntyped(typist);
  const marker = `knows-${Date.now()}`;
  try {
    const finished = await callEdgeFunction(typist, "data-center-import", {
      action: "workbench_save", stoveId: a, values: receipt(marker), complete: true,
    });
    expect(finished.status, JSON.stringify(finished.body)).toBe(200);

    const [row] = await branchSql<{ typed_state: string }>(`select typed_state from data_center.v_stove_typed where stove_id = '${a}'`);
    expect(row.typed_state).toBe("finished");
    const todo = await partnerStoves(typist, organizationId, "no");
    expect(todo.stoves.map((s) => s.stove_id)).not.toContain(a);
    const awaiting = await partnerStoves(typist, organizationId, "awaiting");
    expect(awaiting.stoves.map((s) => s.stove_id)).toContain(a);
    expect(awaiting.totals.awaiting).toBeGreaterThanOrEqual(1);
    expect(awaiting.totals.all).toBe(awaiting.totals.todo + awaiting.totals.awaiting + awaiting.totals.done);
    expect(awaiting.refreshSeconds).toBeGreaterThan(0);

    // Somebody else may not save over a finished receipt.
    const refused = await callEdgeFunction(other, "data-center-import", {
      action: "workbench_save", stoveId: a, values: receipt(`${marker}-other`), complete: false,
    });
    expect(refused.status, JSON.stringify(refused.body)).toBe(409);
    expect((refused.body as { code: string }).code).toBe("finished_by_other");
    expect((refused.body as { error: string }).error).toMatch(/waiting to be confirmed/);
    const [still] = await branchSql<{ address: string | null }>(`select r.draft_values ->> 'address' as address from data_center.import_rows r join data_center.import_batches b on b.id = r.batch_id where b.source = 'workbench' and r.stove_serial_no = '${a}' limit 1`);
    expect(still.address, "nothing was written over the finished receipt").toBe(`${marker} Street`);
  } finally {
    await forget(a);
  }
});

test("a sale made through the sales app's own door reads typed, then called, and the bench refuses to retype it", async ({ browser }) => {
  const admin = await (await browser.newContext()).newPage();
  await signIn(admin, USERS.admin);
  const { organizationId, b } = await twoUntyped(admin);
  const [org] = await branchSql<{ partner_name: string }>(`select partner_name from public.organizations where id = '${organizationId}'`);
  const made = await callEdgeFunction(admin, "create-sale", {
    transactionId: `knows-${Date.now()}`,
    organizationId,
    partnerName: org.partner_name,
    stoveSerialNo: b,
    salesDate: "2026-01-05",
    endUserName: "Sales App Buyer",
    phone: "08015550778",
    amount: 50000,
    salesAgentName: null,
    allowSharedPhone: true,
    termsAccepted: { poaGoverned: true, monitoring: true, noResell: true, emissionReductions: true, noExport: true, demonstration: true },
  });
  expect(made.status, JSON.stringify(made.body)).toBe(200);
  let saleId: string | null = null;
  try {
    const [t] = await branchSql<{ typed_state: string; typed_via: string; sale_id: string }>(`select typed_state, typed_via, sale_id from data_center.v_stove_typed where stove_id = '${b}'`);
    saleId = t.sale_id;
    expect(t.typed_state).toBe("typed");
    expect(t.typed_via).toBe("sales app");
    const done = await partnerStoves(admin, organizationId, "yes");
    const row = done.stoves.find((s) => s.stove_id === b)!;
    expect(row).toBeTruthy();
    expect(row.typed_via).toBe("sales app");
    const todo = await partnerStoves(admin, organizationId, "no");
    expect(todo.stoves.map((s) => s.stove_id)).not.toContain(b);

    // The bench refuses to type it, before writing anything.
    const [rowsBefore] = await branchSql<{ n: number }>(`select count(*)::int as n from data_center.import_rows where stove_serial_no = '${b}'`);
    const refused = await callEdgeFunction(admin, "data-center-import", {
      action: "workbench_save", stoveId: b, values: receipt("retype"), complete: false,
    });
    expect(refused.status, JSON.stringify(refused.body)).toBe(409);
    expect((refused.body as { code: string }).code).toBe("already_typed");
    expect((refused.body as { error: string }).error).toMatch(/sales app/);
    const [rows] = await branchSql<{ n: number }>(`select count(*)::int as n from data_center.import_rows where stove_serial_no = '${b}'`);
    expect(rows.n, "no bench row was written for the typed stove").toBe(rowsBefore.n);

    // A call on it, and the list says called.
    const logged = await callEdgeFunction(admin, "data-center-write", { action: "log_attempt", saleId, note: "knows-typed spec" });
    expect(logged.status, JSON.stringify(logged.body)).toBe(200);
    const after = await partnerStoves(admin, organizationId, "yes");
    const called = after.stoves.find((s) => s.stove_id === b)!;
    expect(Number(called.attempt_count)).toBeGreaterThanOrEqual(1);
    expect(called.standing).toBe("in_progress");

    // Opening it on the bench: read only, with the door to its record.
    const opened = await callEdgeFunction(admin, "data-center-import", { action: "workbench_open", stoveId: b });
    const typed = (opened.body as { data: { stove: { typed: { typed_state: string; typed_via: string; standing: string } } } }).data.stove.typed;
    expect(typed.typed_state).toBe("typed");
    expect(typed.typed_via).toBe("sales app");
    expect(typed.standing).toBe("in_progress");
  } finally {
    if (saleId) {
      await branchSql(`delete from data_center.call_attempts where sale_id = '${saleId}'`);
      await branchSql(`delete from data_center.call_records where sale_id = '${saleId}'`);
      await branchSql(`update public.stove_ids_base set status = 'available', sale_id = null where stove_id = '${b}'`);
      await branchSql(`delete from public.sales where id = '${saleId}'`);
    }
  }
});

test("the bench list shows the pills, a typed stove opens read only, and the list re-reads on the interval", async ({ browser }) => {
  const admin = await (await browser.newContext()).newPage();
  await signIn(admin, USERS.admin);
  const { organizationId, a, b } = await twoUntyped(admin);
  const [org] = await branchSql<{ partner_name: string }>(`select partner_name from public.organizations where id = '${organizationId}'`);
  const [before] = await branchSql<{ v: string }>(`select value::text as v from data_center.workflow_config where key = 'bench.refresh_seconds'`);
  await branchSql(`update data_center.workflow_config set value = '4'::jsonb where key = 'bench.refresh_seconds'`);
  let saleId: string | null = null;
  try {
    // A typed stove to look at, made through the sales app's door.
    const made = await callEdgeFunction(admin, "create-sale", {
      transactionId: `knows-ui-${Date.now()}`, organizationId, partnerName: org.partner_name, stoveSerialNo: a,
      salesDate: "2026-01-05", endUserName: "Typed Already", phone: "08015550779", amount: 50000, salesAgentName: null, allowSharedPhone: true,
    termsAccepted: { poaGoverned: true, monitoring: true, noResell: true, emissionReductions: true, noExport: true, demonstration: true },
    });
    expect(made.status, JSON.stringify(made.body)).toBe(200);
    saleId = (await branchSql<{ sale_id: string }>(`select sale_id from data_center.v_stove_typed where stove_id = '${a}'`))[0].sale_id;

    await admin.goto("/data-center/import?mode=bench");
    await admin.getByRole("button", { name: /One receipt at a time/ }).click().catch(() => {});
    await admin.locator("tbody tr", { hasText: org.partner_name }).first().click();
    await expect(admin.getByText(/all consignments/)).toBeVisible({ timeout: 30_000 });
    await admin.getByRole("button", { name: /^Typed \(/ }).click();
    const typedRow = admin.locator("tbody tr", { hasText: a });
    await expect(typedRow.locator("[data-typed-state='typed']")).toBeVisible({ timeout: 30_000 });
    await expect(typedRow.locator("[data-typed-state='typed']")).toContainText(/sales app/);
    await expect(typedRow.locator("[data-call-state]")).toContainText(/Not called/);
    // Opening it: read only, with the door.
    await typedRow.click();
    await expect(admin.locator("[data-bench-typed]")).toBeVisible({ timeout: 30_000 });
    await expect(admin.locator("[data-bench-typed]")).toContainText(/Typed .* sales app/);
    await expect(admin.locator("[data-bench-typed]").getByRole("link", { name: "Open the stove record" })).toHaveAttribute("href", new RegExp(`/data-center/stove/${a}`));
    await expect(admin.locator("#wb-endUserName")).toBeDisabled();

    // Back to the list on Still to type; stove b is there and untyped.
    await admin.goto("/data-center/import?mode=bench");
    await admin.getByRole("button", { name: /One receipt at a time/ }).click().catch(() => {});
    await admin.locator("tbody tr", { hasText: org.partner_name }).first().click();
    await expect(admin.getByText(/all consignments/)).toBeVisible({ timeout: 30_000 });
    await admin.getByRole("button", { name: /^Still to type \(/ }).click();
    const rowB = admin.locator("tbody tr", { hasText: b });
    await expect(rowB.locator("[data-typed-state='untyped']")).toBeVisible({ timeout: 30_000 });
    // Somebody finishes it elsewhere; within the interval the row leaves Still to type.
    const other = await (await browser.newContext()).newPage();
    await signIn(other, USERS.dataManager);
    const finished = await callEdgeFunction(other, "data-center-import", { action: "workbench_save", stoveId: b, values: receipt("elsewhere"), complete: true });
    expect(finished.status, JSON.stringify(finished.body)).toBe(200);
    await expect(rowB).toHaveCount(0, { timeout: 20_000 });
    await admin.getByRole("button", { name: /^Awaiting confirmation \(/ }).click();
    await expect(admin.locator("tbody tr", { hasText: b }).locator("[data-typed-state='finished']")).toBeVisible({ timeout: 30_000 });
  } finally {
    await forget(b);
    await branchSql(`update data_center.workflow_config set value = '${before?.v ?? "60"}'::jsonb where key = 'bench.refresh_seconds'`);
    if (saleId) {
      await branchSql(`delete from data_center.call_records where sale_id = '${saleId}'`);
      await branchSql(`update public.stove_ids_base set status = 'available', sale_id = null where stove_id = '${a}'`);
      await branchSql(`delete from public.sales where id = '${saleId}'`);
    }
  }
});
