import { test, expect, type Page } from "@playwright/test";
import { branchSql, callEdgeFunction, signIn, USERS } from "./helpers";
import { rowToRule, ruleErrorKey, ruleFormKey } from "../src/lib/saleFieldRules";
import { createInitialFormData } from "../src/app/utils/salesFormUtils.js";
import { blankSale, FIELD_META } from "../src/app/data-center/features/workbench/SaleForm.jsx";

/**
 * A receipt dated after the rules went live can be finished (D61).
 *
 * From 11 September the dated rules made six more things mandatory on a sale
 * dated that day or later. One of them, the first name, was looked up under
 * `endUserFirstName`, the key create-sale is sent, while both forms hold the
 * first name under `endUserName`. So every such receipt was refused in the
 * browser for a first name that was plainly filled in, nothing on the form
 * turned red, and the typist's work stayed a draft. On production on
 * 2026-09-25, 140 bench receipts were dated on or after 11 September and not
 * one of them had ever finished.
 *
 * Every other bench spec types a sale date of 5 January 2026, months before
 * the rules, which is why none of them saw it. These type a September one.
 */

const PARTNER = "a0000000-0000-4000-8000-00000000000a";
const PARTNER_NAME = "Twin Name Partner";
const AFTER_GO_LIVE = "2026-09-15";

