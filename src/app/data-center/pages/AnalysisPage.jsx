import DataCentreShell from "../components/DataCentreShell";
import Analysis from "../features/analysis/Analysis";
import { useFeature } from "../lib/access";
import { DATA_CENTER_FEATURES } from "../lib/features";

function Inner() {
  const { isSuperAdmin } = useFeature();
  return <Analysis canRun={isSuperAdmin} />;
}

export default function AnalysisPage() {
  return (
    <DataCentreShell
      title="Analysis"
      description="What the collected data says. Computed figures, as of the last run."
      breadcrumb="Analysis"
      area="analysis"
      feature={DATA_CENTER_FEATURES.ANALYSIS_VIEW}
    >
      <Inner />
    </DataCentreShell>
  );
}
