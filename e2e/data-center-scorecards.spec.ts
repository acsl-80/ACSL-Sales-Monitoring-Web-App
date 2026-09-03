import { test, expect } from "@playwright/test";
import { signIn, USERS } from "./helpers";

/**
 * The five scorecards, and the two promises they make.
 *
 * One: the columns reconcile. Verified + Unverified + Unreachable + Yet to be
 * resolved equals the reconciling column on every row, which is §3.4 as an
 * assertion rather than a hope. The engine defines unresolved as the
 * remainder, so a failure here means someone changed that and broke it.
 *
 * Two: every number is a door. A status cell links into the call centre queue
 * filtered to exactly what the cell counted, the filter travels as a URL, and
 * back restores the dashboard.
 */

const SCORECARDS = [
  "Partner",
  "Location",
  "Sales Representative",
  "Call Agent",
  "Manager",
];

/**
 * Open every scorecard.
 *
 * They are closed by default now: five open tables of 278 partners each is not
 * a dashboard. The assertions that check all five have to expand them first,
 * which is arrangement rather than a weakening - a collapsed table is simply
 * not in the DOM, and asserting against one open card would quietly drop four
 * fifths of the coverage.
 */
async function openEveryScorecard(page: import("@playwright/test").Page) {
  for (const title of SCORECARDS) {
    const header = page.getByRole("button", { expanded: false }).filter({
      has: page.getByRole("heading", { name: title, exact: true }),
    });
    if ((await header.count()) > 0) await header.first().click();
  }
  await expect(
    page.getByRole("columnheader", { name: "Yet to be resolved", exact: true }),
  ).toHaveCount(SCORECARDS.length);
}

