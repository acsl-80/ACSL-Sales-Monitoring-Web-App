import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { dataCenterImport, DataCenterError } from "../../lib/client";
import { plural } from "../../lib/plural";
import { usePeriod } from "../../lib/usePeriod";
import { usePaged } from "../../lib/usePaged";
import PeriodFilter from "../../components/PeriodFilter";
import Pagination from "../../components/Pagination";
import { Stat, StateChip } from "../../components/Stat";
import { groupByKind, CALL_EXCEPTION_KINDS } from "../../lib/exceptionGroups";
import { downloadRework } from "../../lib/rework";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Loader2,
  ChevronDown,
  ChevronRight,
  Download,
  Undo2,
  Trash2,
  PhoneCall,
  CircleAlert,
  Wrench,
} from "lucide-react";

/**
 * Every call sheet that has been uploaded, and what each one still needs.
 *
 * WHY THIS EXISTS
 *
 * The call sheet held its batch in `useState` and nothing else. Close the tab
 * and a staged batch became unreachable: it was not in this panel because
 * there was no panel, and it was not in the receipt panel either once that
 * started filtering by source. Work that had been uploaded but not attached
 * simply disappeared from view while continuing to exist in the database.
 *
 * AND THE GAP IT CLOSES
 *
 * The reasons `validateCallRows` writes were rendered nowhere until AFTER a
 * commit. The receipt panel's whole premise is the opposite - see what is
 * wrong while it is still cheap to fix - and that premise was missing on this
 * side entirely. Exceptions are now grouped and readable the moment a sheet is
 * checked, and they can leave as a correction file.
 */

const CALL_SOURCE = "call_center";

