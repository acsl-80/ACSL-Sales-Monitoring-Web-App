import { createFileRoute, redirect } from "@tanstack/react-router";
import { lazy } from "react";

/**
 * A narrowing belongs to the Records page (Phase 26, C3). Every link that
 * used to land a filtered queue on this page keeps working: it is sent on
 * with its parameters intact. The bare page is the control centre.
 */
const NARROWING = [
  "organizationId",
  "partnerState",
  "transferSalesRep",
  "assignedAgent",
  "agentManager",
  "status",
  "preset",
  "verificationOutcome",
  "standing",
] as const;

const Page = lazy(() => import("@/app/data-center/pages/CallCentrePage"));

/**
 * The scorecards drill into this page by URL, which is the module's rule:
 * drill-through is never component state, so back restores the dashboard and a
 * filtered queue can be sent to someone as a link.
 *
 * One dimension param at a time, plus an optional status. Anything else in the
 * search is dropped here rather than trusted downstream.
 */
type CallCentreSearch = {
  organizationId?: string;
  partnerState?: string;
  transferSalesRep?: string;
  assignedAgent?: string;
  agentManager?: string;
  status?: string;
  label?: string;
  /** Selects one of the queue's own presets, so a dashboard number can land on it. */
  preset?: string;
  /** One exact outcome, where a scorecard column's four-outcome group is too wide. */
  verificationOutcome?: string;
  /** One or more of the six standings (D41), sent on to the records page. */
  standing?: string;
  /**
   * The shared period control, as one parameter. `thisYear` is the default and
   * is left out of the URL entirely, so an unfiltered link stays clean.
   */
  period?: string;
  /**
   * The assignment log's own period. The log retired in Phase 26, C2; the
   * parameter is still accepted so an old link does not break, and ignored.
   */
  logPeriod?: string;
  /**
   * The shift board's day (YYYY-MM-DD in the call centre's timezone) and
   * range ("week" for the seven days ending on it). Today is the default and
   * stays out of the URL.
   */
  day?: string;
  /** Slice 4: week, YYYY-MM, YYYY or from..to. */
  range?: string;
};

const str = (v: unknown) => (typeof v === "string" && v !== "" ? v : undefined);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const RANGE = /^(week|\d{4}|\d{4}-\d{2}|\d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2})$/;
// The router parses a bare year in the URL as a number; it is still the year.
const rangeOf = (v: unknown): string | undefined => {
  const s = typeof v === "number" ? String(v) : v;
  return typeof s === "string" && RANGE.test(s) ? s : undefined;
};

export const Route = createFileRoute("/data-center/call-centre")({
  validateSearch: (search: Record<string, unknown>): CallCentreSearch => ({
    organizationId: str(search.organizationId),
    partnerState: str(search.partnerState),
    transferSalesRep: str(search.transferSalesRep),
    assignedAgent: str(search.assignedAgent),
    agentManager: str(search.agentManager),
    status: str(search.status),
    label: str(search.label),
    preset: str(search.preset),
    verificationOutcome: str(search.verificationOutcome),
    standing: str(search.standing),
    period: str(search.period),
    logPeriod: str(search.logPeriod),
    day: typeof search.day === "string" && DAY.test(search.day) ? search.day : undefined,
    range: rangeOf(search.range),
  }),
  beforeLoad: ({ search }) => {
    if (NARROWING.some((k) => search[k])) {
      const { day: _day, range: _range, logPeriod: _log, ...rest } = search;
      throw redirect({ to: "/data-center/call-centre/records", search: rest });
    }
  },
  component: Page,
});
