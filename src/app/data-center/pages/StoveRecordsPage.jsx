import DataCentreShell from "../components/DataCentreShell";
import RecordsTable from "../features/records/RecordsTable";
import { DATA_CENTER_FEATURES } from "../lib/features";

export default function StoveRecordsPage() {
  return (
    <DataCentreShell
      title="Stove Records"
      description="Every sold stove with the detail captured at the point of sale."
      breadcrumb="Stove Records"
      area="stove-records"
      feature={DATA_CENTER_FEATURES.RECORDS_VIEW}
    >
      <RecordsTable />
    </DataCentreShell>
  );
}
