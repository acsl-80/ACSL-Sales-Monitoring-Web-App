import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { dataCenterImport, DataCenterError } from "../../lib/client";
import { parseCsv, CsvError } from "../../lib/csv";
import ColumnMapping from "./ColumnMapping";
import ManualEntry from "./ManualEntry";
import {
  Upload, Loader2, AlertTriangle, CheckCircle2, FileText, Play,
  Eye, Undo2, Wrench, X, PenLine, Copy,
} from "lucide-react";

/**
 * Bulk import of digitalized paper receipts.
 *
 * The UI is deliberately four steps rather than one button, because committing
 * marks hundreds of stoves sold and changes the sales app's own inventory
 * figures. Every step says what it is about to do before it does it.
 *
 * The exceptions queue is not an error screen. Roughly one serial in twelve
 * does not match stock in a real workbook, and a person with the receipt in
 * front of them can usually fix it. That is the normal path.
 */

const STATE_TONE = {
  staged: "bg-gray-100 text-gray-700",
  validated: "bg-blue-100 text-blue-800",
  dry_run: "bg-amber-100 text-amber-800",
  committed: "bg-[#4a5d0f]/10 text-[#4a5d0f]",
  rolled_back: "bg-purple-100 text-purple-800",
  failed: "bg-red-100 text-red-700",
};

