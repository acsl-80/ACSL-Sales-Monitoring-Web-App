import { test, expect, type Page } from "@playwright/test";
import { signIn, USERS, branchSql } from "./helpers";

/**
 * The queue you can narrow, from the URL.
 *
 * The Partner facet, named by its label, narrows every Partner cell to the
 * chosen partner; the URL carries organizationId so back restores the whole
 * queue; the Held-by facet is offered to whoever may see the agents and to
 * nobody else.
 *
 * Red on main: the call centre page has no Partner combobox.
 */

test.describe.configure({ timeout: 240_000 });

/** The partner index in the queue's column order. */
const PARTNER_COLUMN = 4;

async function busiestPartner(): Promise<{ organization_id: string; partner_name: string } | null> {
  const [row] = await branchSql<{ organization_id: string; partner_name: string }>(
    `select c.organization_id::text, c.partner_name from data_center.v_call_center c
      where c.is_archived is not true and c.organization_id is not null and c.partner_name is not null
      group by 1, 2 order by count(*) desc limit 1`,
  );
  return row ?? null;
}

async function pick(page: Page, combobox: string, option: string) {
  await page.getByRole("combobox", { name: combobox }).click();
  const list = page.getByRole("listbox");
  await expect(list).toBeVisible();
  const search = page.getByPlaceholder(/Type part of/);
  if ((await search.count()) > 0) await search.first().fill(option.slice(0, 12));
  await list.getByRole("option", { name: option, exact: true }).click();
}

test("the Partner facet narrows every Partner cell, the URL carries it, and back restores the queue", async ({ page }) => {
  const partner = await busiestPartner();
  test.skip(!partner, "no call centre records on the branch");
  await signIn(page, USERS.admin);
  await page.goto("/data-center/call-centre");
  await expect(page.getByRole("heading", { name: "Call Centre" })).toBeVisible({ timeout: 30_000 });

  await pick(page, "Partner", partner!.partner_name);
  await expect(page).toHaveURL(new RegExp(`organizationId=${partner!.organization_id}`), { timeout: 15_000 });
  await expect(page.getByText(/Narrowed to/)).toBeVisible({ timeout: 15_000 });

  const rows = page.getByRole("button", { name: /^Open call record for/ });
  await expect(rows.first()).toBeVisible({ timeout: 30_000 });
  const shown = Math.min(await rows.count(), 8);
  expect(shown).toBeGreaterThan(0);
  for (let i = 0; i < shown; i++) {
    await expect(rows.nth(i).locator(":scope > div").nth(PARTNER_COLUMN)).toHaveText(partner!.partner_name);
  }

  // The facet is the URL, so back is the way out and it works.
  await page.goBack();
  await expect(page).not.toHaveURL(/organizationId=/, { timeout: 15_000 });
  await expect(page.getByText(/Narrowed to/)).toHaveCount(0);
});

test("Held by is offered to whoever may see the agents, and to nobody else", async ({ page }) => {
  await signIn(page, USERS.admin);
  await page.goto("/data-center/call-centre");
  await expect(page.getByRole("combobox", { name: "Partner" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("combobox", { name: "Held by" })).toBeVisible({ timeout: 30_000 });

  await signIn(page, USERS.callCentre);
  await page.goto("/data-center/call-centre");
  await expect(page.getByRole("combobox", { name: "Partner" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("combobox", { name: "Held by" })).toHaveCount(0);
});
