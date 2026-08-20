import { useMemo } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import DataCentreShell from "../components/DataCentreShell";
import CallQueue from "../features/call-centre/CallQueue";
import AssignmentLog from "../features/call-centre/AssignmentLog";
import { useFeature } from "../lib/access";
import { DATA_CENTER_FEATURES } from "../lib/features";

/** The scorecard columns, said the way the dashboard says them. */
const STATUS_LABELS = {
  verified: "verified",
  unverified: "unverified",
  unreachable: "unreachable",
  unresolved: "yet to be resolved",
};

function Inner() {
  const { can, isSuperAdmin } = useFeature();
  const search = useSearch({ from: "/data-center/call-centre" });
  const navigate = useNavigate();

  // A drill-through arrives as URL params, gets translated to server filters
  // here, and is cleared by navigating to the bare URL. Nothing is held in
  // state, which is what lets back restore the dashboard and lets a filtered
  // queue be sent to someone as a link.
  const drill = useMemo(() => {
    const filters = {};
    for (const key of [
      "organizationId", "partnerState", "transferSalesRep", "assignedAgent", "agentManager",
    ]) {
      if (search[key]) filters[key] = search[key];
    }
    if (search.status && STATUS_LABELS[search.status]) {
      filters.outcomeGroup = search.status;
    }
    if (Object.keys(filters).length === 0) return null;
    const subject = search.label ?? "a scorecard row";
    return {
      filters,
      description: filters.outcomeGroup
        ? `${subject}: ${STATUS_LABELS[search.status]}`
        : subject,
      clear: () => navigate({ to: "/data-center/call-centre", search: {} }),
    };
  }, [search, navigate]);

  return (
    <div className="space-y-4">
      <CallQueue canEdit={can(DATA_CENTER_FEATURES.CALL_RECORDS_EDIT)} drill={drill} />
      {/* The log needs records.view on the server. Gating on the same key here
          keeps the page honest: nothing renders that the endpoint would 403.
          The levers inside it are super admin only, decided again server-side. */}
      {can(DATA_CENTER_FEATURES.RECORDS_VIEW) && (
        <AssignmentLog canRun={isSuperAdmin} />
      )}
    </div>
  );
}

export default function CallCentrePage() {
  return (
    <DataCentreShell
      title="Call Centre"
      description="The verification queue, and what each call concluded."
      breadcrumb="Call Centre"
      feature={DATA_CENTER_FEATURES.CALL_RECORDS_VIEW}
    >
      <Inner />
    </DataCentreShell>
  );
}
