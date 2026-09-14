import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Page = lazy(() => import("@/app/data-center/pages/CorrectionsPage"));

const TABS = new Set(["open", "fixed", "resolved"]);

export type CorrectionsSearch = {
  /** Which list opens: open (waiting on Sales), fixed (awaiting review), resolved. */
  tab?: "open" | "fixed" | "resolved";
  /** Only what is routed to the signed-in person. */
  mine?: boolean;
};

export const Route = createFileRoute("/data-center/corrections")({
  // Drill-through is a URL, never component state: a dashboard tile lands on
  // the tab it counted, and back restores it.
  validateSearch: (search: Record<string, unknown>): CorrectionsSearch => ({
    tab: TABS.has(String(search.tab)) ? (String(search.tab) as CorrectionsSearch["tab"]) : undefined,
    mine: search.mine === true || search.mine === "1" || search.mine === "true" ? true : undefined,
  }),
  component: Page,
});
