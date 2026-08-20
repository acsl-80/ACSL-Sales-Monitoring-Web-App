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

export interface RecordsState {
  rows: SoldStoveRow[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  scope: string | null;
  loadMore: () => void;
  reload: () => void;
}

export function useRecords(
  filters: RecordsFilters,
  table: "records" | "call_center" = "records",
): RecordsState {
  const [rows, setRows] = useState<SoldStoveRow[]>([]);
  const [cursor, setCursor] = useState<RecordsCursor | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<string | null>(null);

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
          filters: JSON.parse(serialized) as RecordsFilters,
        });
        if (gen !== generation.current) return;
        setRows((previous) => (from ? [...previous, ...page.rows] : page.rows));
        setCursor(page.nextCursor);
        setHasMore(page.hasMore);
        setScope(page.scope);
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
    [serialized, table],
  );

  useEffect(() => {
    const gen = ++generation.current;
    setRows([]);
    setCursor(null);
    setHasMore(false);
    fetchPage(null, gen);
  }, [fetchPage]);

  return {
    rows,
    loading,
    loadingMore,
    error,
    hasMore,
    scope,
    loadMore: () => {
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
