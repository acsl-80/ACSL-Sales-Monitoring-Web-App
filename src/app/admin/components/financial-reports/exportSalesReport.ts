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
 * scope, same order, so the file is the screen. The walk itself lives in
 * src/lib/fetchAllPages since slice 10a, where the Performance Report's
 * stove export needed the same one.
 */

import salesAdvancedService from "../../../services/salesAdvancedAPIService";
import type { AdminSales } from "@/types/adminSales";
import {
  DEFAULT_EXPORT_CEILING,
  fetchAllPages,
  type FetchAllPagesResult,
  type PageProgress,
} from "@/lib/fetchAllPages";

/** The most rows one request may carry; the function clamps to this. */
export const EXPORT_PAGE = 500;
/** The most rows one export may hold. */
export const EXPORT_CEILING = DEFAULT_EXPORT_CEILING;

export type ExportProgress = PageProgress;
export type ExportResult = FetchAllPagesResult<AdminSales>;

export function fetchAllSalesForExport(
  request: Record<string, unknown>,
  options: { ceiling?: number; onProgress?: (p: ExportProgress) => void } = {},
): Promise<ExportResult> {
  // The screen's paging, summary and due-chip fields do not belong on an export.
  const { page: _p, limit: _l, withSummary: _s, ...base } = request;
  void _p;
  void _l;
  void _s;

  return fetchAllPages<AdminSales>(
    async (page, limit) => {
      const response: any = await salesAdvancedService.getSalesData(
        { ...base, page, limit, includeAddress: true, includeCreator: true },
        "POST",
        "SalesExport",
      );
      if (!response?.success) {
        throw new Error(String(response?.error || response?.message || "the server did not answer"));
      }
      return {
        rows: (response.data ?? []) as AdminSales[],
        total: Number(response.pagination?.total ?? Number.NaN),
      };
    },
    { limit: EXPORT_PAGE, ceiling: options.ceiling ?? EXPORT_CEILING, onProgress: options.onProgress },
  );
}
