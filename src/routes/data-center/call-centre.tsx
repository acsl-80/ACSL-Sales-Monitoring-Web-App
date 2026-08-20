import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

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
};

const str = (v: unknown) => (typeof v === "string" && v !== "" ? v : undefined);

export const Route = createFileRoute("/data-center/call-centre")({
  validateSearch: (search: Record<string, unknown>): CallCentreSearch => ({
    organizationId: str(search.organizationId),
    partnerState: str(search.partnerState),
    transferSalesRep: str(search.transferSalesRep),
    assignedAgent: str(search.assignedAgent),
    agentManager: str(search.agentManager),
    status: str(search.status),
    label: str(search.label),
  }),
  component: Page,
});
