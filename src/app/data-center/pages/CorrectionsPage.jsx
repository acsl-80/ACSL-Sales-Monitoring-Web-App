import DataCentreShell from "../components/DataCentreShell";
import SendBackList from "../features/corrections/SendBackList";
import { DATA_CENTER_FEATURES } from "../lib/features";

/**
 * /data-center/corrections - the records the call centre sent back.
 *
 * Its own page rather than a panel on the call centre, because the people it
 * is for are not call agents. A sales rep opens this and nothing else in the
 * module; a standing recipient opens it as the first thing every morning. A
 * panel three scrolls down somebody else's page would be neither.
 *
 * Gated on corrections.fix, which is the only key the sales_rep level holds -
 * so a rep granted that level lands here, sees the stoves from their own
 * consignments, and finds no other door open.
 */
export default function CorrectionsPage() {
  return (
    <DataCentreShell
      title="Records to fix"
      description="Sent back from the call centre because something on the record did not hold up. Fix it, say what you did, and it goes back to be called again."
      breadcrumb="Records to fix"
      area="call-centre"
      feature={DATA_CENTER_FEATURES.CORRECTIONS_FIX}
    >
      <SendBackList />
    </DataCentreShell>
  );
}
