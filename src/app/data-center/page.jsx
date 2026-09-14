import DataCentreShell from "./components/DataCentreShell";
import Explore from "./Explore";

/**
 * /data-center — the hub.
 *
 * Every area lives behind its own route now. This page points at them and
 * carries nothing else, which is why it is four lines.
 */
export default function DataCenterPage() {
  return (
    <DataCentreShell
      title="Data Center"
      description="Computation and dashboards over sold stove records"
    >
      <Explore />
    </DataCentreShell>
  );
}
