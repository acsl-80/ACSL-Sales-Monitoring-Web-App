import { test, expect } from "@playwright/test";
import { signIn, USERS } from "./helpers";

/**
 * Bulk import through the real UI.
 *
 * The path itself (stage, validate, dry run, commit, rollback, and the race
 * between two imports for one stove) is proven against the server and written
 * up in src/app/data-center/IMPORT.md. That work needs 500,000 rows and real
 * stock, which the preview branch does not have.
 *
 * What these tests prove is the part that only the browser can show: that the
 * panel renders, that committing is gated separately from uploading, and that
 * nothing offers to move stock to someone who may not.
 */

test.describe("bulk import", () => {
  test("super admin sees the panel and the partner picker", async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/import");

    await expect(page.getByRole("heading", { name: "Bulk Import" })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByLabel("Partner")).toBeVisible();

    // Choosing a file is refused until a partner is picked, because the stove
    // has to belong to someone and create-sale would refuse it anyway.
    await expect(page.getByRole("button", { name: /Choose a CSV/ })).toBeDisabled();
  });

  test("the panel says nothing is committed until asked", async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/import");
    await expect(page.getByRole("heading", { name: "Bulk Import" })).toBeVisible({
      timeout: 20_000,
    });

    // The promise the whole four-step shape exists to keep, stated where the
    // operator will read it.
    await expect(
      page.getByText(/Nothing is committed until you say so/),
    ).toBeVisible();
  });

  test("an editor can stage but is not offered commit", async ({ page }) => {
    await signIn(page, USERS.callCentre);
    await page.goto("/data-center/import");

    // The editor level carries import.upload and import.exceptions, and
    // deliberately not import.commit: staging and correcting are clerical,
    // committing changes live inventory.
    await expect(page.getByRole("heading", { name: "Bulk Import" })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole("button", { name: /^Commit / })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Roll back / })).toHaveCount(0);
  });

  test("a viewer reaching import by URL is refused", async ({ page }) => {
    await signIn(page, USERS.manager);
    await page.goto("/data-center/import");

    // The viewer level carries no import feature. Since Phase 9 import has its
    // own route, so this is a refusal page rather than an absent panel, which
    // is the stronger statement: the surface never renders at all.
    await expect(
      page.getByRole("heading", { name: "Not part of your access" }),
    ).toBeVisible({ timeout: 20_000 });
    // The panel itself never renders, so its export button is absent too.
    await expect(page.getByRole("button", { name: /Choose a CSV/ })).toHaveCount(0);
  });
});

/**
 * Phase 8b: the ways an import used to fail quietly.
 *
 * Each of these was a real silent failure. A column nobody recognised was
 * dropped without a word, the same file uploaded twice made two sets of sales,
 * and a single receipt had no way in at all short of building a one-line
 * spreadsheet, which is a workaround people do not perform.
 */
test.describe("import hardening", () => {
  const csv = (headers: string, ...rows: string[]) =>
    ({
      name: "receipts.csv",
      mimeType: "text/csv",
      buffer: Buffer.from([headers, ...rows].join("\n")),
    });

  async function openImport(page: import("@playwright/test").Page) {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/import");
    await expect(page.getByRole("heading", { name: "Bulk Import" })).toBeVisible({
      timeout: 20_000,
    });
    await page.getByLabel("Partner").selectOption({ index: 1 });
  }

  test("a file with a column nobody recognises stops to be mapped", async ({ page }) => {
    await openImport(page);

    await page.locator('input[type="file"]').setInputFiles(
      csv(
        "stove_serial_no,first_name,Mobile No.,sales_date,amount,state,lga,address",
        "SA000000A1,Test,08012345678,2026-01-04,25000,Lagos,Ikeja,1 Test Road",
      ),
    );

    // The whole point: it says what it did not understand before writing
    // anything, and offers somewhere to put it.
    await expect(page.getByText("What this file looks like")).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole("combobox", { name: "Map column Mobile No." })).toBeVisible();
    await expect(page.getByRole("button", { name: "Stage and check" })).toBeVisible();
  });

  test("the row cap is stated before an upload, not discovered after it", async ({ page }) => {
    await openImport(page);

    await page.locator('input[type="file"]').setInputFiles(
      csv("stove_serial_no,Colour", "SA000000A1,Red"),
    );

    await expect(page.getByText("What this file looks like")).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText(/row\(s\) of at most [\d,]+/)).toBeVisible();
  });

  test("a required field nothing feeds is named before staging", async ({ page }) => {
    await openImport(page);

    // No phone column, under any spelling. Every row would be rejected for it,
    // and the operator should hear that now rather than from the results.
    await page.locator('input[type="file"]').setInputFiles(
      csv(
        "stove_serial_no,first_name,sales_date,amount,state,lga,address",
        "SA000000A1,Test,2026-01-04,25000,Lagos,Ikeja,1 Test Road",
      ),
    );

    await expect(page.getByText(/Nothing feeds .*Phone number/)).toBeVisible({
      timeout: 20_000,
    });
  });

  test("one record can be typed rather than uploaded", async ({ page }) => {
    await openImport(page);

    await page.getByRole("button", { name: "Type one record" }).click();

    // Exact labels: "Amount" also prefixes "Amount received", and a loose
    // matcher there would pass on the wrong field.
    for (const field of [
      "Stove serial number", "First name", "Phone number", "Sale date",
      "Amount", "State", "LGA", "Address",
    ]) {
      await expect(page.getByLabel(field, { exact: true })).toBeVisible();
    }
    await expect(page.getByRole("button", { name: "Stage this record" })).toBeVisible();
  });

  test("an editor is offered manual entry too, since it is staging", async ({ page }) => {
    await signIn(page, USERS.callCentre);
    await page.goto("/data-center/import");
    await expect(page.getByRole("heading", { name: "Bulk Import" })).toBeVisible({
      timeout: 20_000,
    });

    // Manual entry stages; it does not commit. So it follows import.upload,
    // the same grant the file path follows, and not import.commit.
    await expect(page.getByRole("button", { name: "Type one record" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Commit / })).toHaveCount(0);
  });

  test("a viewer is offered neither way in", async ({ page }) => {
    await signIn(page, USERS.manager);
    await page.goto("/data-center/import");

    await expect(
      page.getByRole("heading", { name: "Not part of your access" }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Type one record" })).toHaveCount(0);
  });
});

