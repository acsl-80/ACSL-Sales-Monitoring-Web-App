import { test, expect, type Page } from "@playwright/test";
import { signIn, USERS, callEdgeFunction } from "./helpers";

/**
 * The stove record: one serial, everything that ever happened to it.
 *
 * The module's other surfaces answer questions about populations - which
 * partners are behind, which agents are busy. This one answers the question
 * people actually walk over and ask, and the thing worth testing is that it
 * genuinely gathers from every source rather than showing the same transfer
 * row the partner drill already showed.
 */

/** A serial that exists, asked of the data rather than hard-coded. */
async function aSoldSerial(page: Page): Promise<string> {
  const records = await callEdgeFunction(page, "data-center-read", {
    action: "records",
    limit: 1,
  });
  const rows = (records.body as { data: { rows: { stove_serial_no: string }[] } }).data.rows;
  if (rows.length === 0) throw new Error("The preview holds no sales to open");
  return rows[0].stove_serial_no;
}

test.describe("one stove ID anchors the whole module", () => {
  test("the record gathers the transfer, the sale and the history", async ({ page }) => {
    await signIn(page, USERS.admin);
    const serial = await aSoldSerial(page);

    await page.goto(`/data-center/stove/${serial}`);

    // The serial is the title, not a field buried in a panel.
    await expect(page.getByRole("heading", { name: serial })).toBeVisible({ timeout: 20_000 });

    // Every thread has a section, whether or not it has anything in it. A
    // record with no calls says so; it does not quietly omit the heading and
    // leave the reader unsure whether it was asked.
    for (const section of [
      "Where it came from",
      "The transfer",
      "The sale",
      "Verification",
      "Every call",
      "How it got here",
      "Everything that changed",
    ]) {
      await expect(page.getByRole("heading", { name: section })).toBeVisible();
    }

    // The journey is the module's own funnel, restated for one stove.
    for (const stage of ["Issued", "Transferred", "Sold", "Typed up", "Called", "Verified"]) {
      await expect(page.getByText(stage, { exact: true }).first()).toBeVisible();
    }
  });

  test("the names on it are doors, not text", async ({ page }) => {
    await signIn(page, USERS.admin);
    const serial = await aSoldSerial(page);
    await page.goto(`/data-center/stove/${serial}`);
    await expect(page.getByRole("heading", { name: serial })).toBeVisible({ timeout: 20_000 });

    /**
     * The partner opens Partner Records AT that partner, rather than at the
     * list of 278 with the partner somewhere in it.
     *
     * Located by destination rather than by name: the link's accessible name
     * is the partner's own name, which is correct - "Open this partner" is a
     * tooltip, and a link whose spoken name was its tooltip would stop
     * matching what a voice-control user actually says.
     */
    const partner = page
      .locator('a[href*="/data-center/partner-records"][href*="organizationId="]')
      .first();
    await expect(partner).toBeVisible();
    expect((await partner.textContent())?.trim()).toBeTruthy();

    await partner.click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 20_000 });
  });

  test("the consignment it travelled on is one click away, and its neighbours open", async ({
    page,
  }) => {
    await signIn(page, USERS.admin);
    const serial = await aSoldSerial(page);
    await page.goto(`/data-center/stove/${serial}`);
    await expect(page.getByRole("heading", { name: serial })).toBeVisible({ timeout: 20_000 });

    await page.getByRole("button", { name: /The rest of/ }).click();
    // Its own serial is present but is not a link: you are already on it.
    const neighbours = page.locator('a[href^="/data-center/stove/"]');
    await expect(neighbours.first()).toBeVisible({ timeout: 20_000 });

    const firstHref = await neighbours.first().getAttribute("href");
    expect(firstHref).not.toBe(`/data-center/stove/${serial}`);
    await neighbours.first().click();
    // Landing on a different record, which is what makes this a web rather
    // than a page.
    await expect(page).toHaveURL(/\/data-center\/stove\//);
    await expect(page.getByRole("heading", { name: /^PRV/ })).toBeVisible({ timeout: 20_000 });
  });

  test("the record exports as one row, with the columns picked", async ({ page }) => {
    await signIn(page, USERS.admin);
    const serial = await aSoldSerial(page);
    await page.goto(`/data-center/stove/${serial}`);
    await expect(page.getByRole("heading", { name: serial })).toBeVisible({ timeout: 20_000 });

    /**
     * Exercised through the real button rather than by inspecting the shape.
     * ExportButton takes `rows` as a thunk and calls it; passing the array
     * itself typechecks, renders, and throws the moment somebody clicks - a
     * whole class of defect that only a real click finds.
     */
    const waitForDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export this record" }).click();
    const download = await waitForDownload;
    expect(download.suggestedFilename()).toBe(`stove-${serial}.csv`);

    const path = await download.path();
    const text = await import("node:fs/promises").then((fs) => fs.readFile(path!, "utf8"));
    const [header, row] = text.trim().split(/\r?\n/);
    expect(header).toContain("stove id");
    expect(row).toContain(serial);
  });

  test("a serial nobody has says so, and offers a way on", async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/stove/PRV999999");

    await expect(page.getByText(/There is no stove with the ID PRV999999/)).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole("link", { name: "Search the register" })).toBeVisible();
  });
});

