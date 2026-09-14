/**
 * Every page of a server-paged list, for exports.
 *
 * Slice 10a of the 2026-09-02 review. The export in slice 9b walked the
 * sales function page by page until the server's total was reached or a
 * ceiling stopped it; the Performance Report's stove export needs the same
 * walk over a different endpoint. This is that walk, once. The ceiling
 * exists because a browser holding a hundred thousand rows is a browser
 * about to stop; past it the caller delivers what it has and says so.
 */

export type PageResult<T> = { rows: T[]; total: number };
export type PageProgress = { fetched: number; total: number };

export type FetchAllPagesResult<T> = {
  rows: T[];
  /** How many matched on the server, whatever was fetched. */
  total: number;
  /** True when the ceiling stopped the walk before the total. */
  truncated: boolean;
};

export const DEFAULT_EXPORT_CEILING = 20_000;

export async function fetchAllPages<T>(
  getPage: (page: number, limit: number) => Promise<PageResult<T>>,
  options: { limit: number; ceiling?: number; onProgress?: (p: PageProgress) => void },
): Promise<FetchAllPagesResult<T>> {
  const ceiling = options.ceiling ?? DEFAULT_EXPORT_CEILING;
  const rows: T[] = [];
  let total = 0;
  let page = 1;

  for (;;) {
    const batch = await getPage(page, options.limit);
    total = Number.isFinite(batch.total) ? batch.total : Math.max(total, rows.length + batch.rows.length);
    rows.push(...batch.rows);
    options.onProgress?.({ fetched: rows.length, total });
    if (batch.rows.length < options.limit || rows.length >= total) {
      return { rows, total, truncated: false };
    }
    if (rows.length >= ceiling) {
      return { rows: rows.slice(0, ceiling), total, truncated: true };
    }
    page += 1;
  }
}
