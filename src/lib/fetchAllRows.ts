/**
 * Every row of a PostgREST query, a thousand at a time.
 *
 * PostgREST caps an un-ranged select at 1,000 rows and says nothing about it,
 * so a screen that needs every row must page. Slice 11c of the 2026-09-02
 * review (finding F31) puts the one loop here that two files used to define
 * and five more wrote out by hand. Builders are not reusable, so the caller
 * rebuilds the query per page and ends it with `.range(from, to)`.
 *
 * This is a browser walk over a table, and it is the wrong tool past a few
 * thousand rows; the reports that used to lean on it now ask the database for
 * the answer (slices 6, 9 and 10). What remains are the on-demand modals, and
 * the cap keeps any of them from swallowing the browser.
 */

export type PageQuery<T> = (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>;

export const ROWS_PER_PAGE = 1000;
/** The most rows one walk may collect; past it the walk stops and returns what it has. */
export const DEFAULT_ROW_CAP = 50_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchAllRows<T = any>(
  buildQuery: PageQuery<T>,
  options: { cap?: number } = {},
): Promise<T[]> {
  const cap = options.cap ?? DEFAULT_ROW_CAP;
  const rows: T[] = [];
  let from = 0;
  while (from < cap) {
    const { data, error } = await buildQuery(from, from + ROWS_PER_PAGE - 1);
    if (error) throw error;
    const chunk = data || [];
    rows.push(...chunk);
    if (chunk.length < ROWS_PER_PAGE) break;
    from += ROWS_PER_PAGE;
  }
  return rows;
}
