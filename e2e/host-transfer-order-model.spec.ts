import { test, expect } from "@playwright/test";
import { signIn, USERS, branchSql, callEdgeFunction } from "./helpers";

/**
 * The transfer remembers the sales model the ERP named for it (D19).
 *
 * The transfers view exposes the model as sent and as resolved; the bench is
 * told which model a stove went out under and preselects it when the partner
 * is offered it; the digitisation sheet prefills it.
 *
 * Red on main: the columns do not exist, so the view has no such fields and
 * workbench_open returns no orderModel.
 */

test.describe.configure({ timeout: 240_000 });

const TWIN_A = "a0000000-0000-4000-8000-00000000000a";

/** A free stove of the seeded twin partner, with the transfer it came on. */
async function freeStove(page: import("@playwright/test").Page): Promise<{ stoveId: string; transactionId: string }> {
  const r = await callEdgeFunction(page, "data-center-read", { action: "partner_stoves", organizationId: TWIN_A, limit: 100 });
  const stoves = (r.body as { data?: { stoves?: { stove_id: string; sale_id: string | null; transaction_id: string }[] } }).data?.stoves ?? [];
  const one = stoves.find((s) => !s.sale_id && s.transaction_id);
  expect(one, "a free stove on a known transfer").toBeTruthy();
  return { stoveId: one!.stove_id, transactionId: one!.transaction_id };
}

test("the transfers view carries the model as sent and as resolved", async () => {
  const cols = await branchSql<{ column_name: string }>(
    `select column_name from information_schema.columns
      where table_schema = 'data_center' and table_name = 'v_transfers'
        and column_name in ('order_payment_model_id', 'order_sales_model_name', 'order_sales_model_duration', 'order_payment_model_label')`,
  );
  expect(cols.map((c) => c.column_name).sort()).toEqual([
    "order_payment_model_id", "order_payment_model_label", "order_sales_model_duration", "order_sales_model_name",
  ]);
});

test("the bench is told the transfer's model and preselects it", async ({ page }) => {
  await signIn(page, USERS.admin);
  const { stoveId, transactionId } = await freeStove(page);
  const [amina] = await branchSql<{ id: string; name: string; duration_months: number }>(
    `select id::text, name, duration_months from public.payment_models where name ilike 'Amina%' and is_active limit 1`,
  );
  expect(amina, "the Amina model exists on the branch").toBeTruthy();
  const [before] = await branchSql<{ id: string; a: string | null; b: string | null; c: number | null }>(
    `select id::text, order_payment_model_id::text as a, order_sales_model_name as b, order_sales_model_duration as c
       from public.stove_transfer_history where transaction_id = '${transactionId}' limit 1`,
  );
  expect(before, "the stove's transfer row").toBeTruthy();
  try {
    await branchSql(
      `update public.stove_transfer_history
          set order_payment_model_id = '${amina.id}', order_sales_model_name = 'Amina Model', order_sales_model_duration = ${amina.duration_months}
        where id = '${before.id}'`,
    );

    const opened = await callEdgeFunction(page, "data-center-import", { action: "workbench_open", stoveId });
    expect(opened.status, JSON.stringify(opened.body).slice(0, 200)).toBe(200);
    const stove = (opened.body as { data: { stove: { orderModel: { id: string; name: string; durationMonths: number } | null; models: { id: string; name: string }[] } } }).data.stove;
    expect(stove.orderModel, "the transfer's model is returned").toBeTruthy();
    expect(stove.orderModel!.id).toBe(amina.id);
    expect(stove.orderModel!.name).toBe(amina.name);

    // On the bench the select starts on that model and says where it came from.
    await page.goto("/data-center/import");
    await page.getByRole("button", { name: /One receipt at a time/ }).click();
    await page.getByRole("button", { name: /Twin Name Partner/ }).first().click();
    await page.getByRole("button", { name: new RegExp(stoveId) }).first().click();
    const select = page.getByLabel("Sales model", { exact: true });
    await expect(select).toBeVisible({ timeout: 30_000 });
    await expect(select).toHaveValue(amina.name);
    await expect(page.getByText(new RegExp(`Sent with transfer ${transactionId}`))).toBeVisible();
  } finally {
    await branchSql(
      `update public.stove_transfer_history
          set order_payment_model_id = ${before.a ? `'${before.a}'` : "null"},
              order_sales_model_name = ${before.b ? `'${before.b.replace(/'/g, "''")}'` : "null"},
              order_sales_model_duration = ${before.c ?? "null"}
        where id = '${before.id}'`,
    ).catch(() => {});
  }
});

test("the digitisation sheet prefills the transfer's model", async ({ page }) => {
  await signIn(page, USERS.admin);
  const { transactionId } = await freeStove(page);
  const [amina] = await branchSql<{ id: string; name: string; duration_months: number }>(
    `select id::text, name, duration_months from public.payment_models where name ilike 'Amina%' and is_active limit 1`,
  );
  const [before] = await branchSql<{ id: string; a: string | null; b: string | null; c: number | null }>(
    `select id::text, order_payment_model_id::text as a, order_sales_model_name as b, order_sales_model_duration as c
       from public.stove_transfer_history where transaction_id = '${transactionId}' limit 1`,
  );
  try {
    await branchSql(
      `update public.stove_transfer_history
          set order_payment_model_id = '${amina.id}', order_sales_model_name = 'Amina Model', order_sales_model_duration = ${amina.duration_months}
        where id = '${before.id}'`,
    );
    const sheet = await callEdgeFunction(page, "data-center-read", { action: "digitisation_sheet", organizationId: TWIN_A });
    expect(sheet.status, JSON.stringify(sheet.body).slice(0, 200)).toBe(200);
    const body = sheet.body as { data: { columns: { field: string; header: string }[]; rows: Record<string, unknown>[] } };
    expect(body.data.columns.some((c) => c.field === "salesModel"), "the sheet has a Sales model column").toBe(true);
    const row = body.data.rows.find((r) => r.transaction_id === transactionId);
    expect(row, "a row for the stove's transfer").toBeTruthy();
    expect(row!.order_sales_model_name, "the row carries the transfer's model").toBe(amina.name);
  } finally {
    await branchSql(
      `update public.stove_transfer_history
          set order_payment_model_id = ${before.a ? `'${before.a}'` : "null"},
              order_sales_model_name = ${before.b ? `'${before.b.replace(/'/g, "''")}'` : "null"},
              order_sales_model_duration = ${before.c ?? "null"}
        where id = '${before.id}'`,
    ).catch(() => {});
  }
});
