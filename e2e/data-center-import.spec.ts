import { test, expect } from "@playwright/test";
import { signIn, USERS, callEdgeFunction } from "./helpers";

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
  test("super admin sees the panel, and no partner to pick", async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/import");

    await expect(page.getByRole("heading", { name: "Bulk Import" })).toBeVisible({
      timeout: 20_000,
    });
    // The dropdown of 278 partners is gone on purpose: every stove in stock
    // carries the partner it went to, so the file already knows and asking was
    // asking somebody to repeat what the data states and be wrong about it
    // occasionally.
    await expect(page.getByLabel("Partner")).toHaveCount(0);
    await expect(
      page.getByText(/stove IDs in the file say which partner it belongs to/),
    ).toBeVisible();

    // And choosing a file is available immediately. It used to wait on the
    // partner being picked; with nothing to pick, waiting would be waiting for
    // an event that never comes.
    await expect(page.getByRole("button", { name: /Choose a file/ })).toBeEnabled();
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
      page.getByText(/nothing is\s+committed until you say so/i),
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
    // No partner is chosen. The stove IDs in the file name it.
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
    await expect(page.getByText(/rows? of at most [\d,]+/)).toBeVisible();
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

    // By accessible name, not by label text. getByLabel reads the label's
    // textContent, which still carries the required asterisk even though the
    // span is aria-hidden, so an exact match on it never hits. The role is
    // spinbutton for the numeric fields and textbox for the rest.
    for (const [field, role] of [
      ["Stove serial number", "textbox"],
      ["First name", "textbox"],
      ["Phone number", "textbox"],
      ["Sale date", "textbox"],
      ["Amount", "spinbutton"],
      ["State", "textbox"],
      ["LGA", "textbox"],
      ["Address", "textbox"],
    ] as const) {
      await expect(
        page.getByRole(role, { name: field, exact: true }),
        `${field} should be labelled exactly, not "${field} *"`,
      ).toBeVisible();
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

  /**
   * A serial nobody has sold yet.
   *
   * Naming one and reusing it forever is a test with a shelf life: committing
   * a sale consumes the serial permanently, so the first run that commits
   * breaks every later run. Asking the sheet which are still free costs one
   * request and never goes stale.
   */
  async function freeSerial(page: import("@playwright/test").Page): Promise<string> {
    const funnel = await callEdgeFunction(page, "data-center-read", {
      action: "transfer_funnel",
      limit: 1,
    });
    const org = (funnel.body as { data: { rows: { organization_id: string }[] } })
      .data.rows[0].organization_id;
    const sheet = await callEdgeFunction(page, "data-center-read", {
      action: "digitisation_sheet",
      organizationId: org,
    });
    const free = (sheet.body as {
      data: { rows: { stove_id: string; already_recorded: boolean }[] };
    }).data.rows.find((r) => !r.already_recorded);
    if (!free) throw new Error("Every stove in the first transfer has been recorded");
    return free.stove_id;
  }

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
    // No partner is chosen. The stove IDs in the file name it.
  }

  test("the same serial twice in one file names the row it duplicates", async ({
    page,
  }, testInfo) => {
    await openImport(page);
    const marker = `dup${testInfo.workerIndex}-${testInfo.repeatEachIndex}-${Date.now()}`;
    const serial = await freeSerial(page);

    await page.locator('input[type="file"]').setInputFiles(
      receipt(marker, [serial, serial]),
    );

    // One row takes the stove and the other cannot. It used to import twice
    // and fail at commit with a stove-already-sold error, which reads as a
    // stock problem rather than the typing one it is.
    await expect(page.getByText(/1 ready, 1 need a look/)).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.getByText(new RegExp(`${serial}" already appears on row 1`)),
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

/**
 * Scope, asked of the server rather than the picker.
 *
 * The partner dropdown only offers what the caller may import for, and that is
 * presentation. The organization id arrives from the client, so the question
 * has to be answered again on the server or the dropdown is the only thing
 * standing between an editor and another partner's batch list.
 */
test.describe("staging is scoped to the caller's partners", () => {
  test("an editor cannot stage against a partner that is not theirs", async ({
    page,
  }) => {
    await signIn(page, USERS.callCentre);
    await page.goto("/data-center/import");
    await expect(page.getByRole("heading", { name: "Bulk Import" })).toBeVisible({
      timeout: 20_000,
    });

    // Which partners the server is willing to offer this caller.
    const partners = await callEdgeFunction(page, "data-center-import", {
      action: "partners",
    });
    const mine = new Set(
      ((partners.body as { data?: { id: string }[] })?.data ?? []).map((p) => p.id),
    );

    // Whichever seeded partner the picker did not offer. The fourth exists for
    // exactly this: the call centre account holds the other three, so without
    // one nobody is assigned there is nothing out of scope to reach for and
    // the check has nothing to prove itself against.
    const foreign = [
      "a0000000-0000-4000-8000-000000000004",
      "a0000000-0000-4000-8000-000000000003",
      "a0000000-0000-4000-8000-000000000002",
      "a0000000-0000-4000-8000-000000000001",
    ].find((id) => !mine.has(id));

    // Asking for a partner by id is the whole point: the picker would never
    // send this one, so only the server can refuse it.
    const stage = foreign
      ? await callEdgeFunction(page, "data-center-import", {
          action: "stage",
          organizationId: foreign,
          filename: "not-mine.csv",
          rows: [{
            stove_serial_no: "PRV000003", first_name: "Test", phone: "08012345678",
            sales_date: "2026-01-04", amount: "25000", state: "Gombe",
            lga: "Gombe", address: "1 Test Road",
          }],
        })
      : null;

    // If the editor legitimately holds every seeded partner the test proves
    // nothing, so say so rather than passing quietly.
    expect(
      stage,
      `this editor holds every seeded partner (${[...mine].join(", ")}), ` +
        "so there is nothing out of scope to try",
    ).not.toBeNull();
    expect(stage!.status).toBe(400);
    expect(JSON.stringify(stage!.body)).toMatch(/not one you can import for/);
  });
});

/**
 * What the change to the import is actually for.
 *
 * The partner came from a dropdown of 278 and never needed to; phone numbers
 * were checked by one regex that refused most of the ways a real spreadsheet
 * writes a correct number; and a refused row said what was wrong and never what
 * to do about it.
 */
test.describe("the file names its own partner", () => {
  test("a sheet downloaded for a partner uploads without choosing one", async ({
    page,
  }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/import");
    await expect(page.getByRole("heading", { name: "Bulk Import" })).toBeVisible({
      timeout: 20_000,
    });

    // The sheet the digitisers get, taken the way Partner Records hands it out.
    const funnel = await callEdgeFunction(page, "data-center-read", {
      action: "transfer_funnel",
      limit: 1,
    });
    const transfer = (funnel.body as {
      data: { rows: { organization_id: string; partner_name: string }[] };
    }).data.rows[0];

    const sheet = await callEdgeFunction(page, "data-center-read", {
      action: "digitisation_sheet",
      organizationId: transfer.organization_id,
    });
    expect(sheet.status).toBe(200);
    const available = (sheet.body as {
      data: { rows: { stove_id: string; transaction_id: string; already_recorded: boolean }[] };
    }).data.rows.filter((r) => !r.already_recorded);
    test.skip(available.length < 2, "No unrecorded stoves left in the first transfer");

    // Filled in the way a spreadsheet really produces it: the leading zero of
    // the phone eaten by Excel, and the headings the sheet itself carries.
    const rows = available.slice(0, 2).map((r, i) => ({
      "Stove ID": r.stove_id,
      "Transaction ID": r.transaction_id,
      "User First Name": `E2E${i}`,
      "User Last Name": "Partner-From-File",
      "Primary Phone Number": i === 0 ? "8039876543" : "+234 803 987 6544",
      "Sales Date": "2026-07-20",
      "Sale Amount": "47500",
      "Amount Received": "47500",
      "State": "Gombe",
      "LGA": "Akko",
      "User Residential Address": "1 E2E Street",
    }));

    const staged = await callEdgeFunction(page, "data-center-import", {
      action: "stage",
      rows,
      filename: "e2e-partner-from-file.csv",
      confirmDuplicate: true,
    });
    expect(staged.status).toBe(200);
    const data = (staged.body as {
      data: {
        batchId: string;
        resolvedPartner: { partnerName: string; matched: number; unmatched: number } | null;
      };
    }).data;

    // It worked the partner out, and says so rather than leaving it implied.
    expect(data.resolvedPartner?.partnerName).toBe(transfer.partner_name);
    expect(data.resolvedPartner?.matched).toBe(2);
    expect(data.resolvedPartner?.unmatched).toBe(0);

    // Both phones were written differently and neither is 0XXXXXXXXXX.
    const validated = await callEdgeFunction(page, "data-center-import", {
      action: "validate",
      batchId: data.batchId,
    });
    expect((validated.body as { data: { valid: number } }).data.valid).toBe(2);

    await callEdgeFunction(page, "data-center-import", {
      action: "rollback",
      batchId: data.batchId,
    });
  });

  test("serials that match nothing are refused with a reason, not a guess", async ({
    page,
  }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/import");
    await expect(page.getByRole("heading", { name: "Bulk Import" })).toBeVisible({
      timeout: 20_000,
    });

    const junk = await callEdgeFunction(page, "data-center-import", {
      action: "stage",
      confirmDuplicate: true,
      filename: "e2e-junk.csv",
      rows: [{ "Stove ID": "NOT-A-REAL-STOVE-ID", "Primary Phone Number": "08039876543" }],
    });
    expect(junk.status).toBe(400);
    // Naming a partner anyway would be a guess, and a guess here files a sale
    // against somebody who never made it.
    expect((junk.body as { error: string }).error).toMatch(/do not match|match stock we hold/i);
  });
});

test.describe("a rejected row says what to do about it", () => {
  test("every refusal carries a fix, not just a reason", async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/import");
    await expect(page.getByRole("heading", { name: "Bulk Import" })).toBeVisible({
      timeout: 20_000,
    });

    const funnel = await callEdgeFunction(page, "data-center-read", {
      action: "transfer_funnel",
      limit: 1,
    });
    const transfer = (funnel.body as { data: { rows: { organization_id: string }[] } }).data.rows[0];
    const sheet = await callEdgeFunction(page, "data-center-read", {
      action: "digitisation_sheet",
      organizationId: transfer.organization_id,
    });
    const available = (sheet.body as {
      data: { rows: { stove_id: string; transaction_id: string; already_recorded: boolean }[] };
    }).data.rows.filter((r) => !r.already_recorded);
    test.skip(available.length < 2, "No unrecorded stoves left to work with");

    const base = {
      "User First Name": "E2E",
      "User Last Name": "Hints",
      "Sales Date": "2026-07-20",
      "Sale Amount": "47500",
      "State": "Gombe",
      "LGA": "Akko",
      "User Residential Address": "1 E2E Street",
    };
    const staged = await callEdgeFunction(page, "data-center-import", {
      action: "stage",
      confirmDuplicate: true,
      filename: "e2e-hints.csv",
      rows: [
        // A number that really is broken, and a date nobody can read.
        { ...base, "Stove ID": available[0].stove_id, "Primary Phone Number": "0803216454" },
        {
          ...base,
          "Stove ID": available[1].stove_id,
          "Primary Phone Number": "08039876543",
          "Sales Date": "not a date",
        },
      ],
    });
    expect(staged.status).toBe(200);
    const batchId = (staged.body as { data: { batchId: string } }).data.batchId;

    await callEdgeFunction(page, "data-center-import", { action: "validate", batchId });
    const rows = await callEdgeFunction(page, "data-center-import", {
      action: "rows",
      batchId,
      status: "rejected",
    });
    const rejected = (rows.body as {
      data: { rejection_reason: string | null; rejection_hint: string | null }[];
    }).data;

    expect(rejected.length).toBe(2);
    for (const r of rejected) {
      expect(r.rejection_reason).toBeTruthy();
      // The reason alone leaves a digitiser with four hundred rows and no next
      // step, which is how a rejection file gets ignored rather than corrected.
      expect(r.rejection_hint).toBeTruthy();
      expect(r.rejection_hint!.length).toBeGreaterThan(20);
    }

    await callEdgeFunction(page, "data-center-import", { action: "rollback", batchId });
  });
});

/**
 * The sheet goes out as a workbook and comes back as one.
 *
 * A CSV cannot carry a dropdown, and a blank cell under "Previous Stove Type"
 * gets "Charcoal stove", "CHARCOAL" and "chacoal" typed into it - every one a
 * row the import refuses for a value the typist had no way of knowing. These
 * hold the round trip, in a real browser, because the writer and the reader are
 * both hand-rolled and a unit test of either alone would prove half of it.
 */
test.describe("the digitalisation sheet is a workbook", () => {
  test("the sheet downloads, and the same file uploads back", async ({ page }) => {
    await signIn(page, USERS.admin);

    // Download it the way a digitiser does: from the partner they are looking
    // at. Going through the real button is the point - the writer and the
    // reader are both hand-rolled, and testing either alone proves half a
    // round trip.
    await page.goto("/data-center/partner-records");
    await expect(
      page.getByRole("heading", { name: "Partner Records", exact: true }).first(),
    ).toBeVisible({ timeout: 20_000 });
    await page.getByRole("row").nth(1).click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: /Sheet for digitalisation/ }).click();
    await expect(page.getByText("What the sheet contains")).toBeVisible({ timeout: 20_000 });

    // The choices are stated on the way out, so a typist knows before opening
    // the file that these columns are lists.
    await expect(page.getByText(/Pick from a list/)).toBeVisible();
    await expect(page.getByText(/charcoal, wood_stove, other/)).toBeVisible();

    const waitForDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: /Download .* \(xlsx\)/ }).click();
    const download = await waitForDownload;
    const path = await download.path();
    expect(download.suggestedFilename()).toMatch(/\.xlsx$/);
    expect(path).toBeTruthy();

    // And back in through the uploader, which parses it with the module's own
    // reader in a real browser. Node has no DOMParser, so this is the only
    // place that code can run at all.
    await page.goto("/data-center/import");
    await expect(page.getByRole("heading", { name: "Bulk Import" })).toBeVisible({
      timeout: 20_000,
    });
    await page.locator('input[type="file"]').setInputFiles(path!);

    /**
     * The sheet is downloaded empty of buyers, so every row is refused for
     * having no name. That is the correct outcome and it is what is being
     * asserted: the workbook was opened, its rows were read, and each one was
     * judged. A file that could not be opened says so instead, in a different
     * sentence.
     */
    await expect(
      page.getByText(/rows staged|could not be read|has headings and no rows/),
    ).toBeVisible({ timeout: 40_000 });
    await expect(page.getByText(/cannot open .xlsx/)).toHaveCount(0);
  });

  test("the sheet's columns come from settings, not from the code", async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/import");
    await expect(page.getByRole("heading", { name: "Bulk Import" })).toBeVisible({
      timeout: 20_000,
    });

    const funnel = await callEdgeFunction(page, "data-center-read", {
      action: "transfer_funnel",
      limit: 1,
    });
    const transfer = (funnel.body as { data: { rows: { organization_id: string }[] } }).data.rows[0];

    const sheet = await callEdgeFunction(page, "data-center-read", {
      action: "digitisation_sheet",
      organizationId: transfer.organization_id,
    });
    const data = (sheet.body as {
      data: {
        columns: { field: string; header: string; options?: string[]; locked?: boolean }[];
        format: string;
      };
    }).data;

    // Editable in Settings rather than compiled in, which is what stops the
    // sheet and the form drifting apart.
    expect(data.columns.length).toBeGreaterThan(20);
    expect(data.format).toBe("xlsx");

    const byField = Object.fromEntries(data.columns.map((c) => [c.field, c]));
    // The three the transfer already knows are locked, so nobody types a serial.
    expect(byField.stoveSerialNo.locked).toBe(true);
    expect(byField.transactionId.locked).toBe(true);
    // And the choices match the form's exactly, which is the whole point of
    // sending them rather than letting each side keep its own list.
    expect(byField.previousStoveType.options).toEqual(["charcoal", "wood_stove", "other"]);
    expect(byField.potQuantity.options).toEqual(["0", "1", "2"]);
  });

  test("a workbook uploads where a CSV did", async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/import");
    await expect(page.getByRole("heading", { name: "Bulk Import" })).toBeVisible({
      timeout: 20_000,
    });

    // Both formats are offered, and the button no longer says CSV only.
    const input = page.locator('input[type="file"]');
    await expect(input).toHaveAttribute("accept", /\.xlsx/);
    await expect(input).toHaveAttribute("accept", /\.csv/);
    await expect(page.getByRole("button", { name: /Choose a file/ })).toBeVisible();
  });
});
