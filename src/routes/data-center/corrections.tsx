import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";
import { narrowingFrom, type CorrectionsNarrowing } from "@/app/data-center/lib/correctionsSearch";

const Page = lazy(() => import("@/app/data-center/pages/CorrectionsPage"));

const TABS = new Set(["open", "fixed", "resolved"]);

export type CorrectionsSearch = {
  /** Which list opens: open (waiting on Sales), fixed (awaiting review), resolved. */
  tab?: "open" | "fixed" | "resolved";
} & CorrectionsNarrowing;

export const Route = createFileRoute("/data-center/corrections")({
  // Drill-through is a URL, never component state: a dashboard tile lands on
  // the tab it counted, and back restores it.
  validateSearch: (search: Record<string, unknown>): CorrectionsSearch => ({
    tab: TABS.has(String(search.tab)) ? (String(search.tab) as CorrectionsSearch["tab"]) : undefined,
    ...narrowingFrom(search),
  }),
  component: Page,
});
