import { useParams } from "@tanstack/react-router";
import DataCentreShell from "../components/DataCentreShell";
import StoveRecord from "../features/stove-record/StoveRecord";
import StoveFinder from "../features/stove-record/StoveFinder";
import { DATA_CENTER_FEATURES } from "../lib/features";

/**
 * The serial is in the URL, so a record can be sent to somebody as a link.
 *
 * That is the whole reason this is a route rather than a panel: the question
 * "what happened to PRV000123" gets asked between people, and the answer has to
 * be something you can paste into a message.
 *
 * The finder sits above the record rather than only on the way in, because the
 * common next act after reading one record is reading another - a colleague
 * reads out the next serial off the same pile of receipts.
 */
function Inner() {
  const { stoveId } = useParams({ from: "/data-center/stove/$stoveId" });
  return (
    <div className="space-y-4">
      <StoveFinder />
      <StoveRecord key={stoveId} stoveId={stoveId} />
    </div>
  );
}

export default function StoveRecordPage() {
  return (
    <DataCentreShell
      title="Stove Record"
      description="Everything one stove ID anchors: the transfer, the sale, the calls and every edit."
      breadcrumb="Stove Record"
      area="stove-records"
      feature={DATA_CENTER_FEATURES.RECORDS_VIEW}
    >
      <Inner />
    </DataCentreShell>
  );
}
