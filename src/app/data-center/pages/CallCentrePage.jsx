import DataCentreShell from "../components/DataCentreShell";
import CallQueue from "../features/call-centre/CallQueue";
import { useFeature } from "../lib/access";
import { DATA_CENTER_FEATURES } from "../lib/features";

function Inner() {
  const { can } = useFeature();
  return <CallQueue canEdit={can(DATA_CENTER_FEATURES.CALL_RECORDS_EDIT)} />;
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
