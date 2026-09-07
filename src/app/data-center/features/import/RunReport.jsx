import { AlertTriangle, CheckCircle2 } from "lucide-react";
import Steps from "../../components/Steps";
import Unlanded from "../../components/Unlanded";

/**
 * What the last run said, in one place above the list.
 *
 * The steps outlive `busy` on purpose. The old progress line was hidden the
 * moment a run ended, so the last thing it showed vanished at exactly the
 * moment somebody wanted to read it, leaving "Commit finished." as the whole
 * account of a run that may have refused half the file.
 *
 * Nothing is decided here. ImportPanel holds all four pieces; this draws them
 * and disappears when there are none.
 */
export default function RunReport({ error, notice, steps, unlanded, phase }) {
  if (!error && !notice && !steps?.length && !unlanded?.length) return null;
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 border-t-[3px] border-t-(--dc-accent) bg-white shadow-sm">
      {error && (
        <div className="flex items-start gap-2 border-b border-amber-300 bg-amber-50 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="text-sm text-amber-900">{error}</p>
        </div>
      )}
      {notice && (
        <div className="flex items-start gap-2 border-b border-(--dc-primary)/20 bg-(--dc-primary-soft)/50 px-4 py-3">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-(--dc-accent)" />
          <p className="text-sm text-(--dc-accent)">{notice}</p>
        </div>
      )}
      <Steps steps={steps} />
      <Unlanded groups={unlanded} phase={phase} />
    </div>
  );
}