test.describe("the finder takes either of the two things written on paper", () => {
  test("an exact serial opens the record rather than listing one result", async ({ page }) => {
    await signIn(page, USERS.admin);
    const serial = await aSoldSerial(page);

    await page.goto("/data-center");
    await expect(page.getByRole("heading", { name: "Data Center" })).toBeVisible({
      timeout: 20_000,
    });

    await page.getByLabel("Stove ID or transfer reference").fill(serial);
    await page.getByRole("button", { name: "Find it" }).click();

    await expect(page).toHaveURL(new RegExp(`/data-center/stove/${serial}`), {
      timeout: 20_000,
    });
  });

  test("a partial serial is a shortlist, not a refusal", async ({ page }) => {
    await signIn(page, USERS.admin);
    const serial = await aSoldSerial(page);

    await page.goto("/data-center/stove-records");
    await expect(page.getByLabel("Stove ID or transfer reference")).toBeVisible({
      timeout: 20_000,
    });

    await page.getByLabel("Stove ID or transfer reference").fill(serial.slice(0, 5));
    await page.getByRole("button", { name: "Find it" }).click();

    await expect(page.getByText(/\d+ stoves/)).toBeVisible({ timeout: 20_000 });
  });

  test("a transfer reference finds the consignment", async ({ page }) => {
    await signIn(page, USERS.admin);
    const funnel = await callEdgeFunction(page, "data-center-read", {
      action: "transfer_funnel",
      limit: 1,
    });
    const txn = (funnel.body as { data: { rows: { transaction_id: string }[] } }).data.rows[0]
      .transaction_id;

    await page.goto("/data-center");
    await expect(page.getByLabel("Stove ID or transfer reference")).toBeVisible({
      timeout: 20_000,
    });
    await page.getByLabel("Stove ID or transfer reference").fill(txn);
    await page.getByRole("button", { name: "Find it" }).click();

    await expect(page.getByText(/\d+ consignments?/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(txn, { exact: true })).toBeVisible();
  });

  test("nothing found explains what to try, rather than showing an empty list", async ({
    page,
  }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center");
    await expect(page.getByLabel("Stove ID or transfer reference")).toBeVisible({
      timeout: 20_000,
    });

    await page.getByLabel("Stove ID or transfer reference").fill("ZZZNOTHING");
    await page.getByRole("button", { name: "Find it" }).click();

    await expect(page.getByText(/Nothing matches/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/an O typed as a zero/)).toBeVisible();
  });

  test("the serial in the records table opens the record", async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/stove-records");
    await expect(page.getByRole("heading", { name: "Stove Records" })).toBeVisible({
      timeout: 20_000,
    });

    const serial = page.locator('a[href^="/data-center/stove/"]').first();
    await expect(serial).toBeVisible({ timeout: 20_000 });
    const text = (await serial.textContent())?.trim();
    await serial.click();

    await expect(page.getByRole("heading", { name: text! })).toBeVisible({ timeout: 20_000 });
  });
});

