import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import DataCentreShell from "../components/DataCentreShell";
import ImportPanel from "../features/import/ImportPanel";
import GetTheSheet from "../features/import/GetTheSheet";
import ConfirmationQueue from "../features/import/ConfirmationQueue";
import CallSheet from "../features/import/CallSheet";
import Workbench from "../features/workbench/Workbench";
import ImportFigures from "../features/import/parts/ImportFigures";
import { useImportFigures } from "../features/import/parts/useImportFigures";
import DigitisationTeam from "../features/import/DigitisationTeam";
import { useFeature } from "../lib/access";
import { DATA_CENTER_FEATURES } from "../lib/features";
import { usePeriod } from "../lib/usePeriod";
import { Upload, PenLine, ShieldCheck, PhoneCall, Users } from "lucide-react";

/**
 * Getting paper into the system, four ways of looking at one job.
 *
 * A spreadsheet somebody filled in away from the app, a bench for working
 * through receipts one at a time, a sheet of calls an agent already made, and
 * the desk where what has been entered is released. They are modes of one page
 * rather than four pages because they are one activity: the same person does
 * them in a morning, and navigating away between each would lose their place.
 *
 * Import redesign, 2026-09-07 (D37): the mode lives in the URL beside the
 * period, so a reload, a deploy, back and a shared link land where the person
 * was. Four figures over the modes are doors into them, counted from reads
 * the modes already make. Which modes exist depends on what the person holds.
 */

const ROUTE_ID = "/data-center/import";

const MODES = [
  {
    key: "bulk",
    label: "Bulk import",
    icon: Upload,
    blurb:
      "Many receipts at once: a sheet the system has filled with serial numbers, typed into away from the app, uploaded back.",
    needs: DATA_CENTER_FEATURES.IMPORT_UPLOAD,
  },
  {
    key: "bench",
    label: "One receipt at a time",
    icon: PenLine,
    blurb:
      "The digitalisation workbench: a partner's stoves worked through in the app, one receipt per stove.",
    needs: DATA_CENTER_FEATURES.DIGITISATION_WORK,
  },
  {
    key: "calls",
    label: "Calls already made",
    icon: PhoneCall,
    blurb:
      "Calls an agent already made on their own spreadsheet, attached to records that exist. It never creates a sale.",
    // Its own grant, not import.upload: an occasional backlog intake that the
    // people digitalising receipts all day should not see.
    needs: DATA_CENTER_FEATURES.CALL_IMPORT,
  },
  {
    key: "confirm",
    label: "Waiting to confirm",
    icon: ShieldCheck,
    blurb: "What has been entered and not yet sent to the sales app.",
    needs: DATA_CENTER_FEATURES.RECORDS_VIEW,
  },
  {
    key: "team",
    label: "Who is digitising",
    icon: Users,
    blurb:
      "Who entered what, by day: receipts typed at the bench and rows uploaded in files, and how many of them landed.",
    needs: DATA_CENTER_FEATURES.RECORDS_VIEW,
  },
];

