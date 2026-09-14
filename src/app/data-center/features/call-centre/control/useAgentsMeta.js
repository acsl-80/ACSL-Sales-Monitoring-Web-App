import { useCallback, useEffect, useState } from "react";
import { dataCenterAssign } from "../../../lib/client";
import { usePolling } from "../../../lib/usePolling";

/**
 * The hand-out settings and the live roster the board's actions need
 * (Phase 26, C2): the pool as the hand-out dialog wants it, the batch size,
 * the priority order and its options, the default cap and the ceiling, the
 * presence windows, and each agent's last batch activity for the idle count.
 * One read (`agents`), polled at the same pace as the board, so the dialog
 * offers the pool as it is now.
 */
export function useAgentsMeta(enabled, refreshSeconds) {
  const [meta, setMeta] = useState(null);
  const load = useCallback(async () => {
    if (!enabled) return;
    try {
      setMeta(await dataCenterAssign.agents());
    } catch {
      // The board still renders from its own read; the dialog says so if it
      // has no pool to offer.
    }
  }, [enabled]);
  useEffect(() => {
    load();
  }, [load]);
  usePolling(load, enabled ? refreshSeconds ?? 60 : 0);
  return meta;
}