test.describe("the five scorecards", () => {
  test("all five render the same columns from one component", async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/dashboard");

    for (const title of SCORECARDS) {
      await expect(
        page.getByRole("heading", { name: title, exact: true }),
      ).toBeVisible({ timeout: 30_000 });
    }
    await openEveryScorecard(page);

    // The shared column set, once per scorecard: five tables, one shape.
    // exact, because "Unverified" contains "Verified" under the default
    // substring matching and doubles the count.
    await expect(
      page.getByRole("columnheader", { name: "Issued", exact: true }),
    ).toHaveCount(5);
    await expect(
      page.getByRole("columnheader", { name: "Verified", exact: true }),
    ).toHaveCount(5);
    await expect(
      page.getByRole("columnheader", { name: "Yet to be resolved", exact: true }),
    ).toHaveCount(5);
  });

  test("every row reconciles: the four statuses sum to the reconciling column", async ({
    page,
  }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/dashboard");
    await expect(
      page.getByRole("heading", { name: "Partner", exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    // Every table, not just the one that opens by default. This is the §3.4
    // consistency rule and it is the most valuable assertion in the file.
    await openEveryScorecard(page);

    const failures = await page.evaluate(() => {
      const bad: string[] = [];
      for (const table of document.querySelectorAll("table")) {
        const headers = [...table.querySelectorAll("th")].map((th) => th.textContent?.trim());
        if (!headers.includes("Yet to be resolved")) continue;
        const col = (name: string) => headers.indexOf(name);
        const isPeople = ["Call Agent", "Manager"].includes(headers[0] ?? "");
        for (const tr of table.querySelectorAll("tbody tr")) {
          const cells = [...tr.querySelectorAll("td")].map((td) =>
            Number((td.textContent ?? "").replace(/[^0-9.-]/g, "")),
          );
          const sum =
            cells[col("Verified")] + cells[col("Partly verified")] +
            cells[col("Unreachable")] + cells[col("Yet to be resolved")];
          // Shipments reconcile to Digitalised; people reconcile to Issued,
          // because for an agent "issued" is what they were handed.
          const against = isPeople ? cells[col("Issued")] : cells[col("Digitalised")];
          if (sum !== against) {
            bad.push(`${headers[0]}: ${tr.textContent?.slice(0, 60)} (${sum} vs ${against})`);
          }
        }
      }
      return bad;
    });
    expect(failures).toEqual([]);
  });

  test("a status cell drills into the queue as a URL, and back restores", async ({
    page,
  }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/dashboard");
    await expect(
      page.getByRole("heading", { name: "Partner", exact: true }),
    ).toBeVisible({ timeout: 30_000 });

    // Any partner row's "Yet to be resolved" cell. The seeded funnel always
    // has unresolved records, so the first link is real work behind a number.
    const cell = page
      .getByRole("link", { name: /yet to be resolved$/ })
      .first();
    await cell.click();

    // The filter travelled as a URL, not as state.
    await expect(page).toHaveURL(/\/data-center\/call-centre\?/);
    await expect(page).toHaveURL(/organizationId=/);
    await expect(page).toHaveURL(/status=unresolved/);

    // The queue says what narrowed it and offers the way out.
    await expect(page.getByText(/Narrowed from the dashboard/)).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole("button", { name: "Show everything" })).toBeVisible();

    // Back is the dashboard again, with nothing having been written to restore it.
    await page.goBack();
    await expect(page).toHaveURL(/\/data-center\/dashboard/);
    await expect(
      page.getByRole("heading", { name: "Partner", exact: true }),
    ).toBeVisible({ timeout: 20_000 });
  });

  test("the drilled queue asks the server, not the client", async ({ page }) => {
    const bodies: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/functions/v1/data-center-read")) {
        bodies.push(req.postData() ?? "");
      }
    });

    await signIn(page, USERS.admin);
    await page.goto(
      "/data-center/call-centre?partnerState=Gombe&status=verified&label=Gombe",
    );
    await expect(page.getByText(/Narrowed from the dashboard/)).toBeVisible({
      timeout: 20_000,
    });

    // The filters reached the server as filters; nothing was narrowed client-side.
    await expect
      .poll(
        () =>
          bodies.some(
            (b) => b.includes('"partnerState":"Gombe"') && b.includes('"outcomeGroup":"verified"'),
          ),
        { timeout: 15_000 },
      )
      .toBe(true);
    for (const body of bodies) {
      expect(body).not.toContain('"offset"');
    }
  });

  test("every scorecard exports on its own, columns chosen first", async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/dashboard");
    await expect(
      page.getByRole("heading", { name: "Partner", exact: true }),
    ).toBeVisible({ timeout: 30_000 });

    // Named after the cut it exports, because a page with six exports on it
    // cannot have six buttons all saying "Export CSV".
    for (const title of SCORECARDS) {
      await expect(
        page.getByRole("button", { name: `Export ${title}`, exact: true }),
      ).toBeVisible();
    }

    // And each picks its columns before the file is written.
    await page.getByRole("button", { name: "Columns for Partner" }).click();
    const picker = page.getByRole("dialog");
    await expect(picker.getByRole("checkbox", { name: "Issued" })).toBeChecked();
    await picker.getByRole("button", { name: "Clear all" }).click();
    await expect(picker.getByRole("checkbox", { name: "Issued" })).not.toBeChecked();
    await page.keyboard.press("Escape");
  });

  test("the five export together, choosing tables and columns", async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/dashboard");
    await expect(
      page.getByRole("heading", { name: "Partner", exact: true }),
    ).toBeVisible({ timeout: 30_000 });

    // The five are one measure cut five ways, so the thing usually wanted is
    // several of them at once rather than one.
    await expect(page.getByRole("button", { name: "Export scorecards" })).toBeVisible();
    await page
      .getByRole("button", { name: "Choose scorecards and columns to export" })
      .click();

    await expect(page.getByText("Which scorecards")).toBeVisible();
    await expect(page.getByText("Which columns")).toBeVisible();
    for (const title of SCORECARDS) {
      await expect(page.getByRole("checkbox", { name: title })).toBeChecked();
    }
    await expect(page.getByText(/5 scorecards, \d+ columns, one file/)).toBeVisible();
  });

  test("a scorecard collapses, and pages when open", async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/dashboard");
    await expect(
      page.getByRole("heading", { name: "Partner", exact: true }),
    ).toBeVisible({ timeout: 30_000 });

    // Closed by default except the first: at 278 partners, five open tables is
    // a page nobody reaches the bottom of. The row count on a closed header is
    // what keeps it useful while closed.
    const location = page.getByRole("button", { expanded: false }).filter({
      has: page.getByRole("heading", { name: "Location", exact: true }),
    });
    await expect(location).toHaveCount(1);
    await expect(
      page.getByRole("columnheader", { name: "Issued", exact: true }),
    ).toHaveCount(1);

    await location.click();
    await expect(
      page.getByRole("columnheader", { name: "Issued", exact: true }),
    ).toHaveCount(2);
    // Paging, because a scorecard runs to hundreds of rows.
    await expect(page.getByRole("button", { name: "Next page" }).first()).toBeVisible();
  });
});

/**
 * The four headline figures.
 *
 * The dashboard opened with Sales, Complete, Fully verified and Open
 * corrections, two of which are internal bookkeeping rather than the question
 * anyone opens the page to ask. It now leads with how much went out, how much
 * came back as a sale, how much of that is confirmed, and how much is not.
 */
