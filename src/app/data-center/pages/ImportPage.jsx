import { useState } from "react";
import DataCentreShell from "../components/DataCentreShell";
import ImportPanel from "../features/import/ImportPanel";
import ConfirmationQueue from "../features/import/ConfirmationQueue";
import Workbench from "../features/workbench/Workbench";
import { useFeature } from "../lib/access";
import { DATA_CENTER_FEATURES } from "../lib/features";
import { Upload, PenLine, ShieldCheck } from "lucide-react";

/**
 * Getting paper into the system, three ways of looking at one job.
 *
 * A spreadsheet somebody filled in away from the app, a bench for working
 * through receipts one at a time, and the desk where what has been entered is
 * released. They are tabs rather than three pages because they are one
 * activity: the same person does all three in a morning, and making them
 * navigate away and back between each would be making them lose their place.
 *
 * Which tabs exist depends on what the person holds. A viewer with
 * import.upload but no import.commit can enter and cannot release, and the
 * confirmation tab says so rather than hiding: knowing the step exists is part
 * of understanding why nothing has appeared in the sales app yet.
 */

const TABS = [
  {
    key: "bulk",
    label: "Bulk import",
    icon: Upload,
    blurb: "Upload a spreadsheet somebody has already filled in.",
    needs: DATA_CENTER_FEATURES.IMPORT_UPLOAD,
  },
  {
    key: "bench",
    label: "Digitalisation workbench",
    icon: PenLine,
    blurb: "Work through a partner's stoves one receipt at a time.",
    needs: DATA_CENTER_FEATURES.DIGITISATION_WORK,
  },
  {
    key: "confirm",
    label: "Waiting to confirm",
    icon: ShieldCheck,
    blurb: "What has been entered and not yet sent to the sales app.",
    needs: DATA_CENTER_FEATURES.RECORDS_VIEW,
  },
];

function Inner() {
  const { can } = useFeature();
  const available = TABS.filter((t) => can(t.needs));
  const [tab, setTab] = useState(available[0]?.key ?? "bulk");
  const current = available.find((t) => t.key === tab) ?? available[0];

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-gray-200 border-t-[3px] border-t-(--dc-accent) bg-(--dc-accent-soft)/30 p-4 shadow-sm">
        <div className="flex flex-wrap gap-1.5">
          {available.map((t) => {
            const selected = current?.key === t.key;
            return (
              <button
                key={t.key}
                type="button"
                aria-pressed={selected}
                onClick={() => setTab(t.key)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                  selected
                    ? "border-(--dc-accent) bg-(--dc-accent) text-white"
                    : "border-gray-300 bg-white text-gray-700 hover:border-(--dc-accent)/40 hover:bg-(--dc-accent-soft)/50"
                }`}
              >
                <t.icon className="h-4 w-4" />
                {t.label}
              </button>
            );
          })}
        </div>
        {current?.blurb && <p className="mt-2 text-sm text-gray-600">{current.blurb}</p>}
      </div>

      {current?.key === "bulk" && (
        <ImportPanel
          canUpload={can(DATA_CENTER_FEATURES.IMPORT_UPLOAD)}
          canCommit={can(DATA_CENTER_FEATURES.IMPORT_COMMIT)}
          canResolve={can(DATA_CENTER_FEATURES.IMPORT_EXCEPTIONS)}
        />
      )}
      {current?.key === "bench" && <Workbench />}
      {current?.key === "confirm" && (
        <ConfirmationQueue canConfirm={can(DATA_CENTER_FEATURES.IMPORT_COMMIT)} />
      )}
    </div>
  );
}

export default function ImportPage() {
  return (
    <DataCentreShell
      title="Bulk Import"
      description="Paper receipts into records: uploaded in bulk, typed at the bench, released on confirmation."
      breadcrumb="Bulk Import"
      area="import"
      // Either way in opens it. The tabs then narrow to what the person
      // actually holds, so somebody with only the bench does not land on an
      // upload panel they cannot use.
      feature={[DATA_CENTER_FEATURES.IMPORT_UPLOAD, DATA_CENTER_FEATURES.DIGITISATION_WORK]}
    >
      <Inner />
    </DataCentreShell>
  );
}
