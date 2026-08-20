import DataCentreShell from "../components/DataCentreShell";
import CallQueue from "../features/call-centre/CallQueue";
import AssignmentLog from "../features/call-centre/AssignmentLog";
import { useFeature } from "../lib/access";
import { DATA_CENTER_FEATURES } from "../lib/features";

function Inner() {
  const { can, isSuperAdmin } = useFeature();
  return (
    <div className="space-y-4">
      <CallQueue canEdit={can(DATA_CENTER_FEATURES.CALL_RECORDS_EDIT)} />
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
