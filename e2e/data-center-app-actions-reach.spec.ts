import { expect, test, type Page } from "@playwright/test";
import { USERS, branchSql, callEdgeFunction, signIn } from "./helpers";

/**
 * Phase 30, slice 1: the sales app's actions reach the Data Center (D54 to D56).
 *
 * Found on production 2026-09-15: a purchase cancelled in the sales app was
 * gone from stock and from the transfer history at once, but the Data Center
 * still listed it four hours later, because its copy of the transfers was
 * rebuilt only by the full computation. The Data Center now listens, with
 * triggers it owns, on the app's tables:
 *
 *   - a transfer issued or cancelled in the app appears in or leaves the
 *     Data Center's copy at once, and a cancelled purchase is answered by
 *     name on Partner Records and on the stove record;
 *   - a sale archived in the app leaves its agent's batch at once;
 *   - a sale carrying call-centre work cannot be hard-deleted from under it.
 *
 * Red on main's build against the sandbox (the funnel row lingers, the band
 * does not exist, the item stays active, the delete goes through); green on
 * this branch.
 */

test.describe.configure({ timeout: 240_000 });

const ORG = "a0000000-0000-4000-8000-000000000001";
const TWIN_A = "a0000000-0000-4000-8000-00000000000a";
const MARKER = "DCL";

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

test.afterAll(async () => {
  await branchSql(`delete from public.stove_transfer_history where transaction_id like 'TR-${MARKER}%'`).catch(() => {});
  await branchSql(`delete from public.cancelled_purchases where transaction_id like 'TR-${MARKER}%'`).catch(() => {});
  await branchSql(`delete from public.stove_ids_base where stove_id like '${MARKER}%'`).catch(() => {});
  await branchSql(`delete from data_center.transfer_funnel where transaction_id like 'TR-${MARKER}%'`).catch(() => {});
  await branchSql(
    `update public.stove_ids_base set status = 'available', sale_id = null
      where sale_id in (select id from public.sales where transaction_id like '${MARKER}-%')`,
  ).catch(() => {});
  await branchSql(`delete from data_center.call_attempts where sale_id in (select id from public.sales where transaction_id like '${MARKER}-%')`).catch(() => {});
  await branchSql(`delete from data_center.call_records where sale_id in (select id from public.sales where transaction_id like '${MARKER}-%')`).catch(() => {});
  await branchSql(`delete from public.sales where transaction_id like '${MARKER}-%'`).catch(() => {});
  await branchSql(`delete from public.addresses where full_address like '${MARKER}%'`).catch(() => {});
});