function Inner() {
  const { can } = useFeature();
  const available = MODES.filter((m) => can(m.needs));
  const search = useSearch({ from: ROUTE_ID });
  const navigate = useNavigate();
  const current = available.find((m) => m.key === search.mode) ?? available[0];
  const setMode = (key) => {
    // A push, not a replace: back returns to the mode the person left.
    navigate({ to: ROUTE_ID, search: (prev) => ({ ...prev, mode: key }) });
  };
  const hrefFor = (key) => {
    const q = new URLSearchParams();
    q.set("mode", key);
    if (search.period) q.set("period", search.period);
    return `${ROUTE_ID}?${q.toString()}`;
  };
  const uploadRef = useRef(null);

  /*
   * Once the bench has been opened it stays mounted, hidden by CSS while
   * another mode is up. Unmounting it threw away the open partner, the search
   * term and the page every time somebody glanced at the confirmation queue,
   * losing their place in the middle of a run of forty receipts. Mounted but
   * hidden, its drafts also keep autosaving through the visit. It is not
   * mounted before the first visit: somebody working bulk uploads all day
   * should not pay for a workbench they never open.
   */
  const [benchLive, setBenchLive] = useState(false);
  useEffect(() => {
    if (current?.key === "bench") setBenchLive(true);
  }, [current?.key]);

  const { resolved } = usePeriod(ROUTE_ID);
  const canBatches =
    can(DATA_CENTER_FEATURES.IMPORT_UPLOAD) || can(DATA_CENTER_FEATURES.CALL_IMPORT);
  const canQueue = can(DATA_CENTER_FEATURES.RECORDS_VIEW);
  const { counts } = useImportFigures({
    canBatches,
    canQueue,
    dateFrom: resolved.dateFrom,
    dateTo: resolved.dateTo,
    mode: current?.key,
  });
  const has = (key) => available.some((m) => m.key === key);
  const figures = [
    canBatches && {
      key: "needs-person",
      value: counts.needsPerson,
      label: "rows waiting on a person",
      tone: "unverified",
      href: has("bulk") ? hrefFor("bulk") : null,
    },
    canQueue && {
      key: "awaiting",
      value: counts.awaiting,
      label: "records waiting to be confirmed",
      tone: "verified",
      href: has("confirm") ? hrefFor("confirm") : null,
    },
    canBatches && {
      key: "landed",
      value: counts.landed,
      label: "records landed this period",
      tone: "sold",
      href: has("bulk") ? hrefFor("bulk") : null,
    },
    canQueue && {
      key: "drafting",
      value: counts.drafting,
      label: "still being drafted at the bench",
      tone: "transferred",
      href: has("bench") ? hrefFor("bench") : null,
    },
  ];
  const tabCount = { bulk: counts.files, calls: counts.sheets, confirm: counts.awaiting };
  const tabWord = { bulk: ["file", "files"], calls: ["sheet", "sheets"], confirm: null };

  return (
    <div className="space-y-4">
      <ImportFigures figures={figures} />

      {/*
        The modes as a segmented control on a card of their own, so the row
        reads as the page's steering wheel rather than a line of grey text: the
        chosen mode is a solid fill in the area's accent with white type, the
        others are outlined buttons with dark type, and each count is a pill.
        The card shares the module's radius, border and top rail, so it sits
        with the cards below it instead of floating between them.
      */}
      <div className="rounded-xl border border-gray-200 border-t-[3px] border-t-(--dc-accent) bg-white shadow-sm">
        <div
          className="flex gap-2 overflow-x-auto px-3 pt-3 pb-2"
          role="group"
          aria-label="What to do"
        >
          {available.map((m) => {
            const selected = current?.key === m.key;
            const n = tabCount[m.key];
            const w = tabWord[m.key];
            const small =
              n == null
                ? null
                : w
                  ? `${n.toLocaleString()} ${n === 1 ? w[0] : w[1]}`
                  : n.toLocaleString();
            return (
              <button
                key={m.key}
                type="button"
                aria-pressed={selected}
                onClick={() => setMode(m.key)}
                data-import-mode={m.key}
                className={`inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border px-3.5 py-2 text-sm font-semibold transition ${
                  selected
                    ? "border-(--dc-accent) bg-(--dc-accent) text-white shadow-sm"
                    : "border-gray-300 bg-white text-gray-800 hover:border-(--dc-accent) hover:bg-(--dc-accent-soft)/50"
                }`}
              >
                <m.icon
                  className={`h-4 w-4 ${selected ? "text-white" : "text-(--dc-accent)"}`}
                  aria-hidden
                />
                {m.label}
                {small && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums ${
                      selected
                        ? "bg-white/20 text-white"
                        : "bg-(--dc-accent-soft) text-(--dc-accent-strong)"
                    }`}
                  >
                    {small}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {current?.blurb && (
          <p className="border-t border-gray-100 px-4 py-2 text-sm text-gray-700">
            {current.blurb}
          </p>
        )}
      </div>

      {current?.key === "bulk" && (
        <>
          {/* The path first, the panel second: a file only exists because
              somebody got a sheet, so the page reads in the order the job
              happens. */}
          {can(DATA_CENTER_FEATURES.IMPORT_UPLOAD) && (
            <GetTheSheet
              onGoToUpload={() =>
                uploadRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
              }
            />
          )}
          <div ref={uploadRef}>
            <ImportPanel
              canUpload={can(DATA_CENTER_FEATURES.IMPORT_UPLOAD)}
              canCommit={can(DATA_CENTER_FEATURES.IMPORT_COMMIT)}
              canResolve={can(DATA_CENTER_FEATURES.IMPORT_EXCEPTIONS)}
            />
          </div>
        </>
      )}
      {current?.key === "calls" && (
        <CallSheet
          canCommit={can(DATA_CENTER_FEATURES.IMPORT_COMMIT)}
          canResolve={can(DATA_CENTER_FEATURES.IMPORT_EXCEPTIONS)}
        />
      )}
      {(benchLive || current?.key === "bench") && (
        <div className={current?.key === "bench" ? undefined : "hidden"}>
          <Workbench />
        </div>
      )}
      {current?.key === "team" && <DigitisationTeam />}
      {current?.key === "confirm" && (
        <ConfirmationQueue
          canConfirm={can(DATA_CENTER_FEATURES.IMPORT_COMMIT)}
          // Only people who can work the bench are sent to it.
          onOpenBench={has("bench") ? () => setMode("bench") : null}
        />
      )}
    </div>
  );
}

export default function ImportPage() {
  return (
    <DataCentreShell
      title="Bulk Import"
      description="Paper receipts into records: a prepared sheet filled in and uploaded in bulk, or typed one at a time at the bench, then released on confirmation."
      breadcrumb="Bulk Import"
      area="import"
      /*
       * Any of the three ways in opens it. The modes then narrow to what the
       * person actually holds. `call_import.use` is granted to nobody by
       * default and is not implied by `import.upload`, so an account holding
       * exactly it, the shape for a call-centre supervisor, needs to be let in
       * here for the one mode it unlocks.
       */
      feature={[
        DATA_CENTER_FEATURES.IMPORT_UPLOAD,
        DATA_CENTER_FEATURES.DIGITISATION_WORK,
        DATA_CENTER_FEATURES.CALL_IMPORT,
      ]}
    >
      <Inner />
    </DataCentreShell>
  );
}
