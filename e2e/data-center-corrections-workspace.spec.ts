import { test, expect, type Page } from "@playwright/test";
import { signIn, USERS, branchSql } from "./helpers";

/**
 * The correction workspace: the record with the disputed item marked, the
 * fix saved through the sales app's own edit path, and the episode moving to
 * "awaiting review".
 *
 * The seeded ACSL agent is made a sales rep and linked to the rep the transfer
 * names, as the levers spec does; the episode is opened routed to them with
 * the phone disputed. On main this page does not exist (the route 404s into
 * the module's not-found state), which is the red.
 */

const ACSL_AGENT_ID = "b0000000-0000-4000-8000-000000000003";
const SAFE_ID = /^[0-9a-f-]{36}$/;

test.describe.configure({ timeout: 240_000 });

type Sale = { sale_id: string; stove_serial_no: string; phone: string | null; sales_rep: string | null };

async function routedSale(): Promise<Sale | null> {
  const rows = await branchSql<Sale>(
    `select s.id::text as sale_id, s.stove_serial_no, s.phone, f.sales_rep
       from public.sales s
       join data_center.v_transfer_stoves b on b.stove_id = upper(trim(s.stove_serial_no))
       join data_center.transfer_funnel f on f.transfer_id = b.transfer_id
      where s.is_archived is not true and f.sales_rep is not null
      order by s.id limit 1`,
  );
  const row = rows[0] ?? null;
  if (row) expect(SAFE_ID.test(row.sale_id)).toBe(true);
  return row;
}

async function asRoutedRep(sale: Sale, disputed: string[]) {
  const repKey = String(sale.sales_rep).trim().toLowerCase().replace(/'/g, "''");
  const repName = String(sale.sales_rep).replace(/'/g, "''");
  const [access] = await branchSql<{ access_role: string | null }>(
    `select access_role from data_center.module_access where user_id = '${ACSL_AGENT_ID}'`,
  );
  await branchSql(
    `insert into data_center.module_access (user_id, access_role) values ('${ACSL_AGENT_ID}', 'sales_rep')
     on conflict (user_id) do update set access_role = 'sales_rep'`,
  );
  await branchSql(
    `insert into data_center.sales_rep_accounts (rep_key, rep_name, user_id, linked_at)
     values ('${repKey}', '${repName}', '${ACSL_AGENT_ID}', now())
     on conflict (rep_key) do update set user_id = excluded.user_id, linked_at = now()`,
  );
  await branchSql(`delete from data_center.corrections where sale_id = '${sale.sale_id}'`);
  await branchSql(
    `insert into data_center.corrections
       (sale_id, seq, state, note, opened_at, routed_rep_key, routed_rep_user_id, disputed_fields, before)
     values ('${sale.sale_id}', 1, 'open', 'e2e: the number rings a different household', now(),
             '${repKey}', '${ACSL_AGENT_ID}', '{${disputed.join(",")}}', data_center.sale_snapshot('${sale.sale_id}'))`,
  );
  return async () => {
    await branchSql(`delete from data_center.corrections where sale_id = '${sale.sale_id}'`).catch(() => {});
    await branchSql(`delete from data_center.sales_rep_accounts where rep_key = '${repKey}'`);
    if (access?.access_role) {
      await branchSql(
        `update data_center.module_access set access_role = '${access.access_role}' where user_id = '${ACSL_AGENT_ID}'`,
      );
    } else {
      await branchSql(`delete from data_center.module_access where user_id = '${ACSL_AGENT_ID}'`);
    }
  };
}

async function openWorkspace(page: Page, saleId: string) {
  await page.goto(`/data-center/corrections/${saleId}`);
  await expect(page.getByRole("heading", { name: "Fix this record" })).toBeVisible({ timeout: 30_000 });
}

test("the rep sees the disputed phone marked, saves a new one, and the episode awaits review", async ({ page }) => {
  const sale = await routedSale();
  test.skip(!sale, "no sale on a transfer that names a rep");
  const restore = await asRoutedRep(sale!, ["phone"]);
  const originalPhone = sale!.phone;
  const newPhone = `080${String(Date.now()).slice(-8)}`;
  try {
    await signIn(page, USERS.acslAgent);
    await openWorkspace(page, sale!.sale_id);

    // The record, with the disputed item marked and nothing else.
    await expect(page.getByText("disputed", { exact: true }).first()).toBeVisible({ timeout: 20_000 });
    const marked = page.locator("[data-disputed]");
    await expect(marked).toHaveCount(1);
    await expect(marked.first()).toContainText("Phone");

    // The panel puts the disputed field first, prefilled.
    const phone = page.getByLabel(/^Phone/);
    await expect(phone).toBeVisible();
    await phone.fill(newPhone);
    await page.getByLabel(/What did you change/).fill("e2e: the receipt carried one wrong digit");
    await page.getByRole("button", { name: "Save and send for review" }).click();

    // The sale changed where sales live, and the episode moved on.
    await expect
      .poll(
        async () => {
          const [r] = await branchSql<{ phone: string | null; state: string | null }>(
            `select s.phone, (select state from data_center.corrections c where c.sale_id = s.id order by seq desc limit 1) as state
               from public.sales s where s.id = '${sale!.sale_id}'`,
          );
          return `${r.phone}:${r.state}`;
        },
        { timeout: 30_000, message: "update-sale should carry the new phone and the episode should read fixed" },
      )
      .toBe(`${newPhone}:fixed`);
    await expect(page.getByText("Awaiting review")).toBeVisible({ timeout: 20_000 });
  } finally {
    await branchSql(`update public.sales set phone = ${originalPhone ? `'${originalPhone}'` : "null"} where id = '${sale!.sale_id}'`);
    await restore();
  }
});

test("a disputed stove ID offers the rematch, not a text box", async ({ page }) => {
  const sale = await routedSale();
  test.skip(!sale, "no sale on a transfer that names a rep");
  const restore = await asRoutedRep(sale!, ["stove_serial_no"]);
  try {
    await signIn(page, USERS.acslAgent);
    await openWorkspace(page, sale!.sale_id);
    await expect(page.getByRole("heading", { name: "Fix the stove ID" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Fix the stove ID" })).toBeVisible();
    // No free-text control offers the serial for typing.
    await expect(page.getByLabel(/^Stove ID/)).toHaveCount(0);
  } finally {
    await restore();
  }
});

test("a record not routed to the rep is refused, and the list still opens", async ({ page }) => {
  const sale = await routedSale();
  test.skip(!sale, "no sale on a transfer that names a rep");
  const restore = await asRoutedRep(sale!, ["phone"]);
  try {
    // Route it away from the agent: the episode names another account.
    await branchSql(
      `update data_center.corrections set routed_rep_user_id = 'b0000000-0000-4000-8000-000000000006', routed_rep_key = 'somebody else' where sale_id = '${sale!.sale_id}'`,
    );
    await branchSql(`delete from data_center.sales_rep_accounts where user_id = '${ACSL_AGENT_ID}'`);
    await signIn(page, USERS.acslAgent);
    await page.goto(`/data-center/corrections/${sale!.sale_id}`);
    await expect(page.getByText(/not routed to you/)).toBeVisible({ timeout: 30_000 });
  } finally {
    await restore();
  }
});
