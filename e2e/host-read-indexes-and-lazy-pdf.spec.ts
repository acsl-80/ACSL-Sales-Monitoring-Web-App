import { test, expect } from "@playwright/test";
import { branchSql, signIn, USERS } from "./helpers";

/**
 * Slice 1 of the 2026-09-02 review: the dashboard stops downloading a PDF
 * library nobody asked for, and the host's own filters get their indexes.
 *
 * Two facts, each asserted where it lives.
 *
 * The first is a network fact. jsPDF reached the dashboard through a static
 * import chain (AgreementPDFGenerator <- AdminSalesDetailModal <-
 * FinancialReportsView), so every dashboard load fetched roughly 400 KB of PDF
 * code that is used only when somebody presses View Agreement. Against the old
 * code the jspdf chunk is requested on load; against the new code it is not.
 *
 * The second is a schema fact, asserted structurally rather than by query
 * plan: on a seeded preview database the tables are small enough that the
 * planner may pick a sequential scan whatever indexes exist, so a plan
 * assertion would be red for the wrong reason. Production, at 22,000 stoves,
 * is checked by EXPLAIN after the migration is run there.
 */

const PDF_LIBS = /jspdf|html2canvas/i;

const EXPECTED_INDEXES = [
  ["stove_ids_base", "idx_stove_ids_org_status"],
  ["stove_ids_base", "idx_stove_ids_sale_id"],
  ["stove_ids_base", "idx_stove_ids_transfer_date"],
  ["sales", "idx_sales_partner_name_date"],
  ["sales", "idx_sales_retailer_branch"],
  ["sales", "idx_sales_cancelled_at"],
] as const;

test.describe("slice 1: lazy PDF and read indexes", () => {
  test("loading the dashboard does not download a PDF library", async ({ page }) => {
    const fetched: string[] = [];
    page.on("request", (req) => {
      if (PDF_LIBS.test(req.url())) fetched.push(req.url());
    });

    await signIn(page, USERS.admin);
    await page.goto("/dashboard");
    // The cards are the last thing the page fetches; once they show, every
    // chunk the route preloads has been requested.
    await expect(page.getByText(/Expected Receivable/i).first()).toBeVisible({
      timeout: 30_000,
    });
    await page.waitForLoadState("networkidle");

    expect(
      fetched,
      "a PDF library was fetched on dashboard load; it belongs behind View Agreement",
    ).toEqual([]);
  });

  test("the host's read indexes exist", async () => {
    const rows = await branchSql<{ tablename: string; indexname: string }>(
      `select tablename, indexname from pg_indexes
        where schemaname = 'public'
          and tablename in ('sales', 'stove_ids_base')`,
    );
    const present = new Set(rows.map((r) => `${r.tablename}.${r.indexname}`));
    const missing = EXPECTED_INDEXES.filter(([t, i]) => !present.has(`${t}.${i}`)).map(
      ([t, i]) => `${t}.${i}`,
    );
    expect(missing, "indexes the host's own filters need are not there").toEqual([]);
  });
});
