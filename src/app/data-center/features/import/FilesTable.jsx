import { Fragment, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Play, Wrench } from "lucide-react";
import PeriodFilter from "../../components/PeriodFilter";
import ExportButton from "../../components/ExportButton";
import Pagination from "../../components/Pagination";
import { usePaged } from "../../lib/usePaged";
import { plural } from "../../lib/plural";
import { dateOf, whenOf } from "../../lib/when";
import { useIsPhone } from "../../lib/useMediaQuery";
import StateStrip from "./parts/StateStrip";
import FileDetail from "./FileDetail";

/**
 * Every file this period, one row each.
 *
 * WHY THIS SHAPE
 *
 * A real 983-row import staged successfully and then sat there. The panel
 * showed "staged", "Rows 983", "Ready 0", "Exceptions 0", and no next step
 * anywhere: the actions were behind a chevron nobody had reason to click, and
 * the one action that batch actually needed - checking the rows - did not exist
 * as a button at all, because checking only ever happened automatically during
 * upload.
 *
 * So the state a batch is in decides the sentence and the button, and both sit
 * in the batch's own row rather than in a second row beneath it (2026-09-07).
 * The three-cell strip carries the state at a glance; the counts are columns,
 * so a manager can read down Need a look; the one action ends the row in its
 * own colour.
 */

const NUMBER = new Intl.NumberFormat("en-NG");

const STATE_TONE = {
  staged: "bg-gray-100 text-gray-700",
  validated: "bg-blue-100 text-blue-800",
  dry_run: "bg-amber-100 text-amber-800",
  committed: "bg-(--dc-primary)/10 text-(--dc-accent)",
  rolled_back: "bg-purple-100 text-purple-800",
  failed: "bg-red-100 text-red-700",
};

const unreadableRows = (b) => Math.max(0, (b.rejected_rows ?? 0) - (b.exception_rows ?? 0));

const partnerOf = (b) =>
  /*
   * A batch covering several partners is not a batch with a missing partner.
   * "-" said the second thing about the first, which is how somebody concludes
   * the import lost the data.
   */
  b.partner_name ?? (b.partner_count > 1 ? `${b.partner_count} partners` : "-");

/**
 * The states worth narrowing to, in the order somebody works them.
 *
 * Client-side, over the period's own list: the rows are already here, and a
 * round trip to hide four of six files is a round trip for nothing. A chip
 * shows only when it has rows behind it, so the row of chips is a map of what
 * this period actually holds rather than a fixed menu of mostly zeros.
 */
const FILTERS = [
  { key: "all", label: "All", test: () => true },
  { key: "look", label: "Needs a look", test: (b) => (b.exception_rows ?? 0) > 0 },
  {
    key: "ready",
    label: "Ready to commit",
    test: (b) => (b.valid_rows ?? 0) > 0 && !b.committing && b.state !== "committed",
  },
  { key: "landing", label: "Landing", test: (b) => !!b.committing },
  { key: "landed", label: "Landed", test: (b) => (b.committed_rows ?? 0) > 0 },
  { key: "undone", label: "Rolled back", test: (b) => b.state === "rolled_back" },
];

const EXPORT_COLUMNS = [
  { key: "filename", label: "File", get: (b) => b.filename ?? "(typed in, no file)" },
  { key: "partner", label: "Partner", get: partnerOf },
  { key: "state", label: "State", get: (b) => b.state.replace(/_/g, " ") },
  { key: "total_rows", label: "Rows" },
  { key: "valid_rows", label: "Ready" },
  { key: "exception_rows", label: "Need a look" },
  { key: "unreadable", label: "Unreadable", get: unreadableRows },
  { key: "committed_rows", label: "Landed" },
  { key: "uploaded_at", label: "Uploaded", get: (b) => whenOf(b.uploaded_at) },
  { key: "uploaded_by_name", label: "By", get: (b) => b.uploaded_by_name ?? "" },
];

