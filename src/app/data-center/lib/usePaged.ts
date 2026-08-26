import { useEffect, useMemo, useState } from "react";

/**
 * Page a list that is already in hand.
 *
 * For the lists Settings and the assignment console show, which are bounded by
 * what a person can usefully read: agents, partners, questions, settings. The
 * server caps every one of them, so paging happens here rather than costing a
 * round trip per page.
 *
 * The tables that are genuinely large - the call queue, the stove records -
 * are keyset-paginated and virtualized instead, and never come through here.
 */
export function usePaged<T>(rows: T[], initialSize = 10) {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(initialSize);

  // A filter that shortens the list must not leave the reader on page 7 of 2,
  // which reads as "no results" and is the most common paging bug there is.
  const lastPage = Math.max(0, Math.ceil(rows.length / pageSize) - 1);
  useEffect(() => {
    if (page > lastPage) setPage(lastPage);
  }, [page, lastPage]);

  const slice = useMemo(
    () => rows.slice(page * pageSize, page * pageSize + pageSize),
    [rows, page, pageSize],
  );

  return {
    slice,
    page,
    pageSize,
    total: rows.length,
    setPage: (n: number) => setPage(Math.max(0, Math.min(n, lastPage))),
    setPageSize,
  };
}
