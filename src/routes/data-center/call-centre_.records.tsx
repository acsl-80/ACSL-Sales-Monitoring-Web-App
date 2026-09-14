import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Page = lazy(() => import("@/app/data-center/pages/CallCentreRecordsPage"));

/**
 * The call centre's records (Phase 26, C3): the queue that used to sit under
 * the control centre, on its own page with an outcome strip above it. The
 * dashboard's drills land here by URL, which is the module's rule: drill
 * through is never component state, so back restores the dashboard and a
 * narrowed table can be sent to someone as a link.
 *
 * The parameters are the ones the call-centre page accepted before, kept
 * word for word so every existing link keeps its meaning.
 */
type RecordsSearch = {
  organizationId?: string;
  partnerState?: string;
  transferSalesRep?: string;
  assignedAgent?: string;
  agentManager?: string;
  status?: string;
  label?: string;
  preset?: string;
  verificationOutcome?: string;
  /** One or more of the six standings, comma-separated (D41). */
  standing?: string;
  period?: string;
};

const str = (v: unknown) => (typeof v === "string" && v !== "" ? v : undefined);

export const Route = createFileRoute("/data-center/call-centre_/records")({
  validateSearch: (search: Record<string, unknown>): RecordsSearch => ({
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
  }),
  component: Page,
});
