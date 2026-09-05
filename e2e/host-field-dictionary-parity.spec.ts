import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { test, expect, type Page } from "@playwright/test";
import { getEdgeFunction, signIn, USERS } from "./helpers";

/**
 * One name per sale field, everywhere.
 *
 * The paper User Agreement is the standard. Whatever a field is called on that
 * sheet is what it is called on the Sell Stove form, on the Data Center bench,
 * in the records table, and in the dictionary the phone app reads over HTTP.
 * Until now each surface named the same column its own way: the buyer's number
 * was "Phone Number" on one screen, "Phone" on another and "Telephone number"
 * on a third, and a typist reading a receipt had to translate. Three surfaces
 * disagreeing about one field is how a field gets filled in wrongly.
 *
 * What this proves:
 *
 *  1. `sale-dictionary` answers a signed-in user with a version and a fields
 *     array in which every entry carries the whole shape, and the agreement's
 *     wording for the seven fields the paper renames. It refuses an
 *     unauthenticated caller.
 *  2. The Sell Stove form shows those words.
 *  3. The Data Center bench shows those words.
 *  4. The records table's column headers show those words.
 *
 * Red on main: there is no dictionary JSON, no `sale-dictionary` function and
 * no `src/lib/saleDictionary.ts`, so the first test cannot get a 200. The three
 * screens carry the old wording, each in its own dialect: the Sell Stove form
 * says "Contact Person / Buyer", "Previous Stove Type", "Pots Quantity" and
 * "Terms & Conditions"; the bench says "Contact person" and "Previous stove
 * type"; the records table's header says "Phone", "Partner" and "Sale Date".
 *
 * A note on how strictly the labels are matched. The assertion is that a label
 * reads as the agreement's words and nothing else, give or take the " *" a
 * required field carries. A parenthetical gloss fails on purpose: "Wonderbox
 * (Heat Retention)" is the habit this slice exists to end, and a field whose
 * name needs explaining wants a help note under the control, not a second name
 * in the label.
 */

test.describe.configure({ timeout: 240_000 });

type DictionaryField = {
  key: string;
  label: string;
  payload: string | null;
  type: string;
  group: string;
  order: number;
  mandatoryFrom: string | null;
};

type Dictionary = {
  version: string;
  source: string;
  groups: { key: string; label: string }[];
  fields: DictionaryField[];
};

/**
 * The same JSON the web app bundles and the edge function serves, read from
 * disk rather than restated here. A label typed into this spec would be a
 * fourth place to keep it in step, which is the problem, not the fix.
 */
const DICTIONARY: Dictionary = JSON.parse(
  fs.readFileSync(
    fileURLToPath(new URL("../supabase/functions/_shared/sale-dictionary.json", import.meta.url)),
    "utf8",
  ),
) as Dictionary;

/**
 * The seven the paper renames, stated in full.
 *
 * Everything else in this file reads its words out of the JSON, so it follows
 * the source wherever it goes. These seven do not: they are the decision, and
 * an edit to the JSON that quietly puts "Phone" back is exactly what this
 * list is here to refuse.
 */
const AGREEMENT_WORDS: Record<string, string> = {
  heat_retention_device: "Wonderbox",
  pot_quantity: "Pots quantity",
  previous_stove_type: "Baseline stove",
  phone: "Telephone number",
  contact_person: "Buyer Name",
  terms_accepted: "CPA (Terms and Conditions)",
  retailer_branch: "Retailer/sales branch/agency",
};

function fieldsByKey(fields: DictionaryField[]): Map<string, DictionaryField> {
  return new Map(fields.map((f) => [f.key, f]));
}

/** The agreement's word for a field, from the JSON on disk. */
function words(key: string): string {
  const field = DICTIONARY.fields.find((f) => f.key === key);
  if (!field) throw new Error(`the dictionary has no field named ${key}`);
  return field.label;
}

function escapeForRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The label as it may read on a form: the agreement's words, and the " *" a
 * required field carries. Nothing else.
 *
 * `.first()` because a label's words usually sit inside a wrapper whose own
 * text is the same string, and both elements match.
 */
function labelOnForm(page: Page, key: string) {
  return page.getByText(new RegExp(`^\\s*${escapeForRegex(words(key))}\\s*\\*?\\s*$`)).first();
}

test("the dictionary endpoint serves the agreement's wording, and only to a signed-in user", async ({
  page,
}) => {
  await signIn(page, USERS.admin);

  const res = await getEdgeFunction(page, "sale-dictionary");
  expect(res.status, `sale-dictionary answered: ${JSON.stringify(res.body)}`).toBe(200);

  const served = res.body as Dictionary;
  expect(typeof served.version, "the dictionary states its version").toBe("string");
  expect(served.version.length, "the version is not empty").toBeGreaterThan(0);
  expect(Array.isArray(served.fields), "the dictionary carries a fields array").toBe(true);
  expect(served.fields.length, "the fields array is not empty").toBeGreaterThan(0);

  // Every field carries the whole shape. `payload` and `mandatoryFrom` must
  // say null rather than be absent: a reader that has to tell "no payload key"
  // from "nobody filled this in" is back to guessing.
  const malformed = served.fields.filter(
    (f) =>
      !(
        typeof f.key === "string" &&
        f.key.length > 0 &&
        typeof f.label === "string" &&
        f.label.length > 0 &&
        (typeof f.payload === "string" || f.payload === null) &&
        typeof f.type === "string" &&
        f.type.length > 0 &&
        typeof f.group === "string" &&
        f.group.length > 0 &&
        typeof f.order === "number" &&
        (typeof f.mandatoryFrom === "string" || f.mandatoryFrom === null)
      ),
  );
  expect(
    malformed.map((f) => f?.key ?? JSON.stringify(f)),
    "every field carries key, label, payload, type, group, order and mandatoryFrom",
  ).toEqual([]);

  // Every field belongs to a group the dictionary declares, so a form can
  // build its sections from the same source.
  const groupKeys = new Set(served.groups.map((g) => g.key));
  const orphans = served.fields.filter((f) => !groupKeys.has(f.group)).map((f) => f.key);
  expect(orphans, "every field sits in a declared group").toEqual([]);

  // The seven the paper renames, as served and as bundled. Both, because the
  // web app reads the file at build time and never calls this endpoint: if the
  // two ever drift, the phone app and the web app show different words.
  const servedFields = fieldsByKey(served.fields);
  const bundledFields = fieldsByKey(DICTIONARY.fields);
  for (const [key, label] of Object.entries(AGREEMENT_WORDS)) {
    expect(servedFields.get(key)?.label, `the endpoint should call ${key} "${label}"`).toBe(label);
    expect(bundledFields.get(key)?.label, `the bundled JSON should call ${key} "${label}"`).toBe(
      label,
    );
  }
  expect(served.version, "the endpoint serves the version the app bundled").toBe(
    DICTIONARY.version,
  );

  // The same URL, without a token. The dictionary holds nothing about anybody,
  // but it is the app's own vocabulary and it is not public.
  const anonymous = await page.evaluate(async () => {
    const key = Object.keys(window.localStorage).find(
      (k) => k.startsWith("sb-") && k.endsWith("-auth-token"),
    );
    const ref = (key ?? "").replace(/^sb-/, "").replace(/-auth-token$/, "");
    const response = await fetch(`https://${ref}.supabase.co/functions/v1/sale-dictionary`);
    return response.status;
  });
  expect(anonymous, "an unauthenticated read should be refused").toBe(401);
});

