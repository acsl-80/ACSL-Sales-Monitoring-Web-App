import DataCentreShell from "../components/DataCentreShell";
import AccessManager from "../features/access/AccessManager";
import ChangeLog from "../features/access/ChangeLog";
import CallFormEditor from "../features/settings/CallFormEditor";
import Variables from "../features/settings/Variables";
import FieldRules from "../features/settings/FieldRules";
import SendBackRouting from "../features/settings/SendBackRouting";
import { DATA_CENTER_FEATURES } from "../lib/features";

/**
 * /data-center/settings — administration of the module itself.
 *
 * In the order an administrator works: who is in and at what level, then what
 * the call form asks, then the numbers every rule reads, then the log of what
 * everyone has done. Access first because it is the thing this page is opened
 * to do; the log last because it is read afterwards and needs the room.
 *
 * All four were panels stacked under the Explore grid, or nowhere at all. The
 * page is gated on grants.manage, which a super admin always holds and which
 * can be ticked on for anyone else from the access panel above.
 */
export default function SettingsPage() {
  return (
    <DataCentreShell
      title="Settings"
      description="Who may use the Data Center, what the call form asks, and everything that has been changed inside it."
      breadcrumb="Settings"
      area="settings"
      feature={DATA_CENTER_FEATURES.GRANTS_MANAGE}
    >
      <div className="space-y-4">
        <AccessManager />
        {/*
          Above the call form on purpose. Who receives a send-back is a
          question somebody asks the day the call centre starts sending them,
          and it decides whether anybody sees the answer at all - where the
          call form's wording is something they tune afterwards.
        */}
        <SendBackRouting canEdit />
        <CallFormEditor />
        <FieldRules />
        <Variables />
        <ChangeLog />
      </div>
    </DataCentreShell>
  );
}
