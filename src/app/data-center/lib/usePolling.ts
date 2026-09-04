import { useEffect, useRef } from "react";

/**
 * Re-run a load on an interval while the tab is visible.
 *
 * The interval comes from configuration (`call_centre.refresh_seconds`) and
 * arrives inside the response it refreshes, so the server decides the pace and
 * 0 turns it off. Paused when the tab is hidden: a board left open overnight
 * must not hammer the database, and nobody is reading it anyway. Applied to
 * the board, the agents panel and My Work; never to the queue or the log,
 * whose paging a reload would disturb.
 */
export function usePolling(load: () => void | Promise<unknown>, seconds: number | null | undefined) {
  const latest = useRef(load);
  latest.current = load;

  useEffect(() => {
    const every = Number(seconds ?? 0);
    if (!Number.isFinite(every) || every <= 0) return undefined;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer !== null) return;
      timer = setInterval(() => {
        if (document.visibilityState === "visible") void latest.current();
      }, every * 1000);
    };
    const stop = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void latest.current();
        start();
      } else {
        stop();
      }
    };
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [seconds]);
}