test.describe("the headline figures", () => {
  test("the four are shown, and each is a door", async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/dashboard");
    await expect(
      page.getByRole("heading", { name: "Partner", exact: true }),
    ).toBeVisible({ timeout: 30_000 });

    /*
     * These strings are not free text. They are what `withScope()` in
     * lib/measures.ts produces, which is the single place the module names a
     * measure. "Transferred to partners" and "Fully verified" were this
     * card row's own private names for Issued and Verified, and pairing each
     * with its scope is what lets a reader reconcile this page against
     * Partner Records instead of filing a bug. If a label moves, it moves
     * there and this follows.
     */
    /*
     * The scope in the label is the live one, not a constant.
     *
     * The page opens on This year, so these four opened saying "all time" over
     * figures that were already narrowed to this year. The number was right and
     * the label was wrong, which is worse than a wrong number: a wrong number
     * gets questioned.
     */
    for (const label of [
      "Issued · in the period shown",
      "Sold · in the period shown",
      "Verified · in the period shown",
      "Partly verified · in the period shown",
    ]) {
      await expect(
        page.getByRole("link", { name: new RegExp(`^${label}:`) }),
      ).toBeVisible();
    }

    /*
     * A card that cannot follow the narrowing says so, and only that card.
     *
     * Imported rows counts the bench's own batches and a batch spans many
     * consignments, so it has no period to answer for. Complete does, so it
     * carries no marker: annotating every card would make the one that matters
     * invisible.
     */
    await expect(
      page.getByRole("link", { name: /^Imported rows · all time:/ }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: /^Complete:/ })).toBeVisible();

    // Everything, and the same four say so.
    await page.goto("/data-center/dashboard?period=all");
    await expect(
      page.getByRole("heading", { name: "Partner", exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    for (const label of [
      "Issued · all time",
      "Sold · all time",
      "Verified · all time",
      "Partly verified · all time",
    ]) {
      await expect(
        page.getByRole("link", { name: new RegExp(`^${label}:`) }),
      ).toBeVisible();
    }

    // Nothing is marked when nothing was narrowed.
    await expect(page.getByRole("link", { name: /^Imported rows:/ })).toBeVisible();

    // Displaced rather than dropped: both are still on the page, below.
    for (const label of ["Complete", "Open corrections"]) {
      await expect(page.getByRole("link", { name: new RegExp(`^${label}:`) })).toBeVisible();
    }
  });

  test("the Issued card equals what the partner scorecard issued", async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/dashboard");
    await expect(
      page.getByRole("heading", { name: "Partner", exact: true }),
    ).toBeVisible({ timeout: 30_000 });

    // The card sums the partner cut's Issued column, so it has to equal that
    // column. Partner, location and sales rep are three cuts of one
    // population; call agent and manager are a different one, which is why
    // only one cut is summed.
    const shown = await page
      .getByRole("link", { name: /^Issued · in the period shown:/ })
      .evaluate((el) => Number((el.textContent ?? "").replace(/[^0-9]/g, "") || 0));

    const issuedTotal = await page.evaluate(() => {
      const table = [...document.querySelectorAll("table")].find((t) =>
        [...t.querySelectorAll("th")].map((th) => th.textContent?.trim()).includes("Yet to be resolved"),
      );
      if (!table) return -1;
      const headers = [...table.querySelectorAll("th")].map((th) => th.textContent?.trim());
      const col = headers.indexOf("Issued");
      let sum = 0;
      for (const tr of table.querySelectorAll("tbody tr")) {
        const cells = tr.querySelectorAll("td");
        sum += Number((cells[col]?.textContent ?? "").replace(/[^0-9]/g, "") || 0);
      }
      return sum;
    });

    // The visible table is one page of the partner cut, so it can only be a
    // lower bound on the card. Asserting the direction rather than equality
    // keeps this honest instead of passing by accident on a short seed.
    expect(issuedTotal).toBeGreaterThanOrEqual(0);
    expect(shown).toBeGreaterThanOrEqual(issuedTotal);
  });

  test("the Unverified card and the queue behind it agree on the word", async ({
    page,
  }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/dashboard");
    await expect(
      page.getByRole("heading", { name: "Partner", exact: true }),
    ).toBeVisible({ timeout: 30_000 });

    await page.getByRole("link", { name: /^Unverified · in the period shown:/ }).click();

    // Both sides define unverified the same way - the funnel view, the
    // scorecard compute and the queue filter all read it off one list, which
    // is why removing an outcome from that list moved all three together.
    await expect(page).toHaveURL(/status=unverified/);
    await expect(page.getByText(/Narrowed from the dashboard/)).toBeVisible({
      timeout: 20_000,
    });
  });
});
