import DataCentreShell from "../components/DataCentreShell";
import ImportPanel from "../features/import/ImportPanel";
import { useFeature } from "../lib/access";
import { DATA_CENTER_FEATURES } from "../lib/features";

function Inner() {
  const { can } = useFeature();
  return (
    <ImportPanel
      canUpload={can(DATA_CENTER_FEATURES.IMPORT_UPLOAD)}
      canCommit={can(DATA_CENTER_FEATURES.IMPORT_COMMIT)}
      canResolve={can(DATA_CENTER_FEATURES.IMPORT_EXCEPTIONS)}
    />
  );
}

export default function ImportPage() {
  return (
    <DataCentreShell
      title="Bulk Import"
      description="Digitalized receipts from the field, staged against stock."
      breadcrumb="Bulk Import"
      area="import"
      feature={DATA_CENTER_FEATURES.IMPORT_UPLOAD}
    >
      <Inner />
    </DataCentreShell>
  );
}
