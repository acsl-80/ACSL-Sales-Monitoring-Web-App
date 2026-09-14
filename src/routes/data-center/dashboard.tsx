import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Page = lazy(() => import("@/app/data-center/pages/DashboardPage"));

type DashboardSearch = {
  /**
   * The shared period control, as one parameter, exactly as the other Data
   * Center surfaces carry it. `thisYear` is the default and is left out of the
   * URL entirely, so an unfiltered link stays clean.
   *
   * The dashboard could only ever show all time until its metrics gained a
   * month grain. A narrowed view is a URL here for the same reason it is
   * everywhere else in the module: the back button restores it, and a figure
   * somebody is about to quote can be sent as a link rather than described.
   */
  period?: string;
};

const str = (v: unknown) => (typeof v === "string" && v !== "" ? v : undefined);

export const Route = createFileRoute("/data-center/dashboard")({
  validateSearch: (search: Record<string, unknown>): DashboardSearch => ({
    period: str(search.period),
  }),
  component: Page,
});