test.describe("the sales app's actions reach the Data Center", () => {
  test("a transfer issued, then cancelled, in the app appears in and leaves the Data Center at once", async ({ page }) => {
    const stamp = Date.now().toString(36).toUpperCase().slice(-5);
    const tx = `TR-${MARKER}${stamp}`;
    const serials = [1, 2, 3].map((n) => `${MARKER}${stamp}${n}`);
    const reason = `Issued to the wrong partner, ${stamp}`;

    // Arrange: three stoves in stock and the transfer that issued them, the
    // rows the ERP sync writes. No computation runs in between.
    await branchSql(
      `insert into public.stove_ids_base (stove_id, organization_id, status, factory, is_archived, sales_reference)
       values ${serials.map((s) => `('${s}', '${ORG}', 'available', 'Gombe', false, '${tx}')`).join(",")}`,
    );
    const [transfer] = await branchSql<{ id: string }>(
      `insert into public.stove_transfer_history
         (transaction_id, organization_id, partner_name, partner_id, state, branch, stove_count, stove_ids,
          source, sales_factory, sales_date, transfer_date)
       select '${tx}', o.id, o.partner_name, 'PRV-01', o.state, o.branch, ${serials.length},
              '${JSON.stringify(serials.map((s) => ({ stove_id: s, factory: "Gombe", sales_reference: tx })))}'::jsonb,
              'external-sync', 'Gombe', current_date, now()
         from public.organizations o where o.id = '${ORG}'
       returning id::text`,
    );
    expect(transfer?.id, "the transfer row").toBeTruthy();

    // The Data Center's copy has the transfer already, with no computation.
    const [issued] = await branchSql<{ issued_count: number; partner_name: string }>(
      `select issued_count, partner_name from data_center.transfer_funnel where transfer_id = '${transfer.id}'`,
    );
    expect(issued, "the funnel row appears when the transfer is issued").toBeTruthy();
    expect(Number(issued.issued_count)).toBe(serials.length);

    await signIn(page, USERS.admin);

    // Partner Records finds it.
    await page.goto("/data-center/partner-records");
    await page.getByPlaceholder("Partner, reference or sales rep").fill(tx);
    await expect(page.locator("tbody tr", { hasText: tx }).first()).toBeVisible({ timeout: 30_000 });

    // Act: cancel the purchase where the app cancels it.
    await page.goto("/stove-transfer-history");
    await page.getByPlaceholder(/Search partner, state, transaction ID/).fill(tx);
    const row = page.locator("tbody tr", { hasText: tx }).first();
    await expect(row, "the transfer should be listed").toBeVisible({ timeout: 30_000 });
    await row.getByRole("button").last().click();
    await page.getByRole("menuitem", { name: "Cancel Purchase" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await dialog.getByPlaceholder(/Why is this purchase being cancelled/).fill(reason);
    await dialog.getByRole("checkbox").check();
    await dialog.getByRole("button", { name: "Confirm Cancellation" }).click();

    let cancelledRows = 0;
    for (let i = 0; i < 20 && cancelledRows === 0; i++) {
      await sleep(1000);
      const [r] = await branchSql<{ n: number }>(
        `select count(*)::int as n from public.cancelled_purchases where transaction_id = '${tx}'`,
      );
      cancelledRows = Number(r?.n ?? 0);
    }
    expect(cancelledRows, "the app recorded the cancellation").toBe(1);

    // Assert: the Data Center's copy let go in the same transaction.
    const [left] = await branchSql<{ funnel: number; stock: number; history: number }>(
      `select (select count(*)::int from data_center.transfer_funnel where transfer_id = '${transfer.id}') as funnel,
              (select count(*)::int from public.stove_ids_base where sales_reference = '${tx}') as stock,
              (select count(*)::int from public.stove_transfer_history where id = '${transfer.id}') as history`,
    );
    expect(left, "nothing of the transfer remains").toEqual({ funnel: 0, stock: 0, history: 0 });

    // Partner Records answers the reference by name rather than with nothing.
    await page.goto("/data-center/partner-records");
    await page.getByPlaceholder("Partner, reference or sales rep").fill(tx);
    const band = page.locator(`[data-cancelled-purchase="${tx}"]`);
    await expect(band).toBeVisible({ timeout: 30_000 });
    await expect(band).toContainText("was cancelled");
    await expect(band).toContainText(reason);
    await expect(page.locator("tbody tr", { hasText: tx })).toHaveCount(0);

    // The stove record says where the serial went.
    await page.goto(`/data-center/stove/${serials[0]}`);
    await expect(page.getByText(`left stock when purchase ${tx}`)).toBeVisible({ timeout: 30_000 });
  });

  test("archiving a sale retires it from its agent's batch at once", async () => {
    // Arrange: a live sale of the partner, handed to the call-centre agent in
    // a batch of one, the way the engine would. The sandbox's setup hands
    // every sale out, so whatever item holds this one is stood down for the
    // test and restored after it.
    const [agent] = await branchSql<{ id: string }>(
      `select id::text from public.profiles where email = '${USERS.callCentre}'`,
    );
    const [sale] = await branchSql<{ id: string; organization_id: string; held_item: string | null }>(
      `select s.id::text, s.organization_id::text,
              (select i.id::text from data_center.assignment_items i where i.sale_id = s.id and i.is_active) as held_item
         from public.sales s
        where s.is_archived is not true
          and s.organization_id = '${ORG}'
          and not exists (select 1 from data_center.corrections x where x.sale_id = s.id)
        order by (exists (select 1 from data_center.call_records cr where cr.sale_id = s.id)) asc, s.created_at desc
        limit 1`,
    );
    expect(sale, "a live sale of the partner").toBeTruthy();
    if (sale.held_item) {
      await branchSql(`update data_center.assignment_items set is_active = false where id = '${sale.held_item}'`);
    }
    const [batch] = await branchSql<{ id: string }>(
      `insert into data_center.assignment_batches (organization_id, assigned_to, size, state, created_by)
       values ('${sale.organization_id}', '${agent.id}', 1, 'open', '${agent.id}') returning id::text`,
    );
    await branchSql(
      `insert into data_center.assignment_items (batch_id, sale_id, position, is_active)
       values ('${batch.id}', '${sale.id}', 1, true)`,
    );

    try {
      // Act: the app archives the sale (what cancel_sale and the stove archive do).
      await branchSql(`update public.sales set is_archived = true where id = '${sale.id}'`);

      // Assert: the item is retired and the emptied batch is closed, at once.
      const [after] = await branchSql<{ is_active: boolean; state: string; completed: boolean }>(
        `select i.is_active, b.state, (b.completed_at is not null) as completed
           from data_center.assignment_items i join data_center.assignment_batches b on b.id = i.batch_id
          where i.batch_id = '${batch.id}'`,
      );
      expect(after.is_active, "the archived sale is no longer the agent's to call").toBe(false);
      expect(after.state, "a batch emptied by the archive closes").toBe("completed");
      expect(after.completed).toBe(true);
    } finally {
      await branchSql(`update public.sales set is_archived = false where id = '${sale.id}'`).catch(() => {});
      await branchSql(`delete from data_center.assignment_batches where id = '${batch.id}'`).catch(() => {});
      if (sale.held_item) {
        await branchSql(`update data_center.assignment_items set is_active = true where id = '${sale.held_item}'`).catch(() => {});
      }
    }
  });

  test("a sale carrying call-centre work cannot be hard-deleted; one without work still can", async ({ page }) => {
    await signIn(page, USERS.admin);

    // Arrange: a sale of our own, through the app's own door.
    const stoves = await callEdgeFunction(page, "data-center-read", { action: "partner_stoves", organizationId: TWIN_A, limit: 100 });
    const free = ((stoves.body as { data?: { stoves?: { stove_id: string; sale_id: string | null }[] } }).data?.stoves ?? []).find((s) => !s.sale_id);
    expect(free, "a free stove of the twin partner").toBeTruthy();
    const [partner] = await branchSql<{ partner_name: string }>(`select partner_name from public.organizations where id = '${TWIN_A}'`);
    const stamp = String(Date.now()).slice(-8);
    const tx = `${MARKER}-${stamp}`;
    const created = await callEdgeFunction(page, "create-sale", {
      transactionId: tx,
      stoveSerialNo: free!.stove_id,
      organizationId: TWIN_A,
      partnerName: partner.partner_name,
      salesDate: "2026-06-01",
      amount: 25000,
      endUserFirstName: "Ngozi",
      endUserSurname: "Eze",
      phone: `084${stamp}`,
      contactPerson: "Ngozi Eze",
      contactPhone: `084${stamp}`,
      salesAgentName: "Bala Sani",
      retailerBranch: "Lokoja branch",
      stateBackup: "Kogi",
      lgaBackup: "Lokoja",
      potQuantity: 1,
      heatRetentionDevice: false,
      previousStoveType: "charcoal",
      cookingFuelSource: "purchase",
      cookingLocation: "indoor",
      termsAccepted: { poaGoverned: true, monitoring: true, noResell: true, emissionReductions: true, noExport: true, demonstration: true },
      addressData: { fullAddress: `${MARKER} Close`, state: "Kogi", city: "Lokoja" },
    });
    expect([200, 201], JSON.stringify(created.body).slice(0, 300)).toContain(created.status);
    const saleId = (created.body as { data?: { id?: string } }).data?.id;
    expect(saleId).toBeTruthy();

    // A call logged against it: the work the guard protects.
    await branchSql(
      `insert into data_center.call_records (sale_id, verification_outcome) values ('${saleId}', 'not_verified')
       on conflict (sale_id) do nothing`,
    );
    await branchSql(
      `insert into data_center.call_attempts (sale_id, attempt_no, attempted_at, created_by, note, source)
       values ('${saleId}', 1, now(), (select id from public.profiles where email = '${USERS.callCentre}'), 'app-actions spec', 'form')`,
    );

    // Act one: the app's delete, refused with the reason.
    const refused = await callEdgeFunction(page, "delete-sale", { id: saleId }, `?id=${saleId}`);
    expect(refused.status, JSON.stringify(refused.body).slice(0, 300)).not.toBe(200);
    expect(JSON.stringify(refused.body)).toContain("call-centre work");
    const [still] = await branchSql<{ n: number }>(`select count(*)::int as n from public.sales where id = '${saleId}'`);
    expect(Number(still.n), "the sale is still there").toBe(1);

    // Act two: with the work cleared, the same delete goes through.
    await branchSql(`delete from data_center.call_records where sale_id = '${saleId}'`);
    const allowed = await callEdgeFunction(page, "delete-sale", { id: saleId }, `?id=${saleId}`);
    expect(allowed.status, JSON.stringify(allowed.body).slice(0, 300)).toBe(200);
    const [gone] = await branchSql<{ n: number; stock: string }>(
      `select (select count(*)::int from public.sales where id = '${saleId}') as n,
              (select status from public.stove_ids_base where stove_id = '${free!.stove_id}') as stock`,
    );
    expect(Number(gone.n)).toBe(0);
    expect(gone.stock).toBe("available");
  });
});
