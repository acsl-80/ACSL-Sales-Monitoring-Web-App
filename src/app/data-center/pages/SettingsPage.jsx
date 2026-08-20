import DataCentreShell from "../components/DataCentreShell";
import AccessManager from "../features/access/AccessManager";
import ChangeLog from "../features/access/ChangeLog";
import { DATA_CENTER_FEATURES } from "../lib/features";

/**
 * /data-center/settings — administration of the module itself.
 *
 * Two things, in this order. Access comes first because it is the thing an
 * administrator opens this page to do: decide who is in and at what level. The
 * log comes second because it is the thing they read afterwards, and reading it
 * takes room the hub could not give it.
 *
 * Both were panels stacked under the Explore grid until now, which put the
 * module's administration in the way of everybody who was only passing through
 * on their way to a queue.
 */
export default function SettingsPage() {
  return (
    <DataCentreShell
      title="Settings"
      description="Who may use the Data Center, and everything that has been changed inside it."
      breadcrumb="Settings"
      area="settings"
      feature={DATA_CENTER_FEATURES.GRANTS_MANAGE}
    >
      <div className="space-y-4">
        <AccessManager />
        <ChangeLog />
      </div>
    </DataCentreShell>
  );
}