/**
 * What to do with a batch next, in one sentence and one button.
 *
 * Meanwhile the top of the page explained three steps the reader had already
 * done. Explaining a process nobody is at the start of is not help.
 */
export function nextStep(b) {
  /*
   * A batch the server is writing RIGHT NOW says so, before anything else.
   * Without this, a refreshed page rendered an armed "Commit N" button over a
   * batch a chain was mid-way through - and pressing it answered busy, which
   * read as an error rather than as the truth.
   */
  if (b.committing) {
    return {
      say:
        `Being written on the server right now: ${b.committed_rows} in, ` +
        `${b.valid_rows} to go. This continues on its own - leaving the page is fine.`,
      action: null,
    };
  }
  const pending = Math.max(
    0,
    (b.total_rows ?? 0) - (b.valid_rows ?? 0) - (b.rejected_rows ?? 0) - (b.committed_rows ?? 0),
  );
  /*
   * A finished batch says nothing.
   *
   * The state chip already reads "committed" or "rolled back" and the Landed
   * column already carries the number, so a sentence repeating them earns
   * nothing. This line exists for work that needs a person; when there is
   * none, there is no line.
   */
  if (b.state === "rolled_back" || b.state === "committed") return null;
  /*
   * `pending` counts drafts AND exceptions: both are rows that are neither
   * valid, rejected nor committed. They are different sentences. A draft is
   * being typed; an exception was refused and needs a person. Telling a
   * typist that twenty-five refused receipts were "still being typed" was the
   * second half of the 2026-09-02 report, after the batch reading as
   * committed.
   */
  const exceptions = b.exception_rows ?? 0;
  const drafts = Math.max(0, pending - exceptions);
  /*
   * A bench batch whose rows are all still drafts is being typed, not waiting
   * to be checked. `validate` selects staged, valid, rejected and exception
   * rows and never a draft, so the "Check the rows" this used to offer did
   * nothing except flip the batch to `validated` with zero valid rows, which
   * then read as a stuck batch.
   */
  if (
    b.source === "workbench" && pending > 0 && (b.valid_rows ?? 0) === 0 &&
    (b.rejected_rows ?? 0) === 0
  ) {
    const parts = [];
    if (drafts > 0) {
      parts.push(`${plural(drafts, "receipt is", "receipts are")} still being typed at the bench`);
    }
    if (exceptions > 0) {
      parts.push(
        `${plural(exceptions, "was", "were")} refused and ${exceptions === 1 ? "needs" : "need"} ` +
          "a person: open each at the bench, where the reason is shown, fix it and save it " +
          "as finished again",
      );
    }
    return { say: `${parts.join("; ")}.`, action: null };
  }
  if (drafts > 0 && (b.valid_rows ?? 0) === 0 && (b.rejected_rows ?? 0) === 0) {
    return {
      say: `${plural(b.total_rows, "row is", "rows are")} here and none has been checked yet.`,
      action: { kind: "validate", label: "Check the rows", primary: true },
    };
  }
  if ((b.valid_rows ?? 0) > 0) {
    return {
      say:
        `${plural(b.valid_rows, "row is", "rows are")} ready to go in` +
        // "1 needs a person first", "232 need a person first".
        (b.exception_rows
          ? `, ${plural(b.exception_rows, "needs", "need")} a person first`
          : "") +
        `. Nothing is written until you commit.`,
      action: { kind: "commit", label: `Commit ${b.valid_rows}`, primary: true },
    };
  }
  if (drafts > 0) {
    return {
      say: `${plural(drafts, "row", "rows")} still to check.`,
      action: { kind: "validate", label: "Check the rest", primary: true },
    };
  }
  return {
    say: exceptions > 0
      ? `${plural(exceptions, "row needs", "rows need")} a person first. Open it to see why.`
      : "Nothing here can be written as it stands. Open it to see why.",
    action: null,
  };
}

