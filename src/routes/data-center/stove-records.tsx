import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Page = lazy(() => import("@/app/data-center/pages/StoveRecordsPage"));

/**
 * The dashboard drills in here by URL, the same way it drills into the call
 * centre. Drill-through is never component state, so back restores the
 * dashboard and a narrowed table can be sent to someone as a link.
 *
 * Every param here already exists as a server filter in RecordsFilters, so
 * nothing is narrowed in the browser.
 */
type StoveRecordsSearch = {
  organizationId?: string;
  userState?: string;
  saleStatus?: string;
  dateFrom?: string;
  dateTo?: string;
  label?: string;
  /**
   * The shared period control, as one parameter. `thisYear` is the default and
   * is left out of the URL entirely, so an unfiltered link stays clean.
   */
  period?: string;
};

const str = (v: unknown) => (typeof v === "string" && v !== "" ? v : undefined);

export const Route = createFileRoute("/data-center/stove-records")({
  validateSearch: (search: Record<string, unknown>): StoveRecordsSearch => ({
    organizationId: str(search.organizationId),
    userState: str(search.userState),
    saleStatus: str(search.saleStatus),
    dateFrom: str(search.dateFrom),
    dateTo: str(search.dateTo),
    label: str(search.label),
    period: str(search.period),
  }),
  component: Page,
});
