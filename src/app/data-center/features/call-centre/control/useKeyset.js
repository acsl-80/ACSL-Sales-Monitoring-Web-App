import { useCallback, useEffect, useRef, useState } from "react";
import { DataCenterError } from "../../../lib/client";

/**
 * Keyset paging for a list read (Phase 26, C2). Forward on the cursor the
 * server hands back, backward on the cursors already seen. No offset, ever.
 *
 * `fetchPage(cursor)` returns `{ rows, nextCursor, ... }`. A change in
 * `deps` (filters, sort, page size) starts the paging over, because the
 * cursor in hand points into a result set that no longer exists. The cursor
 * that produced the page on screen is kept apart from the history, so
 * Previous is never one page out and a reload lands on the same page.
 */
export function useKeyset(fetchPage, deps) {
  const [page, setPage] = useState(null);
  const [history, setHistory] = useState([]);
  const [current, setCurrent] = useState(null);
  const [next, setNext] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const seq = useRef(0);

  const load = useCallback(async (cursor) => {
    const mine = ++seq.current;
    setLoading(true);
    try {
      const data = await fetchPage(cursor);
      if (mine !== seq.current) return;
      setPage(data);
      setNext(data.nextCursor ?? null);
      setError(null);
    } catch (err) {
      if (mine !== seq.current) return;
      setError(err instanceof DataCenterError ? err.message : "Could not load the list.");
    } finally {
      if (mine === seq.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    setHistory([]);
    setCurrent(null);
    load(null);
  }, [load]);

  const goNext = () => {
    if (!next) return;
    setHistory((h) => [...h, current]);
    setCurrent(next);
    load(next);
  };
  const goPrevious = () => {
    if (history.length === 0) return;
    const back = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    setCurrent(back);
    load(back);
  };
  const reload = () => load(current);

  return {
    page,
    rows: page?.rows ?? [],
    loading,
    error,
    pageNumber: history.length + 1,
    hasNext: Boolean(next),
    hasPrevious: history.length > 0,
    goNext,
    goPrevious,
    reload,
  };
}