function Stat({ label, value, tone }) {
  return (
    <div className="rounded-lg border border-gray-200 px-3 py-2">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-lg font-semibold ${tone ?? "text-gray-900"}`}>{value}</p>
    </div>
  );
}

function ExceptionsQueue({ batchId, canResolve, onChanged }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [drafts, setDrafts] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await dataCenterImport.rows(batchId, "exception"));
    } finally {
      setLoading(false);
    }
  }, [batchId]);

  useEffect(() => {
    load();
  }, [load]);

  const resolve = async (rowId) => {
    const serial = (drafts[rowId] ?? "").trim();
    if (!serial) return;
    setBusy(rowId);
    try {
      const out = await dataCenterImport.resolveException(rowId, serial);
      if (!out.resolved) {
        // The correction did not fix it. Say so here rather than letting the
        // row look resolved and fail later at commit.
        setRows((rs) => rs.map((r) => (r.id === rowId ? { ...r, exception_reason: out.reason } : r)));
      } else {
        await load();
        onChanged?.();
      }
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <p className="flex items-center gap-2 p-3 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading exceptions...
      </p>
    );
  }
  if (rows.length === 0) {
    return <p className="p-3 text-sm text-gray-500">No exceptions in this batch.</p>;
  }

  return (
    <ul className="divide-y divide-gray-100">
      {rows.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
          <span className="w-10 shrink-0 text-xs text-gray-400">#{r.row_number}</span>
          <span className="min-w-[180px] flex-1 text-amber-800">{r.exception_reason}</span>
          <span className="shrink-0 text-xs text-gray-500">
            {r.raw?.["User First Name"] ?? r.raw?.end_user_name ?? r.raw?.name ?? ""}
          </span>
          {canResolve && (
            <>
              <input
                type="text"
                value={drafts[r.id] ?? r.stove_serial_no ?? ""}
                onChange={(e) => setDrafts((d) => ({ ...d, [r.id]: e.target.value }))}
                placeholder="Correct serial"
                className="w-36 rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-[#4a5d0f] focus:outline-none"
              />
              <button
                type="button"
                disabled={busy === r.id}
                onClick={() => resolve(r.id)}
                className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[#4a5d0f]/30 px-2 py-1 text-xs font-medium text-[#4a5d0f] hover:bg-[#4a5d0f]/10 disabled:opacity-50"
              >
                {busy === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wrench className="h-3 w-3" />}
                Fix
              </button>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

export default function ImportPanel({ canUpload, canCommit, canResolve, organizations }) {
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [open, setOpen] = useState(null);
  const [dryRun, setDryRun] = useState(null);
  const [orgId, setOrgId] = useState("");
  // A file held between inspection and staging, while the operator maps its
  // strays. Null whenever there is nothing to decide.
  const [pendingFile, setPendingFile] = useState(null);
  // A staged upload refused as a repeat. Holds what it takes to send it again.
  const [duplicate, setDuplicate] = useState(null);
  const [manual, setManual] = useState(false);
  const fileInput = useRef(null);

  const refresh = useCallback(async () => {
    try {
      setBatches(await dataCenterImport.batches());
      setError(null);
    } catch (err) {
      setError(err instanceof DataCenterError ? err.message : "Could not load import batches.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  /**
   * Stage a parsed file, then validate it.
   *
   * Split out from onFile because three paths reach it: a clean file straight
   * through, a mapped file after the operator has placed its stray columns,
   * and a repeat upload they have confirmed.
   */
  const stageAndValidate = useCallback(
    async (file, options = {}) => {
      setBusy(true);
      setNotice(null);
      try {
        const { batchId } = await dataCenterImport.stage(
          orgId,
          file.name,
          file.rows,
          options,
        );
        const counts = await dataCenterImport.validate(batchId);
        setNotice(
          `${file.name}: ${file.rows.length} rows staged. ${counts.valid} ready, ` +
            `${counts.exception} need a look, ${counts.rejected} could not be read. ` +
            `${counts.linkedToTransfer} matched to a transfer.` +
            (file.warnings?.length ? ` ${file.warnings[0]}` : ""),
        );
        setError(null);
        setPendingFile(null);
        setDuplicate(null);
        await refresh();
        setOpen(batchId);
      } catch (err) {
        // A repeat upload is a warning, not a failure. Hold what it takes to
        // send it again, because the legitimate case is real: a partner can
        // return the same serials after a correction.
        if (err instanceof DataCenterError && err.code === "duplicate_upload") {
          setDuplicate({ file, options, message: err.message });
          setError(null);
        } else {
          setError(
            err instanceof DataCenterError ? err.message : "Could not stage that file.",
          );
        }
      } finally {
        setBusy(false);
      }
    },
    [orgId, refresh],
  );

  const onFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!orgId) {
      setError("Choose which partner this file belongs to first.");
      return;
    }
    setBusy(true);
    setNotice(null);
    setDuplicate(null);
    try {
      const parsed = parseCsv(await file.text());
      const held = {
        name: file.name,
        rows: parsed.rows,
        warnings: parsed.warnings,
        rowCount: parsed.rows.length,
      };
      const inspection = await dataCenterImport.inspect(parsed.headers);

      // Only stop when there is something to decide. A file whose columns are
      // all understood goes straight through: a confirmation nobody can fail
      // is a click that trains people to click.
      if (
        inspection.unrecognised.length === 0 &&
        inspection.missingRequired.length === 0 &&
        held.rowCount <= inspection.maxRows
      ) {
        await stageAndValidate(held);
      } else {
        setPendingFile({ file: held, inspection });
        setError(null);
      }
    } catch (err) {
      setError(
        err instanceof CsvError || err instanceof DataCenterError
          ? err.message
          : "Could not read that file.",
      );
    } finally {
      setBusy(false);
    }
  };

  const submitManual = async (record) => {
    setBusy(true);
    setNotice(null);
    try {
      const { batchId } = await dataCenterImport.manualEntry(orgId, record);
      const counts = await dataCenterImport.validate(batchId);
      setNotice(
        counts.valid === 1
          ? "Record staged and ready to commit."
          : counts.exception === 1
            ? "Record staged, and it needs a look before it can be committed."
            : "Record staged, and it could not be read.",
      );
      setError(null);
      setManual(false);
      await refresh();
      setOpen(batchId);
    } catch (err) {
      setError(
        err instanceof DataCenterError ? err.message : "Could not stage that record.",
      );
    } finally {
      setBusy(false);
    }
  };

  const runDryRun = async (batchId) => {
    setBusy(true);
    try {
      setDryRun(await dataCenterImport.dryRun(batchId));
      await refresh();
    } catch (err) {
      setError(err instanceof DataCenterError ? err.message : "Dry run failed.");
    } finally {
      setBusy(false);
    }
  };

  /**
   * Commit, one slice at a time, until the batch is done.
   *
   * The loop lives here rather than on the server so no single request runs
   * long and the operator can watch it move. A failure stops the loop with the
   * batch part-committed, which is recoverable: asking again resumes.
   */
  const runCommit = async (batchId, total) => {
    if (!window.confirm(
      `This creates ${total} sales and marks ${total} stoves sold. ` +
      `The sales app's inventory figures will change. Continue?`,
    )) return;

    setBusy(true);
    setProgress({ done: 0, failed: 0 });
    try {
      for (;;) {
        const out = await dataCenterImport.commit(batchId);
        setProgress((p) => ({
          done: (p?.done ?? 0) + out.committed,
          failed: (p?.failed ?? 0) + out.failed,
        }));
        if (out.done) break;
        if (out.committed === 0 && out.failed === 0) break;
      }
      setNotice("Commit finished.");
      await refresh();
    } catch (err) {
      setError(err instanceof DataCenterError ? err.message : "Commit stopped early. Ask again to resume.");
    } finally {
      setBusy(false);
    }
  };

  const runRollback = async (batchId, committed) => {
    if (!window.confirm(
      `This deletes ${committed} sales and puts ${committed} stoves back to available. Continue?`,
    )) return;
    setBusy(true);
    setProgress({ done: 0, failed: 0 });
    try {
      for (;;) {
        const out = await dataCenterImport.rollback(batchId);
        setProgress((p) => ({ done: (p?.done ?? 0) + out.reversed, failed: p?.failed ?? 0 }));
        if (out.done || out.reversed === 0) break;
      }
      setNotice("Rolled back.");
      await refresh();
    } catch (err) {
      setError(err instanceof DataCenterError ? err.message : "Rollback stopped early.");
    } finally {
      setBusy(false);
    }
  };

  const orgOptions = useMemo(() => organizations ?? [], [organizations]);

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3">
        <Upload className="h-4 w-4 text-[#4a5d0f]" />
        <span className="text-sm font-semibold text-gray-900">Bulk Import</span>
        <span className="text-sm text-gray-500">Digitalized paper receipts</span>
      </div>

      {canUpload && (
        <div className="flex flex-wrap items-end gap-2 border-b border-gray-100 px-4 py-3">
          <div>
            <label htmlFor="dc-import-org" className="mb-1 block text-xs font-medium text-gray-700">
              Partner
            </label>
            <select
              id="dc-import-org"
              value={orgId}
              onChange={(e) => setOrgId(e.target.value)}
              className="min-w-[200px] rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-[#4a5d0f] focus:outline-none"
            >
              <option value="">Choose a partner...</option>
              {orgOptions.map((o) => (
                <option key={o.id} value={o.id}>{o.partner_name}</option>
              ))}
            </select>
          </div>
          <input
            ref={fileInput}
            type="file"
            accept=".csv,text/csv"
            onChange={onFile}
            className="hidden"
          />
          <button
            type="button"
            disabled={busy || !orgId}
            onClick={() => {
              setManual(false);
              fileInput.current?.click();
            }}
            className="inline-flex items-center gap-1.5 rounded-md bg-[#4a5d0f] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#3d4d0c] disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
            Choose a CSV
          </button>
          <button
            type="button"
            disabled={busy || !orgId}
            onClick={() => {
              setPendingFile(null);
              setDuplicate(null);
              setManual((m) => !m);
            }}
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <PenLine className="h-4 w-4" /> Type one record
          </button>
          <p className="text-xs text-gray-500">
            Staged and checked on upload. Nothing is committed until you say so.
          </p>
        </div>
      )}

      {canUpload && manual && (
        <ManualEntry
          busy={busy}
          partnerName={orgOptions.find((o) => o.id === orgId)?.partner_name}
          onCancel={() => setManual(false)}
          onSubmit={submitManual}
        />
      )}

      {canUpload && pendingFile && (
        <ColumnMapping
          busy={busy}
          file={pendingFile.file}
          inspection={pendingFile.inspection}
          onCancel={() => setPendingFile(null)}
          onConfirm={(columnMapping) =>
            stageAndValidate(pendingFile.file, { columnMapping })
          }
        />
      )}

      {canUpload && duplicate && (
        <div className="flex flex-wrap items-start gap-2 border-b border-amber-200 bg-amber-50 px-4 py-3">
          <Copy className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="min-w-[240px] flex-1 text-sm text-amber-900">{duplicate.message}</p>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              stageAndValidate(duplicate.file, {
                ...duplicate.options,
                confirmDuplicate: true,
              })
            }
            className="inline-flex items-center gap-1.5 rounded-md border border-amber-400 px-2.5 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
          >
            Upload it again
          </button>
          <button
            type="button"
            onClick={() => setDuplicate(null)}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-amber-800 hover:bg-amber-100"
          >
            <X className="h-3.5 w-3.5" /> Discard
          </button>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="text-sm text-amber-900">{error}</p>
        </div>
      )}
      {notice && (
        <div className="flex items-start gap-2 border-b border-[#4a5d0f]/20 bg-[#eef3c4]/50 px-4 py-3">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#4a5d0f]" />
          <p className="text-sm text-[#4a5d0f]">{notice}</p>
        </div>
      )}
      {progress && busy && (
        <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-2 text-sm text-gray-600">
          <Loader2 className="h-4 w-4 animate-spin" />
          {progress.done} done{progress.failed ? `, ${progress.failed} could not be committed` : ""}
        </div>
      )}

      {loading ? (
        <p className="flex items-center gap-2 p-6 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading batches...
        </p>
      ) : batches.length === 0 ? (
        <p className="p-6 text-sm text-gray-500">No imports yet.</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {batches.map((b) => (
            <li key={b.id} className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATE_TONE[b.state]}`}>
                  {b.state.replace(/_/g, " ")}
                </span>
                <span className="text-sm font-medium text-gray-900">{b.filename ?? "(no filename)"}</span>
                <span className="text-xs text-gray-500">
                  {b.partner_name} · {new Date(b.uploaded_at).toLocaleString()}
                  {b.uploaded_by_name ? ` · ${b.uploaded_by_name}` : ""}
                </span>
                <button
                  type="button"
                  onClick={() => { setOpen(open === b.id ? null : b.id); setDryRun(null); }}
                  className="ml-auto text-xs font-medium text-gray-500 underline-offset-2 hover:text-gray-800 hover:underline"
                >
                  {open === b.id ? "hide" : "details"}
                </button>
              </div>

              {open === b.id && (
                <div className="mt-3 space-y-3">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                    <Stat label="Rows" value={b.total_rows} />
                    <Stat label="Ready" value={b.valid_rows} tone="text-[#4a5d0f]" />
                    <Stat label="Exceptions" value={b.exception_rows} tone="text-amber-700" />
                    <Stat label="Unreadable" value={Math.max(0, b.rejected_rows - b.exception_rows)} tone="text-red-600" />
                    <Stat label="Committed" value={b.committed_rows} />
                  </div>

                  {b.last_error && (
                    <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{b.last_error}</p>
                  )}

                  <div className="flex flex-wrap gap-2">
                    {canUpload && b.state !== "committed" && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => runDryRun(b.id)}
                        className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                      >
                        <Eye className="h-3.5 w-3.5" /> Dry run
                      </button>
                    )}
                    {canCommit && b.valid_rows > 0 && b.state !== "committed" && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => runCommit(b.id, b.valid_rows)}
                        className="inline-flex items-center gap-1 rounded-md bg-[#4a5d0f] px-2.5 py-1.5 text-xs font-medium text-white hover:bg-[#3d4d0c] disabled:opacity-50"
                      >
                        <Play className="h-3.5 w-3.5" /> Commit {b.valid_rows}
                      </button>
                    )}
                    {canCommit && b.committed_rows > 0 && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => runRollback(b.id, b.committed_rows)}
                        className="inline-flex items-center gap-1 rounded-md border border-red-300 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                      >
                        <Undo2 className="h-3.5 w-3.5" /> Roll back {b.committed_rows}
                      </button>
                    )}
                  </div>

                  {dryRun && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                      <div className="mb-1 flex items-center gap-2">
                        <Eye className="h-4 w-4 text-amber-700" />
                        <h3 className="text-sm font-semibold text-amber-900">What a commit would do</h3>
                        <button
                          type="button"
                          onClick={() => setDryRun(null)}
                          aria-label="Dismiss the dry run"
                          className="ml-auto rounded p-0.5 text-amber-700 hover:bg-amber-100"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <p className="text-sm text-amber-900">{dryRun.note}</p>
                      <p className="mt-2 text-sm text-amber-900">
                        {dryRun.stovesThatWouldSell.length} stove(s) would move from available to sold.
                      </p>
                      {dryRun.stovesThatWouldSell.length > 0 && (
                        <p className="mt-1 break-words font-mono text-xs text-amber-800">
                          {dryRun.stovesThatWouldSell.slice(0, 40).join(", ")}
                          {dryRun.stovesThatWouldSell.length > 40 ? " ..." : ""}
                        </p>
                      )}
                    </div>
                  )}

                  {b.exception_rows > 0 && (
                    <div className="rounded-lg border border-gray-200">
                      <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
                        <Wrench className="h-4 w-4 text-amber-600" />
                        <h3 className="text-sm font-semibold text-gray-900">
                          Exceptions ({b.exception_rows})
                        </h3>
                        <span className="text-xs text-gray-500">
                          Roughly one serial in twelve needs a person. This is the normal path.
                        </span>
                      </div>
                      <ExceptionsQueue
                        batchId={b.id}
                        canResolve={canResolve}
                        onChanged={refresh}
                      />
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
