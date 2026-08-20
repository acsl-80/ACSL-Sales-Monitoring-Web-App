import DataCentreShell from "../components/DataCentreShell";
import Dashboard from "../features/dashboard/Dashboard";
import { useFeature } from "../lib/access";
import { DATA_CENTER_FEATURES } from "../lib/features";

function Inner() {
  const { isSuperAdmin } = useFeature();
  return <Dashboard canRun={isSuperAdmin} />;
}

export default function DashboardPage() {
  return (
    <DataCentreShell
      title="Dashboard"
      description="Computed figures. Nothing here is counted at page load."
      breadcrumb="Dashboard"
      area="dashboard"
      feature={DATA_CENTER_FEATURES.DASHBOARD_VIEW}
    >
      <Inner />
    </DataCentreShell>
  );
}
