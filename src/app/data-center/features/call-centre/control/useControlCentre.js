import { useCallback, useEffect, useState } from "react";
import {
  dataCenterAssign,
  dataCenterCorrections,
  dataCenterDashboard,
  DataCenterError,
} from "../../../lib/client";
import { usePolling } from "../../../lib/usePolling";

/**
 * What the control centre reads, read once and shared (Phase 26, C2).
 *
 * Five reads, each owned by one server action: the shift board for the chosen
 * day (`board`), the top of the pool by partner (`pool_partners`), the day's
 * events (`activity`), the computed metrics the figures draw on (`dashboard`),
 * and the work waiting on people (`work_waiting`). The figures, the board, the
 * partner card, the decisions card and the feed all draw from these, so one
 * refresh moves every number at once and nothing on the page disagrees with
 * its neighbour by a few seconds.
 *
 * `day` and `range` come from the URL, so back restores the day the manager
 * was looking at and a narrowed page can be sent as a link.
 */
export function useControlCentre({ canManage, canReview, day, range }) {
  const [board, setBoard] = useState(null);
  const [partners, setPartners] = useState(null);
  const [activity, setActivity] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [waiting, setWaiting] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!canManage) return;
    try {
      // Slice 4: the range travels as written (week, a month, a year, a span);
      // the server says what it resolved to.
      const b = await dataCenterAssign.board({ day: day ?? null, range: range ?? null });
      setBoard(b);
      // The feed's window is the chosen window, in the call centre's own
      // time: the board says which days that resolved to.
      const from = b.from ?? b.day;
      const to = b.day;
      const jobs = [
        dataCenterAssign.poolPartners({ limit: 5, sort: "waiting" }).then(setPartners),
        // Bare dates: the server reads them as whole call-centre days.
        dataCenterAssign.activity({ from, to, limit: 10 }).then(setActivity),
        dataCenterDashboard.get().then(setMetrics),
        canReview
          ? dataCenterCorrections.workWaiting().then(setWaiting).catch(() => setWaiting(null))
          : Promise.resolve(),
      ];
      await Promise.all(jobs);
      setError(null);
    } catch (err) {
      setError(err instanceof DataCenterError ? err.message : "Could not load the control centre.");
    } finally {
      setLoading(false);
    }
  }, [canManage, canReview, day, range]);

  useEffect(() => {
    load();
  }, [load]);

  usePolling(load, canManage ? board?.refreshSeconds ?? 60 : 0);

  return { board, partners, activity, metrics, waiting, error, loading, reload: load };
}
