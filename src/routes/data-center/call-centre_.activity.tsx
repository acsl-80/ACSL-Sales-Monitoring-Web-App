import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Page = lazy(() => import("@/app/data-center/pages/CallCentreActivityPage"));

/**
 * What happened in the call centre (Phase 26, C2): calls logged, batches
 * handed out or reclaimed, records sent back, fixes reviewed. Filters live in
 * the URL; the keyset cursor does not. Bare dates in `from` and `to` are whole
 * call-centre days.
 */
type ActivitySearch = {
  from?: string;
  to?: string;
  agentId?: string;
  kind?: string;
  outcome?: string;
  organizationId?: string;
  q?: string;
  limit?: number;
};

const str = (v: unknown) => (typeof v === "string" && v !== "" ? v : undefined);

export const Route = createFileRoute("/data-center/call-centre_/activity")({
  validateSearch: (search: Record<string, unknown>): ActivitySearch => ({
    from: str(search.from),
    to: str(search.to),
    agentId: str(search.agentId),
    kind: str(search.kind),
    outcome: str(search.outcome),
    organizationId: str(search.organizationId),
    q: str(search.q),
    limit: Number.isFinite(Number(search.limit)) && Number(search.limit) > 0 ? Number(search.limit) : undefined,
  }),
  component: Page,
});
