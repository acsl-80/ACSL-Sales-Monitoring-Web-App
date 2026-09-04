import { useParams } from "@tanstack/react-router";
import DataCentreShell from "../components/DataCentreShell";
import CorrectionWorkspace from "../features/corrections/CorrectionWorkspace";
import { DATA_CENTER_FEATURES } from "../lib/features";

/**
 * /data-center/corrections/:saleId
 *
 * Its own route rather than a panel on the stove page: the stove page needs
 * records.view, which a sales rep does not hold, and it is already past the
 * module's file-size rule. Here the rep sees exactly one record, the one that
 * came back to them, with the disputed items marked and the way to fix them.
 */
function Inner() {
  const { saleId } = useParams({ from: "/data-center/corrections/$saleId" });
  return <CorrectionWorkspace key={saleId} saleId={saleId} />;
}

export default function CorrectionWorkspacePage() {
  return (
    <DataCentreShell
      title="Fix this record"
      description="What the call centre questioned is marked. Change it, say what you did, and it goes to the call centre for review."
      breadcrumb="Fix this record"
      area="call-centre"
      feature={DATA_CENTER_FEATURES.CORRECTIONS_FIX}
    >
      <Inner />
    </DataCentreShell>
  );
}
