import { useCallback, useEffect, useState } from "react";
import { dataCenterAssign, dataCenterCorrections, dataCenterDashboard, DataCenterError } from "../../../lib/client";
import { usePolling } from "../../../lib/usePolling";

/**
 * What the control centre reads, read once and shared.
 *
 * Three reads, each already owned by one server action: the computed metrics
 * (`dashboard`, for the pool family and the call centre's counts), the live
 * agents and pool (`agents`), and the work waiting on people (`work_waiting`).
 * The board, the agents panel, the pool by partner and the lanes all draw from
 * these, so one refresh moves every number at once and nothing on the page
 * disagrees with its neighbour by a few seconds.
 *
 * Refreshed at the pace the server sends back inside the agents read
 * (`call_centre.refresh_seconds`), while the tab is visible.
 */
export function useControlCentre({ canManage, canReview }) {
  const [metrics, setMetrics] = useState(null);
  const [agents, setAgents] = useState(null);
  const [waiting, setWaiting] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    const jobs = [
      dataCenterDashboard.get().then(setMetrics),
      canManage ? dataCenterAssign.agents().then(setAgents) : Promise.resolve(),
      canReview ? dataCenterCorrections.workWaiting().then(setWaiting).catch(() => setWaiting(null)) : Promise.resolve(),
    ];
    try {
      await Promise.all(jobs);
      setError(null);
    } catch (err) {
      setError(err instanceof DataCenterError ? err.message : "Could not load the control centre.");
    }
  }, [canManage, canReview]);

  useEffect(() => {
    load();
  }, [load]);

  usePolling(load, agents?.refreshSeconds ?? 60);

  return { metrics, agents, waiting, error, reload: load };
}