test("the Sell Stove form calls each field what the agreement calls it", async ({ page }) => {
  await signIn(page, USERS.admin);
  await page.goto("/sales/create");

  await expect(page.getByRole("heading", { name: /Record a New Sale/i })).toBeVisible({
    timeout: 30_000,
  });
  // The serial field is gated on the form having mounted rather than errored,
  // which is how non-interference.spec.ts knows this page is up.
  await expect(page.locator("#stoveSerialNo")).toBeVisible({ timeout: 30_000 });

  for (const key of [
    "heat_retention_device",
    "pot_quantity",
    "previous_stove_type",
    "phone",
    "contact_person",
    "terms_accepted",
  ]) {
    await expect(
      labelOnForm(page, key),
      `Sell Stove should call ${key} "${words(key)}"`,
    ).toBeVisible();
  }
});

/**
 * The bench, opened the way a typist opens it: Bulk Import, one receipt at a
 * time, a partner, a stove. There is no direct URL to a stove's form.
 *
 * The Kogi twin is seeded on every preview branch (organization
 * a0000000-0000-4000-8000-00000000000a) and is the partner every other bench
 * spec opens.
 */
const BENCH_PARTNER = "Twin Name Partner";

async function openTheBench(page: Page): Promise<boolean> {
  await page.goto("/data-center/import");
  await expect(page.getByRole("heading", { name: "Bulk Import" })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("button", { name: /One receipt at a time/ }).click();
  await expect(page.locator("tbody tr").first()).toBeVisible({ timeout: 30_000 });
  await page.getByPlaceholder("Search by name").fill(BENCH_PARTNER);
  const row = page
    .locator("tbody tr", { hasText: BENCH_PARTNER })
    .filter({ hasText: "Kogi" })
    .first();
  if ((await row.count()) === 0) return false;
  await row.click();
  await expect(page.getByText(/all consignments/).first()).toBeVisible({ timeout: 30_000 });
  await page.locator("tbody tr").first().click();
  await expect(page.locator("#wb-endUserName")).toBeVisible({ timeout: 30_000 });
  return true;
}

test("the Data Center bench calls each field what the agreement calls it", async ({ page }) => {
  await signIn(page, USERS.admin);
  const opened = await openTheBench(page);
  expect(opened, "the twin partner is not in the funnel on this database").toBe(true);

  // Nothing is typed and nothing is saved, so this test leaves no draft batch
  // behind and has nothing to clean up. Discarding here would take a batch a
  // parallel bench spec was still working on.
  for (const key of [
    "heat_retention_device",
    "pot_quantity",
    "previous_stove_type",
    "phone",
    "contact_person",
  ]) {
    await expect(
      labelOnForm(page, key),
      `the bench should call ${key} "${words(key)}"`,
    ).toBeVisible();
  }
});

test("the records table's column headers carry the agreement's wording", async ({ page }) => {
  await signIn(page, USERS.admin);
  await page.goto("/data-center/stove-records");

  // The header row renders whether or not any rows have loaded. "Sales rep"
  // names the transfer's rep, not an agreement field, so this slice leaves it
  // alone and it is the way in.
  const salesRep = page.getByText("Sales rep", { exact: true }).first();
  await expect(salesRep, "the records table should render its header").toBeVisible({
    timeout: 30_000,
  });
  const header = salesRep.locator("xpath=..");

  for (const key of ["stove_serial_no", "phone", "partner_name", "sales_date"]) {
    await expect(
      header.getByText(new RegExp(`^\\s*${escapeForRegex(words(key))}\\s*$`)),
      `the header should call ${key} "${words(key)}"`,
    ).toBeVisible();
  }

  // And the dialects are gone from the header, rather than sitting beside the
  // new words in a column somebody forgot to fold in.
  for (const old of ["Stove ID", "Phone", "Partner", "Sale Date"]) {
    await expect(
      header.getByText(new RegExp(`^\\s*${escapeForRegex(old)}\\s*$`)),
      `"${old}" should no longer be a column header`,
    ).toHaveCount(0);
  }
});
