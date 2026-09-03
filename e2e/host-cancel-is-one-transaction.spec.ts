import { test, expect, type Page } from "@playwright/test";
import { branchSql, signIn, USERS } from "./helpers";

/**
 * Slice 3 of the 2026-09-02 review: cancelling a sale is one transaction.
 *
 * The browser used to cancel a sale in two writes: release the stove, then
 * archive the sale. A failure between them left a released stove standing
 * against a live sale, and the first write's failure was only warned about.
 * Now one SQL function does both, and a failure anywhere undoes everything.
 *
 * The first test forces the second write to fail, on the branch database
 * only, through a trigger that refuses to archive one marked sale. Against
 * the old code the stove is released and the sale stays live (red). Against
 * the new code nothing changes at all.
 *
 * The second test is the ordinary path, and pins that it goes through the
 * function rather than through table writes: against the old code no request
 * reaches /rest/v1/rpc/cancel_sale (red).
 */

type LinkedSale = { id: string; end_user_name: string; stove_serial_no: string; stock_id: string };
const SAFE_ID = /^[0-9a-f-]{36}$/;

test.describe.configure({ timeout: 240_000 });

/** A live sale whose stock row is linked to it, so a release is observable. */
async function linkedSale(skip: string[] = []): Promise<LinkedSale | null> {
  const rows = await branchSql<LinkedSale>(
    `select s.id::text, s.end_user_name, s.stove_serial_no, b.id::text as stock_id
       from public.sales s
       join public.stove_ids_base b on b.stove_id = s.stove_serial_no and b.sale_id = s.id
      where s.is_archived is not true and s.end_user_name is not null
        ${skip.length ? `and s.id::text not in (${skip.map((s) => `'${s}'`).join(",")})` : ""}
      order by s.created_at desc limit 1`,
  );
  return rows[0] ?? null;
}

async function stockOf(stockId: string) {
  const [r] = await branchSql<{ status: string; sale_id: string | null }>(
    `select status, sale_id::text from public.stove_ids_base where id = '${stockId}'`,
  );
  return r;
}

async function saleOf(saleId: string) {
  const [r] = await branchSql<{ is_archived: boolean | null; cancel_reason: string | null }>(
    `select is_archived, cancel_reason from public.sales where id = '${saleId}'`,
  );
  return r;
}

/** Drive the product: Sales Records, the row's menu, Cancel Sale, a reason, confirm. */
async function cancelThroughTheScreen(page: Page, sale: LinkedSale, reason: string) {
  await page.goto("/sales");
  await page.getByPlaceholder("Search customer, transaction ID, phone…").fill(sale.end_user_name);
  const row = page.locator("tbody tr", { hasText: sale.end_user_name }).first();
  await expect(row, "the sale should be listed").toBeVisible({ timeout: 30_000 });
  await row.getByRole("button").last().click();
  await page.getByRole("menuitem", { name: "Cancel Sale" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await dialog.getByPlaceholder(/Customer changed mind/).fill(reason);
  await dialog.getByRole("button", { name: "Confirm Cancel" }).click();
}

test.describe("slice 3: cancelling a sale is one transaction", () => {
  test("when archiving the sale fails, the stove is not released", async ({ page }) => {
    const sale = await linkedSale();
    expect(sale, "the preview has no live sale linked to a stock row").toBeTruthy();
    expect(SAFE_ID.test(sale!.id) && SAFE_ID.test(sale!.stock_id)).toBe(true);
    // Auto-dismiss the old code's alert() so the run does not hang on it.
    const alerts: string[] = [];
    page.on("dialog", (d) => {
      alerts.push(d.message());
      d.dismiss().catch(() => {});
    });
    try {
      // A trigger that refuses to archive this one sale. Both the old path's
      // writes and the new function's write hit it; only the function undoes
      // the stove release it made in the same transaction.
      await branchSql(`create table if not exists public.e2e_cancel_flags (sale_id uuid primary key)`);
      await branchSql(`insert into public.e2e_cancel_flags values ('${sale!.id}') on conflict do nothing`);
      await branchSql(`create or replace function public.e2e_refuse_cancel() returns trigger
        language plpgsql as $$ begin
          if new.is_archived is true and old.is_archived is not true
             and exists (select 1 from public.e2e_cancel_flags f where f.sale_id = new.id) then
            raise exception 'e2e: archiving refused on purpose';
          end if;
          return new;
        end $$`);
      await branchSql(`drop trigger if exists e2e_refuse_cancel on public.sales`);
      await branchSql(`create trigger e2e_refuse_cancel before update on public.sales
        for each row execute function public.e2e_refuse_cancel()`);

      await signIn(page, USERS.admin);
      await cancelThroughTheScreen(page, sale!, "e2e: forced failure of the second write");
      // Give the product time to make its writes and report.
      await expect
        .poll(async () => (await saleOf(sale!.id)).is_archived === true || alerts.length > 0, {
          timeout: 20_000,
          message: "the product should have either archived the sale or reported a failure",
        })
        .toBe(true);

      const stock = await stockOf(sale!.stock_id);
      const live = await saleOf(sale!.id);
      expect(live.is_archived, "the archive was refused, so the sale must still be live").not.toBe(true);
      expect(
        `${stock.status}:${stock.sale_id ?? "null"}`,
        "the sale is live, so its stove must still be sold and linked; a released stove here is the defect",
      ).toBe(`sold:${sale!.id}`);
    } finally {
      await branchSql(`drop trigger if exists e2e_refuse_cancel on public.sales`);
      await branchSql(`drop function if exists public.e2e_refuse_cancel()`);
      await branchSql(`drop table if exists public.e2e_cancel_flags`);
      // Whatever the old code managed to do, put it back.
      await branchSql(
        `update public.stove_ids_base set status = 'sold', sale_id = '${sale!.id}' where id = '${sale!.stock_id}'`,
      );
      await branchSql(
        `update public.sales set is_archived = false, cancelled_at = null, cancelled_by = null, cancel_reason = null where id = '${sale!.id}'`,
      );
    }
  });

  test("an ordinary cancel goes through the one function and does both things", async ({
    page,
  }) => {
    const sale = await linkedSale();
    expect(sale, "the preview has no live sale linked to a stock row").toBeTruthy();
    const rpcCalls: string[] = [];
    page.on("request", (req) => {
      if (/\/rest\/v1\/rpc\/cancel_sale/.test(req.url())) rpcCalls.push(req.url());
    });
    page.on("dialog", (d) => d.dismiss().catch(() => {}));
    try {
      await signIn(page, USERS.admin);
      await cancelThroughTheScreen(page, sale!, "e2e: ordinary cancel");
      await expect
        .poll(async () => (await saleOf(sale!.id)).is_archived === true, {
          timeout: 20_000,
          message: "the sale should be archived",
        })
        .toBe(true);
      const stock = await stockOf(sale!.stock_id);
      expect(`${stock.status}:${stock.sale_id ?? "null"}`, "the stove should be released").toBe(
        "available:null",
      );
      expect((await saleOf(sale!.id)).cancel_reason, "the reason should be kept").toBe(
        "e2e: ordinary cancel",
      );
      expect(rpcCalls.length, "the cancel must go through cancel_sale, not table writes").toBeGreaterThan(
        0,
      );
    } finally {
      await branchSql(
        `update public.stove_ids_base set status = 'sold', sale_id = '${sale!.id}' where id = '${sale!.stock_id}'`,
      );
      await branchSql(
        `update public.sales set is_archived = false, cancelled_at = null, cancelled_by = null, cancel_reason = null where id = '${sale!.id}'`,
      );
    }
  });
});
