import Link from "@/compat/Link";
import { ArrowLeft } from "lucide-react";
import DataCentreShell from "../components/DataCentreShell";
import SharedPhones from "../features/call-centre/SharedPhones";
import { DATA_CENTER_FEATURES } from "../lib/features";

/**
 * /data-center/call-centre/shared-phones (Phase 26, C3)
 *
 * The register of phone numbers carrying more than one stove, on its own
 * page. It sat mid-scroll on the call-centre page and never said what to do;
 * here the line at the top says it, and the control centre's "Review" lands
 * on it. The register itself is the component that already existed.
 */
function Inner() {
  return (
    <div className="space-y-4">
      <Link href="/data-center/call-centre" className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2.5 py-1 text-xs font-semibold text-gray-700 hover:border-(--dc-accent)">
        <ArrowLeft className="h-3.5 w-3.5" /> Control centre
      </Link>
      <p className="max-w-3xl rounded-lg border border-(--dc-brief-place) bg-white px-4 py-3 text-sm text-gray-800 shadow-[inset_0_0_0_3px_var(--dc-brief-place-soft)]">
        A number on two stoves is rung once, and the call decides. A number flagged at digitisation is a guess; one confirmed on a call is a fact. Confirm records that one buyer holds both stoves. A number that turns out wrong goes back to Sales from the call form, with the reason filled in.
      </p>
      <div id="shared-phones">
        <SharedPhones />
      </div>
    </div>
  );
}

export default function CallCentreSharedPhonesPage() {
  return (
    <DataCentreShell
      title="Shared phone numbers"
      description="Numbers that carry more than one stove, where the suspicion came from, and whether a call has confirmed it."
      breadcrumb="Shared phone numbers"
      area="call-centre"
      feature={DATA_CENTER_FEATURES.RECORDS_VIEW}
    >
      <Inner />
    </DataCentreShell>
  );
}
