import { useCallback, useEffect, useState } from "react";
import { dataCenterImport } from "../../../lib/client";

/**
 * The four figures over the import page (import redesign, 2026-09-07).
 *
 * No new endpoint: two reads the page's surfaces already make, summed.
 * `batches(range)` gives the period's files and sheets (rows waiting on a
 * person, records landed); `awaitingConfirmation()` gives what is waiting to
 * be released and what is still being drafted at the bench. A read the person
 * may not make, or one that fails, leaves its figures null, which the tiles
 * draw as a dash rather than a zero.
 *
 * Refreshed on mount, when the period or the mode changes, and when the tab
 * regains focus, so a commit made in one mode is counted when the person
 * comes back to look.
 */
const RECEIPT_SOURCES = ["receipt", "manual", "field", "workbench"];

export function useImportFigures({ canBatches, canQueue, dateFrom, dateTo, mode }) {
  const [batches, setBatches] = useState(null);
  const [queue, setQueue] = useState(null);

  const refresh = useCallback(async () => {
    const jobs = [];
    if (canBatches) {
      jobs.push(
        dataCenterImport
          .batches({ ...(dateFrom ? { dateFrom } : {}), ...(dateTo ? { dateTo } : {}) })
          .then(setBatches)
          .catch(() => setBatches(null)),
      );
    }
    if (canQueue) {
      jobs.push(
        dataCenterImport
          .awaitingConfirmation()
          .then((r) => setQueue(r.batches ?? []))
          .catch(() => setQueue(null)),
      );
    }
    await Promise.all(jobs);
  }, [canBatches, canQueue, dateFrom, dateTo]);

  useEffect(() => {
    refresh();
  }, [refresh, mode]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  const live = batches?.filter((b) => b.state !== "rolled_back") ?? null;
  const receipts = live?.filter((b) => !b.source || RECEIPT_SOURCES.includes(b.source)) ?? null;
  const sheets = live?.filter((b) => b.source === "call_center") ?? null;
  const sum = (rows, key) => (rows ? rows.reduce((n, r) => n + (r[key] ?? 0), 0) : null);

  return {
    refresh,
    counts: {
      needsPerson: sum(live, "exception_rows"),
      awaiting: sum(queue, "awaiting"),
      landed: sum(receipts?.filter((b) => b.state === "committed") ?? null, "committed_rows"),
      drafting: queue
        ? sum(
            queue.filter((b) => b.stream === "workbench"),
            "still_drafting",
          )
        : null,
      files: receipts ? receipts.length : null,
      sheets: sheets ? sheets.length : null,
    },
  };
}
