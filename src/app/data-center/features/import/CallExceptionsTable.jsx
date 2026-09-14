import { useCallback, useEffect, useMemo, useState } from "react";
import { dataCenterImport, DataCenterError } from "../../lib/client";
import { plural } from "../../lib/plural";
import { groupByKind, CALL_EXCEPTION_KINDS } from "../../lib/exceptionGroups";
import { downloadRework } from "../../lib/rework";
import { Loader2, ChevronDown, ChevronRight, Download, Wrench } from "lucide-react";

/**
 * The exceptions on one call-sheet batch, grouped by what is actually wrong,
 * each group a table: Row, Serial, Buyer, Phone, Why, Fix.
 *
 * Split out of CallBatches (import redesign, 2026-09-07). The grouping stays -
 * a flat 331-row list is not a worklist, and the group's title and its
 * "clears itself" tag are what turn that many rows into a handful of
 * decisions. What changed is the row itself: a `<ul>` of run-together text
 * becomes a real table, with the buyer and phone the agent typed sitting
 * beside the reason, so a name does not have to be looked up to fix a serial.
 */

/** The buyer's name as it was typed, from the row's own payload. */
function buyerOf(r) {
  return (
    r.raw?.["Buyer On Record"] ?? r.raw?.["Buyer"] ?? r.raw?.["End user name"] ?? r.raw?.end_user_name ?? "-"
  );
}

/** The number as it was typed, from the row's own payload. */
function phoneOf(r) {
  return (
    r.raw?.["Phone On Record"] ?? r.raw?.["Phone"] ?? r.raw?.["Primary Phone Number"] ?? r.raw?.phone ?? "-"
  );
}

export default function CallExceptionsTable({ batchId, canResolve = false, onResolved }) {
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
   * the box sent an empty string and hit a silent return.
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
    return <p className="p-3 text-sm text-gray-500">Nothing in this batch needs a look.</p>;
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
          className="inline-flex items-center gap-1.5 rounded-md border border-(--dc-brief-stove) px-2.5 py-1 text-xs font-semibold text-(--dc-brief-stove) transition hover:bg-(--dc-brief-stove-soft)"
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
                    <span className="rounded-full bg-(--dc-brief-place-soft) px-2 py-0.5 text-xs font-semibold text-(--dc-brief-place) tabular-nums">
                      {g.rows.length}
                    </span>
                    {/*
                      The distinction that decides whether somebody edits a
                      file or fixes something elsewhere. On the receipt import
                      122 rows were once worked one at a time when fourteen
                      edits in another system would have cleared all of them.
                    */}
                    {g.selfHealing && (
                      <span className="rounded-full bg-(--dc-brief-stove-soft) px-2 py-0.5 text-xs font-medium text-(--dc-brief-stove)">
                        clears itself
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-xs text-gray-600">{g.what}</span>
                </span>
              </button>
              {isOpen && (
                <div className="overflow-x-auto bg-gray-50 pb-3 pl-9 pr-3">
                  <table className="w-full text-xs">
                    <thead className="text-left uppercase tracking-wide text-gray-500">
                      <tr>
                        <th scope="col" className="py-1 pr-2 font-medium">Row</th>
                        <th scope="col" className="py-1 pr-2 font-medium">Serial</th>
                        <th scope="col" className="py-1 pr-2 font-medium">Buyer</th>
                        <th scope="col" className="py-1 pr-2 font-medium">Phone</th>
                        <th scope="col" className="py-1 pr-2 font-medium">Why</th>
                        <th scope="col" className="py-1 pr-2 font-medium">Fix</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {g.rows.slice(0, 50).map((r) => (
                        <tr key={r.id}>
                          <td className="py-1.5 pr-2 tabular-nums font-medium text-gray-800">
                            {r.row_number}
                          </td>
                          <td className="py-1.5 pr-2 font-mono text-gray-800">
                            {r.stove_serial_no ?? "(no serial number)"}
                          </td>
                          <td className="max-w-[10rem] truncate py-1.5 pr-2 text-gray-700">
                            {buyerOf(r)}
                          </td>
                          <td className="py-1.5 pr-2 text-gray-700">{phoneOf(r)}</td>
                          <td className="py-1.5 pr-2 text-gray-600">
                            {r.exception_reason ?? r.rejection_reason}
                            {rowNote?.id === r.id && (
                              <span className="mt-0.5 block text-(--dc-brief-place)">
                                {rowNote.text}
                              </span>
                            )}
                          </td>
                          <td className="py-1.5 pr-2">
                            {g.fixable && canResolve ? (
                              <span className="flex flex-wrap items-center gap-1.5">
                                <input
                                  type="text"
                                  aria-label={`Corrected serial number for row ${r.row_number}`}
                                  value={drafts[r.id] ?? r.stove_serial_no ?? ""}
                                  onChange={(ev) =>
                                    setDrafts((d) => ({ ...d, [r.id]: ev.target.value }))
                                  }
                                  className="w-32 rounded border border-gray-300 px-2 py-1 font-mono text-xs"
                                />
                                <button
                                  type="button"
                                  disabled={fixing === r.id}
                                  onClick={() => resolve(r)}
                                  className="inline-flex items-center gap-1 rounded border border-(--dc-brief-place) px-2 py-1 text-xs font-semibold text-(--dc-brief-place) transition hover:bg-(--dc-brief-place-soft) disabled:opacity-50"
                                >
                                  {fixing === r.id ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <Wrench className="h-3 w-3" />
                                  )}
                                  Fix
                                </button>
                              </span>
                            ) : (
                              <span className="text-gray-400">-</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {g.rows.length > 50 && (
                    <p className="pt-1 text-xs text-gray-500">
                      and {g.rows.length - 50} more, all in the download.
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
