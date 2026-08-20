import DataCentreShell from "../components/DataCentreShell";
import PartnerRecords from "../features/partner-records/PartnerRecords";
import { DATA_CENTER_FEATURES } from "../lib/features";

export default function PartnerRecordsPage() {
  return (
    <DataCentreShell
      title="Partner Records"
      description="What was issued to each partner, and how much of it has come back."
      breadcrumb="Partner Records"
      feature={DATA_CENTER_FEATURES.RECORDS_VIEW}
    >
      <PartnerRecords />
    </DataCentreShell>
  );
}
