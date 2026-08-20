import DataCentreShell from "../components/DataCentreShell";
import ImportSection from "../features/import/ImportSection";
import { useFeature } from "../lib/access";
import { DATA_CENTER_FEATURES } from "../lib/features";

function Inner() {
  const { can } = useFeature();
  return (
    <ImportSection
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
      description="Digitalized receipts. Nothing is committed until you say so."
      breadcrumb="Bulk Import"
      feature={DATA_CENTER_FEATURES.IMPORT_UPLOAD}
    >
      <Inner />
    </DataCentreShell>
  );
}
