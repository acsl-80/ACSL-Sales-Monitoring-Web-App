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

test.describe("the five scorecards", () => {
  test("all five render the same columns from one component", async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/dashboard");

    for (const title of SCORECARDS) {
      await expect(
        page.getByRole("heading", { name: title, exact: true }),
      ).toBeVisible({ timeout: 30_000 });
    }

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
            cells[col("Verified")] + cells[col("Unverified")] +
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

  test("every scorecard offers CSV export", async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto("/data-center/dashboard");
    await expect(
      page.getByRole("heading", { name: "Partner", exact: true }),
    ).toBeVisible({ timeout: 30_000 });

    // One per scorecard, plus none elsewhere on this page today. Counting
    // exactly five asserts both.
    await expect(page.getByRole("button", { name: /Export CSV/ })).toHaveCount(5);
  });
});
