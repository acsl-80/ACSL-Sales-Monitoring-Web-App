import { Fragment, useMemo, useState } from "react";
import { plural } from "../../lib/plural";
import { dateOf } from "../../lib/when";
import { usePaged } from "../../lib/usePaged";
import { useIsPhone } from "../../lib/useMediaQuery";
import PeriodFilter from "../../components/PeriodFilter";
import Pagination from "../../components/Pagination";
import ExportButton from "../../components/ExportButton";
import StateStrip from "./parts/StateStrip";
import CallExceptionsTable from "./CallExceptionsTable";
import {
  Loader2,
  ChevronDown,
  ChevronRight,
  PhoneCall,
  CircleAlert,
  Undo2,
  Trash2,
} from "lucide-react";

/**
 * Every call sheet, rendered. CallBatches keeps the state, the polling and the
 * client calls; this file only turns a batch array into the card, the chips,
 * the table (or a stack of cards below `sm`) and the exceptions underneath.
 *
 * Import redesign, 2026-09-07.
 */

const EXPORT_COLUMNS = [
  { key: "filename", label: "Sheet", get: (b) => b.filename ?? "(no file)" },
  { key: "state", label: "State", get: (b) => String(b.state ?? "").replace(/_/g, " ") },
  { key: "total_rows", label: "Rows" },
  { key: "committed_rows", label: "Attached" },
  { key: "exception_rows", label: "Need a look", get: (b) => b.exception_rows ?? 0 },
  { key: "uploaded_at", label: "Uploaded", get: (b) => dateOf(b.uploaded_at) },
  { key: "uploaded_by_name", label: "By", get: (b) => b.uploaded_by_name ?? "-" },
];

const CHIPS = [
  { key: "all", label: "All", test: () => true },
  { key: "look", label: "Needs a look", test: (b) => (b.exception_rows ?? 0) > 0 },
  { key: "attached", label: "Attached", test: (b) => (b.committed_rows ?? 0) > 0 },
  { key: "undone", label: "Undone", test: (b) => b.state === "rolled_back" },
];

/**
 * What to do with a call batch next, in one sentence and one button.
 *
 * Modelled on the receipt dispatcher and deliberately not shared with it: the
 * verbs differ ("Attach" rather than "Commit"), and so does the consequence a
 * person needs to read before pressing. Once nothing is left to check, this
 * still offers something: Fix for a sheet that came back with nothing valid,
 * Open for one that has already landed, so the row is never a dead end.
 */
export function callNextStep(b) {
  if (b.committing) {
    return {
      say:
        `Being attached on the server right now: ${b.committed_rows} in, ` +
        `${b.valid_rows} to go. This continues on its own, so leaving the page is fine.`,
      action: null,
    };
  }
  if (b.state === "rolled_back") return null;

  const pending = Math.max(
    0,
    (b.total_rows ?? 0) - (b.valid_rows ?? 0) - (b.rejected_rows ?? 0) - (b.committed_rows ?? 0),
  );

  if (pending > 0 && (b.valid_rows ?? 0) === 0) {
    return {
      say: `${plural(b.total_rows, "row is", "rows are")} here and none has been checked yet.`,
      action: { kind: "validate", label: "Check the rows" },
    };
  }
  if ((b.valid_rows ?? 0) > 0) {
    return {
      say:
        `${plural(b.valid_rows, "row is", "rows are")} ready to attach` +
        (b.exception_rows ? `, ${plural(b.exception_rows, "needs", "need")} a person first` : "") +
        ". Nothing is written until you attach them.",
      action: { kind: "commit", label: `Attach ${b.valid_rows}` },
    };
  }
  if ((b.exception_rows ?? 0) > 0) {
    return {
      say: "Nothing here can be attached as it stands. Fixing what needs a look clears the way.",
      action: { kind: "fix", label: `Needs a look · ${b.exception_rows}` },
    };
  }
  if ((b.committed_rows ?? 0) > 0) {
    return { say: null, action: { kind: "open", label: "Open" } };
  }
  return {
    say: "Nothing here can be attached as it stands. Open it to see why.",
    action: null,
  };
}

/** The action button a batch's row offers next, coloured by what it does. */
function ActionButton({ step, busy, canCommit, onCommit, onValidate, onOpen }) {
  if (!step?.action) return null;
  const { kind, label } = step.action;
  if (kind === "validate") {
    return (
      <button
        type="button"
        disabled={busy}
        onClick={(e) => {
          e.stopPropagation();
          onValidate();
        }}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-(image:--dc-fig-verified) px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:brightness-110 disabled:opacity-50"
      >
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {label}
      </button>
    );
  }
  if (kind === "commit") {
    return (
      <button
        type="button"
        disabled={busy || !canCommit}
        onClick={(e) => {
          e.stopPropagation();
          onCommit();
        }}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-(image:--dc-fig-sold) px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:brightness-110 disabled:opacity-50"
      >
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {label}
      </button>
    );
  }
  if (kind === "fix") {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onOpen();
        }}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-(--dc-brief-place) px-3 py-1.5 text-xs font-semibold text-(--dc-brief-place) transition hover:bg-(--dc-brief-place-soft)"
      >
        {label}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-(--dc-brief-stove) px-3 py-1.5 text-xs font-semibold text-(--dc-brief-stove) transition hover:bg-(--dc-brief-stove-soft)"
    >
      {label}
    </button>
  );
}