/**
 * The two silent failures, proven against the real server.
 *
 * These stage rows on the preview branch. Staging writes nothing to
 * public.sales, so nothing here changes inventory; committing is a separate
 * step these tests never take.
 *
 * Every file carries a unique marker, because the duplicate-upload check
 * hashes the parsed rows: a fixed file would match the previous run and the
 * second test would pass for the wrong reason.
 */
test.describe("import hardening, against the server", () => {
  // Seeded stock on the preview branch, and its transfer. Both were verified
  // present before these tests were written; if the branch is reseeded with
  // different serials, this is the line to change.
  const PARTNER = "Amina Sales Model Gombe";
  const SERIAL = "PRV000003";

  const receipt = (marker: string, serials: string[]) => ({
    name: `receipts-${marker}.csv`,
    mimeType: "text/csv",
    buffer: Buffer.from(
      [
        "stove_serial_no,first_name,last_name,phone,sales_date,amount,state,lga,address",
        ...serials.map(
          (s) =>
            `${s},Test,Buyer,08012345678,2026-01-04,25000,Gombe,Gombe,${marker} Test Road`,
        ),
      ].join("\n"),
    ),
  });

  async function openImport(page: import("@playwright/test").Page) {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/import");
    await expect(page.getByRole("heading", { name: "Bulk Import" })).toBeVisible({
      timeout: 20_000,
    });
    await page.getByLabel("Partner").selectOption({ label: PARTNER });
  }

  test("the same serial twice in one file names the row it duplicates", async ({
    page,
  }, testInfo) => {
    await openImport(page);
    const marker = `dup${testInfo.workerIndex}-${testInfo.repeatEachIndex}-${Date.now()}`;

    await page.locator('input[type="file"]').setInputFiles(
      receipt(marker, [SERIAL, SERIAL]),
    );

    // One row takes the stove and the other cannot. It used to import twice
    // and fail at commit with a stove-already-sold error, which reads as a
    // stock problem rather than the typing one it is.
    await expect(page.getByText(/1 ready, 1 need a look/)).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.getByText(new RegExp(`${SERIAL}" already appears on row 1`)),
    ).toBeVisible({ timeout: 20_000 });
  });

  test("a valid row is tied to the transfer it came from", async ({ page }, testInfo) => {
    await openImport(page);
    const marker = `link${testInfo.workerIndex}-${Date.now()}`;

    await page.locator('input[type="file"]').setInputFiles(receipt(marker, [SERIAL]));

    // Which consignment a record belongs to, resolved at validate through the
    // same chain Partner Records counts. Without it a record and the funnel
    // could disagree about its parent.
    await expect(page.getByText(/1 matched to a transfer/)).toBeVisible({
      timeout: 30_000,
    });
  });

  test("uploading the same file twice warns instead of importing it twice", async ({
    page,
  }, testInfo) => {
    await openImport(page);
    const marker = `same${testInfo.workerIndex}-${Date.now()}`;
    const file = receipt(marker, [SERIAL]);

    await page.locator('input[type="file"]').setInputFiles(file);
    await expect(page.getByText(/rows staged/)).toBeVisible({ timeout: 30_000 });

    await page.locator('input[type="file"]').setInputFiles(file);

    // A warning, never a block. A partner can legitimately return the same
    // serials after a correction, and refusing that outright sends someone off
    // to edit the file until it is accepted.
    await expect(page.getByText(/was already staged on/)).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole("button", { name: "Upload it again" })).toBeVisible();
  });
});