async function openTwinSweep(page: Page): Promise<boolean> {
  await signIn(page, USERS.admin);
  await page.goto("/data-center/import");
  await expect(page.getByRole("heading", { name: "Bulk Import" })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("button", { name: /One receipt at a time/ }).click();
  await expect(page.locator("tbody tr").first()).toBeVisible({ timeout: 30_000 });
  await page.getByPlaceholder("Search by name").fill(PARTNER_NAME);
  const row = page
    .locator("tbody tr", { hasText: PARTNER_NAME })
    .filter({ hasText: "Kogi" })
    .first();
  if ((await row.count()) === 0) return false;
  await row.click();
  await expect(page.getByText(/all consignments/).first()).toBeVisible({ timeout: 30_000 });
  return true;
}

/** The twin partner's still-to-type stoves, straight from the server. */
async function todoStoves(page: Page): Promise<string[]> {
  const r = await callEdgeFunction(page, "data-center-read", {
    action: "partner_stoves",
    organizationId: PARTNER,
    recorded: "no",
    limit: 200,
  });
  const stoves =
    (r.body as { data?: { stoves?: { stove_id: string }[] } })?.data?.stoves ?? [];
  return stoves.map((s) => s.stove_id);
}

/**
 * Open one particular stove still to type, through the rail's search.
 *
 * Picked from the middle of the list and one apart per test, so the two tests
 * here never share a stove with each other, and neither shares one with
 * bench-keeps-up, which takes the end of page one and the deepest stove.
 */
async function openTodoStove(page: Page, offset: number): Promise<boolean> {
  const todos = await todoStoves(page);
  if (todos.length < 6) return false;
  const target = todos[Math.floor(todos.length / 2) + offset];
  await page.locator("tbody tr").first().click();
  const rail = page.locator("aside");
  const find = rail.getByLabel("Find a stove this partner holds");
  await expect(find).toBeVisible({ timeout: 30_000 });
  await find.fill(target);
  const match = rail.locator("li button", { hasText: target });
  await expect(match).toBeVisible({ timeout: 20_000 });
  await match.click();
  await expect(
    rail.locator('li button[aria-current="true"]', { hasText: target }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("#wb-endUserName")).toBeVisible({ timeout: 30_000 });
  return true;
}

/**
 * A complete receipt, dated after the rules went live, filled the way a
 * typist fills one. The baseline stove is left off when asked, to prove the
 * bench can point at it.
 */
async function fillReceipt(page: Page, marker: string, opts: { baselineStove: boolean }) {
  await page.locator("#wb-endUserName").fill("Bench");
  await page.locator("#wb-endUserSurname").fill(marker);
  await page.locator("#wb-phone").fill("08015550111");
  await page.locator("#wb-address").fill(`${marker} Street`);
  await page.locator("#wb-city").fill("Lokoja");
  await page.locator("#wb-salesAgentName").fill("Bench Agent");
  if (opts.baselineStove) {
    await page.locator('input[name="wb-previousStoveType"]').first().check();
  }
  await page.locator("#wb-salesDate").fill(AFTER_GO_LIVE);
  await page.locator("#wb-amount").fill("1000");
  await page.locator("#wb-salesModel").selectOption("Hakimi Sales Model");

  const state = page.getByRole("combobox", { name: "State" });
  await state.click();
  await page.getByPlaceholder("Type part of the state").fill("Kogi");
  await page.getByRole("listbox").getByRole("option", { name: "Kogi", exact: true }).click();
  // Narrowed by typing before the click, as bench-asks-for-the-model does:
  // Yagba West sits far down Kogi's list, and clicking it unfiltered timed
  // out once in a full run.
  const lga = page.getByRole("combobox", { name: "LGA" });
  await expect(lga).toBeEnabled();
  await lga.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await lga.click();
  await page.getByPlaceholder("Type part of the LGA").fill("Yagba West");
  await page
    .getByRole("listbox")
    .getByRole("option", { name: "Yagba West", exact: true })
    .click();

  // Terms last and verified, for the reason bench-keeps-up gives: a
  // re-render between ticking and saving once un-ticked them.
  const terms = page
    .locator('label:has-text("The buyer agreed to all six") input[type="checkbox"]')
    .first();
  await terms.check();
  await expect(terms).toBeChecked();
}

/**
 * Leave nothing behind. A finished receipt left in the admin's open bench
 * batch is counted by bench-asks-for-the-model's "no finished row" check,
 * so this spec discards its own open batches as that one does.
 */
async function discardMyBenchBatch(page: Page) {
  const r = await callEdgeFunction(page, "data-center-import", { action: "batches" });
  const batches = (r.body as { data?: Record<string, unknown>[] })?.data ?? [];
  for (const b of batches) {
    if (b.source === "workbench" && b.state !== "committed" && b.state !== "rolled_back") {
      await callEdgeFunction(page, "data-center-import", { action: "discard", batchId: b.id });
    }
  }
}

/** The bench row this spec typed, found by the surname it was given. */
async function rowFor(marker: string) {
  const rows = await branchSql<{ status: string; has_shape: boolean; refusal: string | null }>(
    `select r.status, (r.normalized is not null) as has_shape,
            r.finish_refusal ->> 'reason' as refusal
       from data_center.import_rows r
       join data_center.import_batches b on b.id = r.batch_id and b.source = 'workbench'
      where r.draft_values ->> 'endUserSurname' = '${marker}'`,
  );
  return rows[0] ?? null;
}

test.describe("a receipt dated after the rules went live", () => {
  test.describe.configure({ timeout: 180_000 });
  test.afterEach(async ({ page }) => {
    await discardMyBenchBatch(page).catch(() => {});
  });

  test("finishes, with its first name filled in", async ({ page }, testInfo) => {
    const opened = await openTwinSweep(page);
    test.skip(!opened, "the twin partner is not in the funnel on this database");
    test.skip(!(await openTodoStove(page, 0)), "not enough stoves left to type");

    const marker = `golive${testInfo.workerIndex}${Date.now() % 100000}`;
    await fillReceipt(page, marker, { baselineStove: true });
    await page.getByRole("button", { name: /Save as finished/ }).click();

    /*
     * Finished on the server, which is the typist's whole complaint. On the
     * old code the request was never sent: the bench refused in the browser
     * with "Still to sort out: endUserFirstName", a key rather than a field,
     * about a name that was filled in, and the row stayed a draft.
     */
    await expect
      .poll(async () => (await rowFor(marker))?.status ?? "none", {
        timeout: 45_000,
        message: "the receipt never reached finished on the server",
      })
      .toBe("valid");
    await expect(page.getByText(/Still to sort out:/)).toHaveCount(0);
    const row = await rowFor(marker);
    expect(row?.has_shape).toBe(true);
    expect(row?.refusal ?? null).toBeNull();
  });

  test("missing its baseline stove, is refused by that name and points at it", async ({
    page,
  }, testInfo) => {
    const opened = await openTwinSweep(page);
    test.skip(!opened, "the twin partner is not in the funnel on this database");
    test.skip(!(await openTodoStove(page, 1)), "not enough stoves left to type");

    const marker = `golivenb${testInfo.workerIndex}${Date.now() % 100000}`;
    await fillReceipt(page, marker, { baselineStove: false });
    await page.getByRole("button", { name: /Save as finished/ }).click();

    // Named as the agreement names it, not as the code keys it.
    const refusal = page.getByText(/Still to sort out:/);
    await expect(refusal).toBeVisible({ timeout: 15_000 });
    await expect(refusal).toContainText(FIELD_META.previousStoveType.label);
    await expect(refusal).not.toContainText("previousStoveType");
    await expect(refusal).not.toContainText(FIELD_META.endUserName.label);
    // And the group itself is marked and brought into view.
    const group = page.locator("#wb-previousStoveType");
    await expect(group).toBeFocused();
    await expect(group).toHaveAttribute("aria-invalid", "true");
  });
});

/**
 * Every dated rule reads a key both forms actually hold, and the bench can
 * point at every one of them.
 *
 * Read from the rules on the database this suite runs against, so a rule
 * added in Settings tomorrow is checked by the same test. The three rules
 * that start on 5 January 2027 are included on purpose: the bench could not
 * point at them either, and that would have been the next receipt that would
 * not finish.
 */
test("every dated rule lands on a key both forms hold", async () => {
  const rows = await branchSql<{
    field_key: string; table_name: string; column_name: string;
    mandatory_from: string | null; applies_to: string[] | null;
    note: string | null; updated_at: string | null;
  }>(
    `select field_key, table_name, column_name, mandatory_from::text, applies_to, note, updated_at::text
       from public.sale_field_rules
      where mandatory_from > '2000-01-01'`,
  );
  expect(rows.length).toBeGreaterThan(0);

  const sell = createInitialFormData() as Record<string, unknown>;
  const bench = blankSale() as Record<string, unknown>;
  // The bench fills the agent from the transfer as it opens a stove, so its
  // blank shape does not carry it; the form's own control does.
  const benchOpened = { ...bench, salesAgentName: "" };
  const holds = (form: Record<string, unknown>, table: string, key: string) =>
    table === "addresses"
      ? Object.prototype.hasOwnProperty.call((form.addressData ?? {}) as object, key)
      : Object.prototype.hasOwnProperty.call(form, key);

  const problems: string[] = [];
  for (const rule of rows.map(rowToRule)) {
    const key = ruleFormKey(rule);
    if (!holds(sell, rule.tableName, key)) problems.push(`${rule.fieldKey}: Sell Stove holds no "${key}"`);
    if (!holds(benchOpened, rule.tableName, key)) problems.push(`${rule.fieldKey}: the bench holds no "${key}"`);
    if (rule.appliesTo.includes("data_center") && !(ruleErrorKey(rule) in FIELD_META)) {
      problems.push(`${rule.fieldKey}: the bench cannot point at "${ruleErrorKey(rule)}"`);
    }
  }
  expect(problems).toEqual([]);
});