/** Undo / Clear, plus the exceptions table. Shared by the desktop row and the phone card. */
function DetailPanel({ batch: b, canCommit, canResolve, busy, onUndo, onDiscard, onResolved }) {
  return (
    <div className="bg-white px-3 py-3">
      {b.last_error && (
        <p className="mb-3 rounded-lg border border-(--dc-brief-place) bg-(--dc-brief-place-soft) px-3 py-2 text-xs text-(--dc-brief-place)">
          {b.last_error}
        </p>
      )}
      <div className="overflow-hidden rounded-lg border border-gray-200">
        <CallExceptionsTable batchId={b.id} canResolve={canResolve} onResolved={onResolved} />
      </div>
      {canCommit && (
        <div className="mt-3 flex flex-wrap gap-2">
          {b.committed_rows > 0 && b.state !== "rolled_back" && (
            <button
              type="button"
              disabled={busy || b.committing}
              onClick={() => onUndo(b)}
              className="inline-flex items-center gap-1.5 rounded-md border border-(--dc-accent) px-3 py-1.5 text-sm font-semibold text-(--dc-accent) transition hover:bg-(--dc-accent-soft) disabled:opacity-50"
            >
              <Undo2 className="h-4 w-4" /> Undo this import
            </button>
          )}
          {b.committed_rows === 0 && b.state !== "committed" && (
            <button
              type="button"
              disabled={busy || b.committing}
              onClick={() => onDiscard(b)}
              className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" /> Clear it away
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function CallSheetsTable({
  batches,
  busy,
  error,
  notice,
  canCommit,
  canResolve,
  period,
  setPeriod,
  earliest,
  onValidate,
  onCommitRequest,
  onUndoRequest,
  onDiscardRequest,
  onResolved,
}) {
  const [open, setOpen] = useState(null);
  const [chip, setChip] = useState("all");
  const isPhone = useIsPhone();

  const counts = useMemo(() => {
    const list = batches ?? [];
    return Object.fromEntries(CHIPS.map((c) => [c.key, list.filter(c.test).length]));
  }, [batches]);

  const filtered = useMemo(() => {
    const list = batches ?? [];
    const c = CHIPS.find((x) => x.key === chip) ?? CHIPS[0];
    return list.filter(c.test);
  }, [batches, chip]);

  const paged = usePaged(filtered, 10);

  return (
    <section className="mt-4 rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <PhoneCall className="h-4 w-4 text-(--dc-accent)" />
          <h3 className="text-sm font-bold text-gray-900">Sheets uploaded</h3>
        </div>
        <PeriodFilter
          period={period}
          onChange={setPeriod}
          earliest={earliest}
          noun="sheets"
          area="import"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-4 py-2.5">
        {CHIPS.filter((c) => c.key === "all" || counts[c.key] > 0).map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setChip(c.key)}
            aria-pressed={chip === c.key}
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold transition ${
              chip === c.key
                ? "border-(--dc-accent) bg-(--dc-accent) text-white"
                : "border-gray-200 text-gray-600 hover:border-(--dc-accent)/40 hover:bg-(--dc-accent-soft)/30"
            }`}
          >
            {c.label} {counts[c.key]}
          </button>
        ))}
        <div className="ml-auto">
          <ExportButton
            columns={EXPORT_COLUMNS}
            rows={() => batches ?? []}
            filename={`call-sheets-${new Date().toISOString().slice(0, 10)}.csv`}
            label="Export sheets"
            disabled={!batches?.length}
          />
        </div>
      </div>

      {error && (
        <p className="flex items-start gap-2 border-b border-red-100 bg-red-50 px-4 py-2 text-sm text-red-800">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </p>
      )}
      {notice && (
        <p className="border-b border-gray-100 bg-(--dc-surface-muted) px-4 py-2 text-sm text-gray-700">
          {notice}
        </p>
      )}

      {batches === null && (
        <p className="flex items-center gap-2 p-4 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading...
        </p>
      )}
      {batches?.length === 0 && (
        <p className="p-4 text-sm text-gray-600">
          No call sheets have been uploaded in this period. Uploading one above puts it here, so it
          can be picked up again later.
        </p>
      )}
      {batches?.length > 0 && filtered.length === 0 && (
        <p className="p-4 text-sm text-gray-600">Nothing matches that chip.</p>
      )}

      {filtered.length > 0 && !isPhone && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-(--dc-accent-soft) text-left text-xs uppercase tracking-wide text-(--dc-accent-strong)">
                <tr className="border-b-2 border-(--dc-accent)">
                  <th scope="col" className="sticky left-0 z-10 bg-(--dc-accent-soft) px-4 py-2 font-medium">
                    Sheet
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">Read · checked · attached</th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">Rows</th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">Attached</th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">Need a look</th>
                  <th scope="col" className="px-4 py-2 font-medium">Uploaded</th>
                  <th scope="col" className="px-4 py-2 font-medium">By</th>
                  <th scope="col" className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {paged.slice.map((b) => {
                  const step = callNextStep(b);
                  const isOpen = open === b.id;
                  const rowBusy = busy === b.id;
                  return (
                    <Fragment key={b.id}>
                      <tr
                        onClick={() => setOpen(isOpen ? null : b.id)}
                        className="group cursor-pointer transition hover:bg-(--dc-accent-soft)/40"
                      >
                        <td className="sticky left-0 z-10 bg-white px-4 py-2 text-gray-900 group-hover:bg-(--dc-accent-soft)/40">
                          <span className="flex items-center gap-1.5">
                            {isOpen ? (
                              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                            )}
                            {b.filename ?? "(no file)"}
                          </span>
                        </td>
                        <td className="px-4 py-2">
                          <StateStrip batch={b} landedWord="attached" />
                          {step?.say && (
                            <span className="mt-1 block max-w-sm text-xs text-gray-600">
                              {step.say}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-gray-700">
                          {b.total_rows}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-gray-700">
                          {b.committed_rows}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-(--dc-brief-place)">
                          {b.exception_rows ?? 0}
                        </td>
                        <td className="px-4 py-2 text-gray-600">{dateOf(b.uploaded_at)}</td>
                        <td className="max-w-[10rem] truncate px-4 py-2 text-gray-600">
                          {b.uploaded_by_name ?? "-"}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <ActionButton
                            step={step}
                            busy={rowBusy}
                            canCommit={canCommit}
                            onCommit={() => onCommitRequest(b)}
                            onValidate={() => onValidate(b.id)}
                            onOpen={() => setOpen(b.id)}
                          />
                          {step?.action?.kind === "commit" && !canCommit && (
                            <span className="mt-1 block text-xs text-gray-500">
                              Needs the commit grant
                            </span>
                          )}
                        </td>
                      </tr>

                      {isOpen && (
                        <tr>
                          <td colSpan={8} className="p-0">
                            <DetailPanel
                              batch={b}
                              canCommit={canCommit}
                              canResolve={canResolve}
                              busy={rowBusy}
                              onUndo={onUndoRequest}
                              onDiscard={onDiscardRequest}
                              onResolved={onResolved}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          <Pagination
            page={paged.page}
            pageSize={paged.pageSize}
            total={paged.total}
            onPage={paged.setPage}
            onPageSize={paged.setPageSize}
            noun="sheet"
          />
        </>
      )}

      {filtered.length > 0 && isPhone && (
        <>
          <ul className="divide-y divide-gray-100">
            {paged.slice.map((b) => {
              const step = callNextStep(b);
              const isOpen = open === b.id;
              const rowBusy = busy === b.id;
              return (
                <li key={b.id} className="p-3">
                  <button
                    type="button"
                    onClick={() => setOpen(isOpen ? null : b.id)}
                    className="flex w-full flex-col items-start gap-1.5 text-left"
                  >
                    <span className="flex w-full items-center gap-1.5 font-medium text-gray-900">
                      {isOpen ? (
                        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                      )}
                      <span className="min-w-0 truncate">{b.filename ?? "(no file)"}</span>
                    </span>
                    <StateStrip batch={b} landedWord="attached" />
                    <span className="text-xs text-gray-600">
                      {plural(b.total_rows, "row")}, {plural(b.committed_rows, "call")} attached,{" "}
                      {plural(b.exception_rows ?? 0, "row")} need a look. Uploaded{" "}
                      {dateOf(b.uploaded_at)} by {b.uploaded_by_name ?? "someone unnamed"}.
                    </span>
                    {step?.say && <span className="text-xs text-gray-600">{step.say}</span>}
                  </button>
                  {step?.action && (
                    <div className="mt-2 [&>button]:w-full [&>button]:justify-center">
                      <ActionButton
                        step={step}
                        busy={rowBusy}
                        canCommit={canCommit}
                        onCommit={() => onCommitRequest(b)}
                        onValidate={() => onValidate(b.id)}
                        onOpen={() => setOpen(b.id)}
                      />
                    </div>
                  )}
                  {isOpen && (
                    <div className="mt-3 overflow-hidden rounded-lg border border-gray-200">
                      <DetailPanel
                        batch={b}
                        canCommit={canCommit}
                        canResolve={canResolve}
                        busy={rowBusy}
                        onUndo={onUndoRequest}
                        onDiscard={onDiscardRequest}
                        onResolved={onResolved}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <Pagination
            page={paged.page}
            pageSize={paged.pageSize}
            total={paged.total}
            onPage={paged.setPage}
            onPageSize={paged.setPageSize}
            noun="sheet"
          />
        </>
      )}
    </section>
  );
}