/**
 * What to do with a call batch next, in one sentence and one button.
 *
 * Modelled on the receipt dispatcher and deliberately not shared with it: the
 * verbs differ ("Attach" rather than "Commit"), and so does the consequence a
 * person needs to read before pressing. A shared version would have to be
 * parameterised on the very sentences that make it worth having.
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
  const pending = Math.max(
    0,
    (b.total_rows ?? 0) - (b.valid_rows ?? 0) - (b.rejected_rows ?? 0) - (b.committed_rows ?? 0),
  );
  if (b.state === "rolled_back" || b.state === "committed") return null;

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
  return {
    say: "Nothing here can be attached as it stands. Open it to see why.",
    action: null,
  };
}

/** The exceptions on one batch, grouped by what is actually wrong. */
function CallExceptions({ batchId, canResolve = false, onResolved }) {
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(null);
  const [note, setNote] = useState("");
  const [drafts, setDrafts] = useState({});
  const [fixing, setFixing] = useState(null);
  const [rowNote, setRowNote] = useState(null);

  const load = useCallback(async () => {
    const [exc, rej] = await Promise.all([
      dataCenterImport.rows(batchId, "exception"),
      dataCenterImport.rows(batchId, "rejected"),
    ]);
    setRows([...exc, ...rej]);
  }, [batchId]);

  useEffect(() => {
    let live = true;
    load().catch(() => live && setRows([]));
    return () => {
      live = false;
    };
  }, [load]);

  /**
   * Correct one row's stove ID.
   *
   * Reads the value the INPUT is showing, not a separate one. The receipt
   * panel shipped this reading `drafts[id]` while the input rendered
   * `drafts[id] ?? row.stove_serial_no`, so pressing Fix without first editing
   * the box sent an empty string and hit a silent return - the field looked
   * filled and the button did nothing at all, which was the single most
   * reported thing about that screen.
   */
  const resolve = async (row) => {
    const serial = (drafts[row.id] ?? row.stove_serial_no ?? "").trim();
    if (!serial) {
      setRowNote({ id: row.id, text: "Type the correct serial number first." });
      return;
    }
    setFixing(row.id);
    setRowNote(null);
    try {
      const out = await dataCenterImport.callResolveException(row.id, serial);
      if (!out.resolved) {
        // Say so here rather than letting the row look resolved and fail at
        // attach. The reason it now carries is the new one, not the old.
        setRows((rs) =>
          rs.map((r) => (r.id === row.id ? { ...r, exception_reason: out.reason } : r)),
        );
        setRowNote({ id: row.id, text: out.reason ?? "That serial number did not resolve it." });
      } else {
        await load();
        onResolved?.();
      }
    } catch (err) {
      setRowNote({
        id: row.id,
        text: err instanceof DataCenterError ? err.message : "That did not go through.",
      });
    } finally {
      setFixing(null);
    }
  };

  const groups = useMemo(() => (rows ? groupByKind(rows, CALL_EXCEPTION_KINDS) : []), [rows]);

  if (rows === null) {
    return (
      <p className="flex items-center gap-2 p-3 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Reading what did not land...
      </p>
    );
  }
  if (rows.length === 0) {
    return <p className="p-3 text-sm text-gray-500">Nothing in this batch needs a person.</p>;
  }

  const download = async () => {
    setNote("");
    try {
      const out = await downloadRework(batchId, { stem: "call-rows-to-fix" });
      setNote(
        out.truncated
          ? `${plural(out.rows, "row")} downloaded, which is this file's ceiling. ` +
              "There are more; fix these, upload them, and download again for the rest."
          : `${plural(out.rows, "row")} downloaded as ${out.filename}.`,
      );
    } catch (err) {
      setNote(err instanceof DataCenterError ? err.message : "That file could not be built.");
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-3 py-2">
        <p className="text-sm font-semibold text-gray-900">
          {plural(rows.length, "row")} did not land
        </p>
        <button
          type="button"
          onClick={download}
          className="inline-flex items-center gap-1.5 rounded-md border border-(--dc-accent) px-2.5 py-1 text-xs font-semibold text-(--dc-accent) transition hover:bg-(--dc-accent-soft)"
        >
          <Download className="h-3.5 w-3.5" /> Download the rows to fix
        </button>
      </div>
      {note && <p className="px-3 pt-2 text-xs text-gray-600">{note}</p>}

      <div className="divide-y divide-gray-100">
        {groups.map((g) => {
          const isOpen = open === g.key;
          return (
            <div key={g.key}>
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : g.key)}
                aria-expanded={isOpen}
                className="flex w-full items-start gap-2 px-3 py-2.5 text-left transition hover:bg-gray-50"
              >
                {isOpen ? (
                  <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                ) : (
                  <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-gray-900">{g.title}</span>
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900 tabular-nums">
                      {g.rows.length}
                    </span>
                    {/*
                      The distinction that decides whether somebody edits a
                      file or fixes something elsewhere. On the receipt import
                      122 rows were once worked one at a time when fourteen
                      edits in another system would have cleared all of them.
                    */}
                    {g.selfHealing && (
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">
                        clears itself
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-xs text-gray-600">{g.what}</span>
                </span>
              </button>
              {isOpen && (
                <ul className="space-y-1 bg-gray-50 px-3 pb-3 pl-9 text-xs text-gray-700">
                  {g.rows.slice(0, 50).map((r) => (
                    <li key={r.id} className="py-1">
                      <span className="flex flex-wrap gap-x-2">
                        <span className="font-medium tabular-nums">Row {r.row_number}</span>
                        <span className="font-mono">{r.stove_serial_no ?? "(no serial number)"}</span>
                        <span className="text-gray-600">
                          {r.exception_reason ?? r.rejection_reason}
                        </span>
                      </span>
                      {g.fixable && canResolve && (
                        <span className="mt-1 flex flex-wrap items-center gap-1.5">
                          <input
                            type="text"
                            aria-label={`Corrected serial number for row ${r.row_number}`}
                            value={drafts[r.id] ?? r.stove_serial_no ?? ""}
                            onChange={(ev) => setDrafts((d) => ({ ...d, [r.id]: ev.target.value }))}
                            className="w-40 rounded border border-gray-300 px-2 py-1 font-mono text-xs"
                          />
                          <button
                            type="button"
                            disabled={fixing === r.id}
                            onClick={() => resolve(r)}
                            className="inline-flex items-center gap-1 rounded border border-(--dc-accent) px-2 py-1 text-xs font-semibold text-(--dc-accent) transition hover:bg-(--dc-accent-soft) disabled:opacity-50"
                          >
                            {fixing === r.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Wrench className="h-3 w-3" />
                            )}
                            Fix
                          </button>
                          {rowNote?.id === r.id && (
                            <span className="text-amber-800">{rowNote.text}</span>
                          )}
                        </span>
                      )}
                    </li>
                  ))}
                  {g.rows.length > 50 && (
                    <li className="pt-1 text-gray-500">
                      and {g.rows.length - 50} more, all in the download.
                    </li>
                  )}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function CallBatches({ canCommit, canResolve = false, reloadKey = 0, onChanged }) {
  const [batches, setBatches] = useState(null);
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [pending, setPending] = useState(null);
  const { period, setPeriod, resolved, earliest } = usePeriod("/data-center/import");

  const refresh = useCallback(async () => {
    try {
      const all = await dataCenterImport.batches({
        ...(resolved.dateFrom ? { dateFrom: resolved.dateFrom } : {}),
        ...(resolved.dateTo ? { dateTo: resolved.dateTo } : {}),
      });
      setBatches(all.filter((b) => b.source === CALL_SOURCE));
      setError(null);
    } catch (err) {
      setError(err instanceof DataCenterError ? err.message : "Could not load call batches.");
      setBatches([]);
    }
  }, [resolved.dateFrom, resolved.dateTo]);

  useEffect(() => {
    refresh();
  }, [refresh, reloadKey]);

  /*
   * Keep the list fresh while a chain is working.
   *
   * The second clause matters as much as the first: between links the lease
   * clears for a breath, so a page that only watched `committing` would freeze
   * on stale numbers the moment it mounted inside that gap.
   */
  useEffect(() => {
    const live = (batches ?? []).some(
      (b) => b.committing || (b.state === "validated" && b.valid_rows > 0 && b.committed_rows > 0),
    );
    if (!live) return undefined;
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [batches, refresh]);

  const paged = usePaged(batches ?? [], 10);

  const run = async (kind, batchId) => {
    setBusy(batchId);
    setError(null);
    setNotice(null);
    try {
      if (kind === "validate") {
        const out = await dataCenterImport.callValidate(batchId);
        setNotice(
          `${plural(out.valid, "row is", "rows are")} ready` +
            (out.updating ? ` (${out.updating} updating an existing record)` : "") +
            (out.exceptions ? `, ${plural(out.exceptions, "needs", "need")} a person` : "") +
            (out.rejected ? `, ${plural(out.rejected, "could not be read")}` : "") +
            ".",
        );
      } else if (kind === "commit") {
        const kick = await dataCenterImport.callCommit(batchId);
        if (kick.stopped) {
          setError("The run hit its safety cap. Press Attach again to carry on.");
        } else {
          setNotice(
            "Attaching on the server. This continues without the page, and the " +
              "numbers below update as it goes.",
          );
        }
      } else if (kind === "undo") {
        const out = await dataCenterImport.callRollback(batchId);
        setNotice(
          `${plural(out.reversed, "call record")} removed.` +
            (out.notReversed
              ? ` ${plural(out.notReversed, "row")} updated a record that already existed, ` +
                "and those cannot be undone this way."
              : ""),
        );
      } else if (kind === "discard") {
        await dataCenterImport.callDiscard(batchId);
        setNotice("That batch has been cleared away.");
      }
      await refresh();
      onChanged?.();
    } catch (err) {
      setError(err instanceof DataCenterError ? err.message : "That did not go through.");
    } finally {
      setBusy("");
    }
  };

  const confirmText = (() => {
    if (!pending) return null;
    const b = pending.batch;
    if (pending.kind === "commit") {
      return {
        title: `Attach ${b.valid_rows} call ${b.valid_rows === 1 ? "record" : "records"}?`,
        body:
          "This writes to records the call centre reads. Rows updating a record that " +
          "already exists will replace what it currently says. Undo removes only the " +
          "records this sheet created.",
      };
    }
    if (pending.kind === "undo") {
      return {
        title: `Undo ${b.committed_rows} attached ${b.committed_rows === 1 ? "record" : "records"}?`,
        body:
          "The call records this sheet created are deleted. The sales are untouched. " +
          "Rows that updated a record somebody else had already worked cannot be " +
          "undone this way and stay as they are.",
      };
    }
    return {
      title: "Clear this batch away?",
      body: `${plural(b.total_rows, "staged row")} are removed. Nothing has been attached from this batch, so nothing in the call centre changes.`,
    };
  })();

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

      {batches?.length > 0 && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-200 bg-(--dc-surface-muted) text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium">
                    State
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    File
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Rows
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Attached
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Uploaded
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    By whom
                  </th>
                  <th scope="col" className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {paged.slice.map((b) => {
                  const step = callNextStep(b);
                  const isOpen = open === b.id;
                  return (
                    <Fragment key={b.id}>
                      <tr
                        onClick={() => setOpen(isOpen ? null : b.id)}
                        className="cursor-pointer transition hover:bg-gray-50"
                      >
                        <td className="px-4 py-2">
                          <StateChip state={b.state} />
                        </td>
                        <td className="max-w-[16rem] truncate px-4 py-2 text-gray-800">
                          {b.filename ?? "(no file)"}
                        </td>
                        <td className="px-4 py-2 tabular-nums text-gray-700">{b.total_rows}</td>
                        <td className="px-4 py-2 tabular-nums text-gray-700">{b.committed_rows}</td>
                        <td className="px-4 py-2 text-gray-600">
                          {new Date(b.uploaded_at).toLocaleDateString()}
                        </td>
                        <td className="max-w-[12rem] truncate px-4 py-2 text-gray-600">
                          {b.uploaded_by_name ?? "-"}
                        </td>
                        <td className="px-4 py-2 text-right">
                          {isOpen ? (
                            <ChevronDown className="ml-auto h-4 w-4 text-gray-400" />
                          ) : (
                            <ChevronRight className="ml-auto h-4 w-4 text-gray-400" />
                          )}
                        </td>
                      </tr>

                      {step && (
                        <tr className="bg-(--dc-accent-soft)/20">
                          <td colSpan={7} className="px-4 py-2">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="text-sm text-gray-800">{step.say}</span>
                              {step.action && (
                                <button
                                  type="button"
                                  disabled={
                                    busy === b.id || (step.action.kind === "commit" && !canCommit)
                                  }
                                  onClick={() =>
                                    step.action.kind === "commit"
                                      ? setPending({ kind: "commit", batch: b })
                                      : run(step.action.kind, b.id)
                                  }
                                  className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-(--dc-accent) px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-(--dc-accent-strong) disabled:opacity-50"
                                >
                                  {busy === b.id && <Loader2 className="h-4 w-4 animate-spin" />}
                                  {step.action.label}
                                </button>
                              )}
                              {step.action?.kind === "commit" && !canCommit && (
                                <span className="text-xs text-gray-500">
                                  Somebody with the commit grant attaches these.
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}

                      {isOpen && (
                        <tr>
                          <td colSpan={7} className="bg-white px-4 py-3">
                            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                              <Stat label="Rows" value={b.total_rows} />
                              <Stat label="Ready" value={b.valid_rows} tone="text-emerald-700" />
                              <Stat
                                label="Need a person"
                                value={b.exception_rows ?? 0}
                                tone="text-amber-700"
                              />
                              <Stat
                                label="Unreadable"
                                value={Math.max(
                                  0,
                                  (b.rejected_rows ?? 0) - (b.exception_rows ?? 0),
                                )}
                                tone="text-red-700"
                              />
                              <Stat
                                label="Attached"
                                value={b.committed_rows}
                                tone="text-(--dc-accent)"
                              />
                            </dl>

                            {b.last_error && (
                              <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                                {b.last_error}
                              </p>
                            )}

                            <div className="mt-3 overflow-hidden rounded-lg border border-gray-200">
                              <CallExceptions
                                batchId={b.id}
                                canResolve={canResolve}
                                onResolved={refresh}
                              />
                            </div>

                            {canCommit && (
                              <div className="mt-3 flex flex-wrap gap-2">
                                {b.committed_rows > 0 && b.state !== "rolled_back" && (
                                  <button
                                    type="button"
                                    disabled={busy === b.id || b.committing}
                                    onClick={() => setPending({ kind: "undo", batch: b })}
                                    className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-semibold text-gray-800 transition hover:bg-gray-50 disabled:opacity-50"
                                  >
                                    <Undo2 className="h-4 w-4" /> Undo this import
                                  </button>
                                )}
                                {b.committed_rows === 0 && b.state !== "committed" && (
                                  <button
                                    type="button"
                                    disabled={busy === b.id || b.committing}
                                    onClick={() => setPending({ kind: "discard", batch: b })}
                                    className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
                                  >
                                    <Trash2 className="h-4 w-4" /> Clear it away
                                  </button>
                                )}
                              </div>
                            )}
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

      <AlertDialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent data-area="import">
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmText?.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirmText?.body}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const p = pending;
                setPending(null);
                if (p) run(p.kind, p.batch.id);
              }}
            >
              {pending?.kind === "commit"
                ? "Attach them"
                : pending?.kind === "undo"
                  ? "Undo"
                  : "Clear it"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