/**
 * The one next action, in the colour of what it does.
 *
 * Six kinds of action, six colours, one solid per row: committing is olive,
 * checking is teal, a fix is amber and opening a settled batch is blue.
 */
function RowAction({
  batch: b, step, busy, canUpload, canCommit, onValidate, onAsk, onOpen, full,
}) {
  const width = full ? "w-full justify-center" : "";
  if (b.committing) {
    return (
      <span className={`inline-flex items-center gap-1.5 rounded-full bg-(--dc-brief-who-soft) px-2.5 py-1 text-xs font-medium text-(--dc-brief-who) ${width}`}>
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {b.committed_rows} of {b.committed_rows + b.valid_rows} · you can leave this page
      </span>
    );
  }
  if (step?.action) {
    const may = step.action.kind === "commit" ? canCommit : canUpload;
    if (!may) {
      return (
        <span className="text-xs text-gray-600">
          Somebody with permission to{" "}
          {step.action.kind === "commit" ? "commit" : "run the check"} has to do this.
        </span>
      );
    }
    return (
      <button
        type="button"
        disabled={busy}
        onClick={(e) => {
          e.stopPropagation();
          if (step.action.kind === "validate") onValidate(b.id);
          else onAsk("commit", b);
        }}
        className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50 ${width} ${
          step.action.kind === "commit"
            ? "bg-(image:--dc-fig-sold)"
            : "bg-(image:--dc-fig-verified)"
        }`}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
        {step.action.label}
      </button>
    );
  }
  // Nothing valid, but rows a person can still put right. Amber, and it opens
  // the file on the exceptions rather than doing anything on its own.
  if (
    (b.exception_rows ?? 0) > 0 && b.state !== "committed" && b.state !== "rolled_back"
  ) {
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onOpen(b.id); }}
        className={`inline-flex items-center gap-1.5 rounded-md border border-(--dc-brief-place) px-3 py-1.5 text-sm font-medium text-(--dc-brief-place) transition hover:bg-(--dc-brief-place-soft) ${width}`}
      >
        <Wrench className="h-4 w-4" /> Fix {b.exception_rows}
      </button>
    );
  }
  if (b.state === "committed" || b.state === "rolled_back") {
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onOpen(b.id); }}
        className={`inline-flex items-center gap-1.5 rounded-md border border-(--dc-brief-stove) px-3 py-1.5 text-sm font-medium text-(--dc-brief-stove) transition hover:bg-(--dc-brief-stove-soft) ${width}`}
      >
        Open
      </button>
    );
  }
  return null;
}

export default function FilesTable({
  batches,
  loading,
  busy,
  canUpload,
  canCommit,
  open,
  onToggle,
  onValidate,
  onAsk,
  period,
  onPeriod,
  earliest,
  detail,
}) {
  const [filter, setFilter] = useState("all");
  const isPhone = useIsPhone();

  const counts = useMemo(() => {
    const out = {};
    for (const f of FILTERS) out[f.key] = batches.filter(f.test).length;
    return out;
  }, [batches]);

  const shown = useMemo(() => {
    const chosen = FILTERS.find((f) => f.key === filter) ?? FILTERS[0];
    return batches.filter(chosen.test);
  }, [batches, filter]);

  // The history grows for as long as the module runs. A year of daily imports
  // is a list nobody scrolls to the bottom of, and the row somebody wants is
  // usually recent but not always.
  const paged = usePaged(shown, 10);

  const rowsRead = batches.reduce((n, b) => n + (b.total_rows ?? 0), 0);
  const landed = batches.reduce((n, b) => n + (b.committed_rows ?? 0), 0);

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 border-t-[3px] border-t-(--dc-accent) bg-white shadow-sm">
      <div className="border-b border-gray-100 bg-(--dc-accent-soft)/30 px-4 py-3">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-base font-semibold text-gray-900">Files this period</span>
          <span className="text-sm text-gray-500">
            {plural(batches.length, "file")} · {plural(rowsRead, "row")} read ·{" "}
            {NUMBER.format(landed)} landed
          </span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {FILTERS.filter((f) => f.key === "all" || counts[f.key] > 0).map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={filter === f.key}
              onClick={() => setFilter(f.key)}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                filter === f.key
                  ? "border-(--dc-accent) bg-(--dc-accent) text-white"
                  : "border-(--dc-accent)/30 text-(--dc-accent) hover:bg-(--dc-accent-soft)/60"
              }`}
            >
              {f.label} {counts[f.key]}
            </button>
          ))}
          <span className="ml-auto flex flex-wrap items-center gap-2">
            <PeriodFilter
              period={period}
              onChange={onPeriod}
              earliest={earliest}
              area="import"
              noun="imports"
            />
            <ExportButton
              columns={EXPORT_COLUMNS}
              rows={() => shown}
              filename="import-files"
              label="Export files"
              disabled={shown.length === 0}
            />
          </span>
        </div>
      </div>

      {loading ? (
        <p className="flex items-center gap-2 p-6 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading batches...
        </p>
      ) : batches.length === 0 ? (
        <p className="m-4 rounded-lg border border-dashed border-(--dc-accent)/30 p-6 text-center text-sm text-gray-500">
          {/*
            "No imports at all" and "none in this period" are different facts,
            and answering the second with the first sends somebody looking for
            a file they did upload.
          */}
          No imports in this period. Widen it above, or choose a file or type
          one record to begin.
        </p>
      ) : shown.length === 0 ? (
        <p className="m-4 rounded-lg border border-dashed border-(--dc-accent)/30 p-6 text-center text-sm text-gray-500">
          No file in this period is in that state. Press All to see them again.
        </p>
      ) : isPhone ? (
        <ul className="divide-y divide-gray-100">
          {paged.slice.map((b) => {
            const step = nextStep(b);
            return (
              <li key={b.id} className="px-4 py-3">
                <button
                  type="button"
                  onClick={() => onToggle(b.id)}
                  className="flex w-full items-start gap-2 text-left"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-gray-900">
                      {b.filename ?? "(typed in, no file)"}
                    </span>
                    <span className="block text-xs text-gray-600">
                      {partnerOf(b)} · {b.uploaded_by_name ?? "-"} · {dateOf(b.uploaded_at)}
                    </span>
                  </span>
                  {open === b.id
                    ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                    : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />}
                </button>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <StateStrip batch={b} />
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATE_TONE[b.state]}`}>
                    {b.state.replace(/_/g, " ")}
                  </span>
                </div>
                <p className="mt-1 text-xs text-gray-700">
                  {plural(b.total_rows, "row")} read, {b.valid_rows} ready,{" "}
                  {b.exception_rows} need a look, {unreadableRows(b)} unreadable,{" "}
                  {b.committed_rows} landed.
                </p>
                {step?.say && <p className="mt-1 text-xs text-gray-700">{step.say}</p>}
                <div className="mt-2">
                  <RowAction
                    batch={b}
                    step={step}
                    busy={busy}
                    canUpload={canUpload}
                    canCommit={canCommit}
                    onValidate={onValidate}
                    onAsk={onAsk}
                    onOpen={onToggle}
                    full
                  />
                </div>
                {open === b.id && (
                  <div className="mt-3">
                    <FileDetail
                      batch={b}
                      busy={busy}
                      canUpload={canUpload}
                      canCommit={canCommit}
                      onAsk={onAsk}
                      {...detail}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-(--dc-accent) bg-(--dc-accent-soft) text-left text-[11px] font-semibold uppercase tracking-wide text-(--dc-accent-strong)">
                <th scope="col" className="sticky left-0 bg-(--dc-accent-soft) px-3 py-2">File</th>
                <th scope="col" className="px-3 py-2">Partner, uploaded</th>
                <th scope="col" className="px-3 py-2">Read · checked · landed</th>
                <th scope="col" className="px-3 py-2 text-right">Rows</th>
                <th scope="col" className="px-3 py-2 text-right">Ready</th>
                <th scope="col" className="px-3 py-2 text-right">Need a look</th>
                <th scope="col" className="px-3 py-2 text-right">Unreadable</th>
                <th scope="col" className="px-3 py-2 text-right">Landed</th>
              </tr>
            </thead>
            <tbody>
              {paged.slice.map((b) => {
                const step = nextStep(b);
                return (
                  <Fragment key={b.id}>
                    <tr
                      onClick={() => onToggle(b.id)}
                      className="group cursor-pointer border-b border-gray-100 transition hover:bg-(--dc-accent-soft)/40"
                    >
                      {/*
                        The name, alone in its cell. A second line here would
                        change what the cell is called, and the file name is
                        how every other surface and every spec finds this row.
                      */}
                      <td className="sticky left-0 z-10 max-w-[14rem] truncate bg-white px-3 py-2 font-medium text-gray-900 group-hover:bg-(--dc-accent-soft)/40">
                        {b.filename ?? "(typed in, no file)"}
                        {open === b.id
                          ? <ChevronDown className="ml-1 inline h-3.5 w-3.5 text-gray-400" aria-hidden />
                          : <ChevronRight className="ml-1 inline h-3.5 w-3.5 text-gray-400" aria-hidden />}
                      </td>
                      <td className="max-w-[13rem] px-3 py-2 text-gray-700">
                        <span className="block truncate">{partnerOf(b)}</span>
                        <span className="block truncate text-xs text-gray-500" title={whenOf(b.uploaded_at)}>
                          {dateOf(b.uploaded_at)} · {b.uploaded_by_name ?? "-"}
                        </span>
                      </td>
                      <td className="min-w-[17rem] px-3 py-2">
                        <span className="flex flex-wrap items-center gap-2">
                          <StateStrip batch={b} />
                          <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${STATE_TONE[b.state]}`}>
                            {b.state.replace(/_/g, " ")}
                          </span>
                        </span>
                        {step?.say && (
                          <span className="mt-1 block max-w-[22rem] text-xs text-gray-700">
                            {step.say}
                          </span>
                        )}
                        {/* The one action sits with the words that call for it,
                            so it is on screen at a desk's width. */}
                        <span className="mt-1.5 flex items-center gap-2">
                          <RowAction
                            batch={b}
                            step={step}
                            busy={busy}
                            canUpload={canUpload}
                            canCommit={canCommit}
                            onValidate={onValidate}
                            onAsk={onAsk}
                            onOpen={onToggle}
                          />
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-700">
                        {b.total_rows}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-700">
                        {b.valid_rows}
                      </td>
                      <td
                        className={`px-3 py-2 text-right tabular-nums ${
                          b.exception_rows > 0
                            ? "font-semibold text-(--dc-brief-place)"
                            : "text-gray-700"
                        }`}
                      >
                        {b.exception_rows}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-700">
                        {unreadableRows(b)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-(--dc-accent)">
                        {b.committed_rows}
                      </td>
                    </tr>

                    {open === b.id && (
                      <tr className="border-b border-gray-100 bg-(--dc-surface-muted)">
                        <td colSpan={8} className="px-4 py-3">
                          <FileDetail
                            batch={b}
                            busy={busy}
                            canUpload={canUpload}
                            canCommit={canCommit}
                            onAsk={onAsk}
                            {...detail}
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
      )}

      {!loading && shown.length > 0 && (
        <Pagination
          page={paged.page}
          pageSize={paged.pageSize}
          total={paged.total}
          onPage={paged.setPage}
          onPageSize={paged.setPageSize}
          noun="import"
        />
      )}
    </div>
  );
}
