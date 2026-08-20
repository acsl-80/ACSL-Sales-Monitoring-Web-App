import { useMemo } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import DataCentreShell from "../components/DataCentreShell";
import CallQueue from "../features/call-centre/CallQueue";
import AssignmentConsole from "../features/call-centre/AssignmentConsole";
import AssignmentLog from "../features/call-centre/AssignmentLog";
import { useFeature } from "../lib/access";
import { DATA_CENTER_FEATURES } from "../lib/features";

/** The queue's own presets, named so a drill banner can say which one it took. */
const PRESET_LABELS = {
  todo: "never called",
  unresolved: "still to verify",
  exhausted: "chased three times and still not verified",
  correction: "waiting on Sales",
};

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
    // One exact outcome, where a scorecard column's group of four is wider than
    // the number the reader clicked.
    if (search.verificationOutcome) {
      filters.verificationOutcome = search.verificationOutcome;
    }

    const preset = PRESET_LABELS[search.preset] ? search.preset : null;
    if (Object.keys(filters).length === 0 && !preset) return null;

    const subject = search.label
      ?? (preset ? PRESET_LABELS[preset] : null)
      ?? (search.verificationOutcome
        ? search.verificationOutcome.replace(/_/g, " ")
        : "a scorecard row");

    return {
      preset,
      filters,
      description: filters.outcomeGroup
        ? `${subject}: ${STATUS_LABELS[search.status]}`
        : subject,
      clear: () => navigate({ to: "/data-center/call-centre", search: {} }),
    };
  }, [search, navigate]);

  return (
    <div className="space-y-4">
      <CallQueue
        key={drill?.preset ?? "all"}
        canEdit={can(DATA_CENTER_FEATURES.CALL_RECORDS_EDIT)}
        drill={drill}
      />
      {/* The console before the log, because who holds what right now is asked
          far more often than what happened last week. Both need records.view on
          the server; gating on the same key here keeps the page honest, since
          nothing renders that the endpoint would 403. The levers inside are
          super admin only, decided again server-side. */}
      {isSuperAdmin && <AssignmentConsole canEdit />}
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
      area="call-centre"
      feature={DATA_CENTER_FEATURES.CALL_RECORDS_VIEW}
    >
      <Inner />
    </DataCentreShell>
  );
}
