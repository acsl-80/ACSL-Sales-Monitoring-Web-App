import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { dataCenterClient } from "./client";
import {
  decodePeriod,
  encodePeriod,
  resolvePeriod,
  type Period,
  type ResolvedPeriod,
} from "./period";

/**
 * The routes that carry a period. Narrowing to these rather than `string` is
 * what lets the router check at compile time that the surface passing an id
 * actually declared the parameter - a mismatch here would otherwise be a
 * filter that silently never applies.
 */
type PeriodRoute =
  | "/data-center/stove-records"
  | "/data-center/call-centre"
  | "/data-center/partner-records"
  | "/data-center/import";

/**
 * The period a surface is showing, held in the URL.
 *
 * The module's rule is that a narrowed view is a URL rather than component
 * state, so the back button restores it and a filtered surface can be sent to
 * somebody as a link. A period is a narrowing like any other, and one that
 * lived in component state would be lost by every drill-through and could not
 * be shared - which for a number somebody is about to quote in a meeting is
 * the difference between a figure and a claim.
 *
 * `earliest` comes from the server, once per session, so the year list offers
 * only years the register actually holds.
 *
 * `param` names the search key, because one page can hold two surfaces asking
 * about two different dates. The Call Centre stacks the queue, which is about
 * when a stove was sold, over the assignment log, which is about when the work
 * was handed out. Sharing one value between them would mean narrowing the log
 * to last week silently re-narrowed the queue as well, which is the surprise
 * this control exists to remove rather than to introduce.
 */
export function usePeriod(routeId: PeriodRoute, param: string = "period"): {
  period: Period;
  setPeriod: (next: Period) => void;
  resolved: ResolvedPeriod;
  earliest: string | null;
} {
  const search = useSearch({ from: routeId }) as Record<string, string | undefined>;
  const navigate = useNavigate();
  const [earliest, setEarliest] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    dataCenterClient
      .periodBounds()
      .then((b) => live && setEarliest(b.earliest))
      // A missing bound is not worth an error on the page: the control falls
      // back to offering this year alone, which is the default anyway.
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const period = useMemo(() => decodePeriod(search[param]), [search, param]);

  const setPeriod = useCallback(
    (next: Period) => {
      navigate({
        to: routeId,
        search: (prev: Record<string, unknown>) => ({
          ...prev,
          [param]: encodePeriod(next),
        }),
        replace: true,
      });
    },
    [navigate, routeId, param],
  );

  const resolved = useMemo(() => resolvePeriod(period), [period]);

  return { period, setPeriod, resolved, earliest };
}
