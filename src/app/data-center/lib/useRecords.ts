/**
 * Table 1's data, paged forward by cursor.
 *
 * The accumulated rows are the pages fetched so far, appended. That is what
 * makes a virtualized list feel continuous while the query underneath stays a
 * bounded, indexed read: the browser holds what the user has actually scrolled
 * through, not the whole table.
 *
 * Changing a filter resets to page one rather than filtering what is already
 * loaded. Narrowing in the browser would be answering from a partial set, which
 * is exactly the failure this module is designed to avoid.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  dataCenterClient,
  DataCenterError,
  type RecordsCursor,
  type RecordsFilters,
  type SoldStoveRow,
} from "./client";

export const PAGE_SIZE = 100;

/**
 * How many rows this hook will hold in memory before it stops fetching.
 *
 * The list is virtualized, so the DOM is never the problem - but the array
 * behind it is. Every page fetched is appended and kept, and at 500,000 records
 * an idle scroll-wheel would walk a user into holding half a million objects,
 * which is a browser tab that stops responding rather than a slow one.
 *
 * Five thousand is about 5 MB of row objects and roughly a hundred pages of
 * scrolling. Past it the table stops loading and says so, with the match count
 * beside it: at that point narrowing the filter is the answer, and it is a
 * better answer than scrolling would have been.
 */
export const MAX_RETAINED = 5_000;

export interface RecordsState {
  rows: SoldStoveRow[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  scope: string | null;
  /** How many match the filter, up to the server's ceiling. */
  total: number | null;
  /** True means the total is a floor: "at least this many". */
  totalIsCapped: boolean;
  /** True once MAX_RETAINED is reached and paging has deliberately stopped. */
  atCeiling: boolean;
  loadMore: () => void;
  reload: () => void;
}

export function useRecords(
  filters: RecordsFilters,
  table: "records" | "call_center" = "records",
  direction: "asc" | "desc" = "desc",
): RecordsState {
  const [rows, setRows] = useState<SoldStoveRow[]>([]);
  const [cursor, setCursor] = useState<RecordsCursor | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [totalIsCapped, setTotalIsCapped] = useState(false);

  // Every fetch carries the generation it was started in. A response from an
  // older generation is discarded, so a slow first page cannot overwrite the
  // results of a filter the user has since changed.
  const generation = useRef(0);
  const inFlight = useRef(false);

  const serialized = JSON.stringify(filters);

  const fetchPage = useCallback(
    async (from: RecordsCursor | null, gen: number) => {
      // The guard covers "load more" only. A filter change starts a new
      // generation and must always proceed: blocking it on a first page that
      // is still in flight clears the rows and then never refills them, which
      // leaves an empty table with no error and no way back. Found by the
      // Playwright filter test, which typed into search while page one was
      // still loading. The stale response is discarded by the generation check
      // below rather than by refusing to start.
      if (from && inFlight.current) return;
      inFlight.current = true;
      if (from) setLoadingMore(true);
      else setLoading(true);
      try {
        const fetcher =
          table === "call_center"
            ? dataCenterClient.getCallQueue
            : dataCenterClient.getRecords;
        const page = await fetcher({
          cursor: from,
          limit: PAGE_SIZE,
          direction,
          filters: JSON.parse(serialized) as RecordsFilters,
        });
        if (gen !== generation.current) return;
        setRows((previous) => (from ? [...previous, ...page.rows] : page.rows));
        setCursor(page.nextCursor);
        setHasMore(page.hasMore);
        setScope(page.scope);
        // Answered on the first page of a filter only, so a continuation page
        // carrying null must not wipe what page one established.
        if (page.total != null) {
          setTotal(page.total);
          setTotalIsCapped(Boolean(page.totalIsCapped));
        }
        setError(null);
      } catch (err) {
        if (gen !== generation.current) return;
        setError(
          err instanceof DataCenterError
            ? err.message
            : table === "call_center"
              ? "Could not load the call centre queue."
              : "Could not load sold stove records.",
        );
        setHasMore(false);
      } finally {
        // Only the current generation may clear the flags. A superseded
        // request finishing late must not report the newer one as done.
        if (gen === generation.current) {
          inFlight.current = false;
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [serialized, table, direction],
  );

  useEffect(() => {
    const gen = ++generation.current;
    setRows([]);
    setCursor(null);
    setHasMore(false);
    setTotal(null);
    setTotalIsCapped(false);
    fetchPage(null, gen);
  }, [fetchPage]);

  const atCeiling = rows.length >= MAX_RETAINED;

  return {
    rows,
    loading,
    loadingMore,
    error,
    hasMore,
    scope,
    total,
    totalIsCapped,
    atCeiling,
    loadMore: () => {
      // The ceiling is enforced here rather than in the component, because the
      // component asks for more by scrolling and would keep asking.
      if (atCeiling) return;
      if (cursor && hasMore && !inFlight.current) {
        fetchPage(cursor, generation.current);
      }
    },
    reload: () => {
      const gen = ++generation.current;
      setRows([]);
      setCursor(null);
      fetchPage(null, gen);
    },
  };
}