test.describe("one period, asked the same way on every surface", () => {
  test("the default is this year, and it is stated rather than implied", async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/stove-records");

    const year = new Date().getFullYear();
    await expect(
      page.getByRole("button", { name: new RegExp(`showing sales for ${year}`) }),
    ).toBeVisible({ timeout: 20_000 });
  });

  test("choosing a period puts it in the URL, so the view can be sent to somebody", async ({
    page,
  }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/stove-records");

    await page
      .getByRole("button", { name: /showing sales for/ })
      .click();
    await page.getByRole("button", { name: "Last 30 days", exact: true }).click();

    await expect(page).toHaveURL(/period=last30/, { timeout: 20_000 });
    await expect(
      page.getByRole("button", { name: /showing sales for the last 30 days/ }),
    ).toBeVisible();

    // And it survives a reload, which is the whole point of it being a URL.
    await page.reload();
    await expect(
      page.getByRole("button", { name: /showing sales for the last 30 days/ }),
    ).toBeVisible({ timeout: 20_000 });
  });

  test("years can be picked several at a time, and a gap is admitted", async ({ page }) => {
    await signIn(page, USERS.admin);
    // Two years apart, so the control has to say what a range really covers.
    await page.goto("/data-center/stove-records?period=years:2024,2026");

    await expect(
      page.getByRole("button", { name: /showing sales for 2024, 2026/ }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/includes 2025 as well/)).toBeVisible();
  });

  test("Partner Records takes the same control, on the consignment date", async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/partner-records");
    await expect(
      page.getByRole("heading", { name: "Partner Records", exact: true }).first(),
    ).toBeVisible({ timeout: 20_000 });

    await expect(
      page.getByRole("button", { name: /showing consignments for/ }),
    ).toBeVisible();

    // Everything, then a single day: the narrower period cannot show more.
    await page.goto("/data-center/partner-records?period=all");
    await expect(page.getByRole("button", { name: /showing consignments for every date/ }))
      .toBeVisible({ timeout: 20_000 });
    const everything = await page.getByRole("row").count();

    await page.goto("/data-center/partner-records?period=today");
    await expect(page.getByRole("button", { name: /showing consignments for today/ }))
      .toBeVisible({ timeout: 20_000 });
    const oneDay = await page.getByRole("row").count();

    expect(oneDay).toBeLessThanOrEqual(everything);
  });

  test("a nonsense period falls back to the default rather than breaking the page", async ({
    page,
  }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/stove-records?period=notaperiod");

    const year = new Date().getFullYear();
    await expect(
      page.getByRole("button", { name: new RegExp(`showing sales for ${year}`) }),
    ).toBeVisible({ timeout: 20_000 });
  });
});

test.describe("one stove, one owner, one phone", () => {
  test("the register holds no serial or phone twice", async ({ page }) => {
    await signIn(page, USERS.admin);

    /**
     * The rule is enforced at the only door a sale comes through: create-sale
     * refuses a serial already marked sold, and refuses a phone whose last ten
     * digits are already live. This asserts the outcome rather than the code
     * path, because the outcome is what anybody would check.
     *
     * Read through the module's own surface, so a violation introduced by any
     * writer at all - the sales app, the mobile app, an import - is caught.
     */
    const page1 = await callEdgeFunction(page, "data-center-read", {
      action: "records",
      limit: 500,
    });
    const rows = (page1.body as {
      data: { rows: { stove_serial_no: string; primary_phone: string | null }[] };
    }).data.rows;

    const serials = new Map<string, number>();
    const phones = new Map<string, number>();
    for (const r of rows) {
      const serial = (r.stove_serial_no ?? "").trim().toUpperCase();
      if (serial) serials.set(serial, (serials.get(serial) ?? 0) + 1);
      // The last ten digits, exactly as create-sale compares: the country code
      // must make no difference, so +234 803..., 234 803... and 0803... are
      // one subscriber.
      const tail = (r.primary_phone ?? "").replace(/\D+/g, "").slice(-10);
      if (tail.length === 10) phones.set(tail, (phones.get(tail) ?? 0) + 1);
    }

    const serialClashes = [...serials.entries()].filter(([, n]) => n > 1);
    const phoneClashes = [...phones.entries()].filter(([, n]) => n > 1);

    expect(serialClashes, `serials on more than one sale: ${JSON.stringify(serialClashes)}`)
      .toHaveLength(0);
    expect(phoneClashes, `phones on more than one sale: ${JSON.stringify(phoneClashes)}`)
      .toHaveLength(0);
  });

  test("the record carries the check, so a violation would be visible", async ({ page }) => {
    await signIn(page, USERS.admin);
    const serial = await aSoldSerial(page);

    const detail = await callEdgeFunction(page, "data-center-read", {
      action: "stove_detail",
      stoveId: serial,
    });
    const data = (detail.body as { data: { phoneTwins: unknown[] } }).data;

    // Present and empty is the healthy answer. Absent would mean the page had
    // quietly stopped asking, which is the failure this guards.
    expect(Array.isArray(data.phoneTwins)).toBe(true);
    expect(data.phoneTwins).toHaveLength(0);
  });
});
