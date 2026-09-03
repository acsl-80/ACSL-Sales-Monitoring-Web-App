/**
 * Every matching sale, for the export.
 *
 * Slice 9b of the 2026-09-02 review (finding F6, the export half). The export
 * asked the server for two thousand rows in one request, the server clamped
 * that to five hundred, the response's own total was discarded, and the file
 * a partner downloaded held the first five hundred of whatever matched with
 * no word that anything was missing. Then three of the screen's filters were
 * applied to that partial set in the browser.
 *
 * The export now sends the same request the screen sends, page after page,
 * until the server's total is reached or the ceiling is. Same filters, same
 * scope, same order, so the file is the screen. The ceiling exists because a
 * browser holding a hundred thousand rows is a browser about to stop; past
 * it the file is delivered and says what it does not hold.
 */

import salesAdvancedService from "../../../services/salesAdvancedAPIService";
import type { AdminSales } from "@/types/adminSales";

/** The most rows one request may carry; the function clamps to this. */
export const EXPORT_PAGE = 500;
/** The most rows one export may hold. */
export const EXPORT_CEILING = 20_000;

export type ExportProgress = { fetched: number; total: number };

export type ExportResult = {
  rows: AdminSales[];
  /** How many matched on the server, whatever the file holds. */
  total: number;
  /** True when the ceiling stopped the export before the total. */
  truncated: boolean;
};

export async function fetchAllSalesForExport(
  request: Record<string, unknown>,
  options: { ceiling?: number; onProgress?: (p: ExportProgress) => void } = {},
): Promise<ExportResult> {
  const ceiling = options.ceiling ?? EXPORT_CEILING;
  const rows: AdminSales[] = [];
  let total = 0;
  let page = 1;
  // The screen's paging, summary and due-chip fields do not belong on an export.
  const { page: _p, limit: _l, withSummary: _s, ...base } = request;
  void _p;
  void _l;
  void _s;

  for (;;) {
    const response: any = await salesAdvancedService.getSalesData(
      { ...base, page, limit: EXPORT_PAGE, includeAddress: true, includeCreator: true },
      "POST",
      "SalesExport",
    );
    if (!response?.success) {
      throw new Error(String(response?.error || response?.message || "the server did not answer"));
    }
    const batch = (response.data ?? []) as AdminSales[];
    total = Number(response.pagination?.total ?? Math.max(total, rows.length + batch.length));
    rows.push(...batch);
    options.onProgress?.({ fetched: rows.length, total });
    if (batch.length < EXPORT_PAGE || rows.length >= total) {
      return { rows, total, truncated: false };
    }
    if (rows.length >= ceiling) {
      return { rows: rows.slice(0, ceiling), total, truncated: true };
    }
    page += 1;
  }
}
