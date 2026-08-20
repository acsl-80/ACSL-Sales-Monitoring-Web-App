import { useCallback, useEffect, useMemo, useState } from "react";
import { dataCenterAssign, DataCenterError } from "../../lib/client";
import { toCsv, downloadCsv } from "../../lib/export";
import {
  ClipboardList, Loader2, AlertTriangle, Download, Play, RotateCcw, X,
} from "lucide-react";

/**
 * Who was given what, and what came of it.
 *
 * The answer to the question the spreadsheets could not answer: which agent
 * holds which partner's records, which went quiet, and what each call
 * concluded. One row per assigned record, newest batch first.
 *
 * Admins also get the two levers here: assign now, and reclaim quiet batches.
 * Everything they cause is visible in the same table they caused it from,
 * which is what makes pressing them feel safe.
 */

const NUMBER = new Intl.NumberFormat("en-NG");

const STATE_TONE = {
  open: "bg-blue-100 text-blue-800",
  completed: "bg-(--dc-primary)/10 text-(--dc-accent)",
  reclaimed: "bg-purple-100 text-purple-800",
};

const OUTCOME_TONE = {
  fully_verified: "text-(--dc-accent)",
  partially_verified: "text-amber-700",
  doubtful_verification: "text-amber-700",
  unreachable: "text-orange-700",
  not_verified: "text-gray-500",
};

const outcomeLabel = (v) => (v ? v.replace(/_/g, " ") : "no outcome yet");

export default function AssignmentLog({ canRun }) {
  const [rows, setRows] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [scope, setScope] = useState(null);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [batchState, setBatchState] = useState("");

  const filters = useMemo(
    () => (batchState ? { batchState } : {}),
    [batchState],
  );

  const load = useCallback(
    async (append = false, after = null) => {
      if (!append) setLoading(true);
      try {
        const page = await dataCenterAssign.log({ cursor: after, filters });
        setRows((prev) => (append ? [...prev, ...page.rows] : page.rows));
        setCursor(page.nextCursor);
        setMore(page.nextCursor !== null);
        setScope(page.scope);
        setError(null);
      } catch (err) {
        setError(
          err instanceof DataCenterError ? err.message : "Could not load the assignment log.",
        );
      } finally {
        setLoading(false);
      }
    },
    [filters],
  );

  useEffect(() => {
    load();
  }, [load]);

  const runAssignment = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const out = await dataCenterAssign.run();
      setNotice(
        `${out.batches.length} batch(es) assigned` +
          (out.reclaimed ? `, ${out.reclaimed} reclaimed first` : "") +
          (out.batches.length === 0 && !out.reclaimed
            ? ". Nothing to hand out: agents are at capacity or the pool is empty."
            : "."),
      );
      await load();
    } catch (err) {
      setError(err instanceof DataCenterError ? err.message : "Assignment failed.");
    } finally {
      setBusy(false);
    }
  };

  const runReclaim = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const out = await dataCenterAssign.reclaim();
      setNotice(
        out.reclaimed
          ? `${out.reclaimed} quiet batch(es) reclaimed. Their records are back in the pool.`
          : "Nothing to reclaim: every open batch has recent activity.",
      );
      await load();
    } catch (err) {
      setError(err instanceof DataCenterError ? err.message : "Reclaim failed.");
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = () => {
    downloadCsv(
      "assignment-log.csv",
      toCsv(rows, [
        "batch_id", "batch_state", "partner_name", "agent_name", "assigned_at",
        "position", "stove_serial_no", "sales_date", "number_on_record",
        "verification_outcome", "call_outcome", "attempt_count",
        "last_attempt_at", "last_attempt_outcome", "last_attempt_by",
        "reclaim_reason",
      ]),
    );
  };

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 border-t-[3px] border-t-(--dc-accent) bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 bg-(--dc-accent-soft)/30 px-4 py-3">
        <ClipboardList className="h-4 w-4 text-(--dc-accent)" />
        <span className="text-sm font-semibold text-gray-900">Assignment Log</span>
        <span className="text-sm text-gray-500">
          {loading ? "loading..." : `${NUMBER.format(rows.length)} record(s) shown`}
        </span>
        {scope && (
          <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-600">
            showing {scope}
          </span>
        )}
        <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
          {canRun && (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={runAssignment}
                className="inline-flex items-center gap-1.5 rounded-md bg-(--dc-accent) px-2.5 py-1.5 text-xs font-medium text-white hover:bg-(--dc-accent-strong) disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                Assign now
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={runReclaim}
                className="inline-flex items-center gap-1.5 rounded-md border border-(--dc-accent)/30 px-2.5 py-1.5 text-xs font-medium text-(--dc-accent) transition hover:bg-(--dc-accent-soft)/60 disabled:opacity-50"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Reclaim quiet batches
              </button>
            </>
          )}
          <button
            type="button"
            onClick={exportCsv}
            disabled={rows.length === 0}
            className="inline-flex items-center gap-1.5 rounded-md border border-(--dc-accent)/30 px-2.5 py-1.5 text-xs font-medium text-(--dc-accent) transition hover:bg-(--dc-accent-soft)/60 disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" /> Export CSV
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-4 py-2.5">
        <label htmlFor="dc-log-state" className="text-xs font-medium text-gray-700">
          Batch state
        </label>
        <select
          id="dc-log-state"
          value={batchState}
          onChange={(e) => setBatchState(e.target.value)}
          className="rounded-md border border-gray-300 px-2 py-1 text-xs focus:border-(--dc-accent) focus:outline-none"
        >
          <option value="">All</option>
          <option value="open">Open</option>
          <option value="completed">Completed</option>
          <option value="reclaimed">Reclaimed</option>
        </select>
        {batchState && (
          <button
            type="button"
            onClick={() => setBatchState("")}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-gray-500 hover:bg-gray-100"
          >
            <X className="h-3 w-3" /> Clear
          </button>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="text-sm text-amber-900">{error}</p>
        </div>
      )}
      {notice && (
        <p className="border-b border-(--dc-primary)/20 bg-(--dc-primary-soft)/50 px-4 py-2.5 text-sm text-(--dc-accent)">
          {notice}
        </p>
      )}

      {loading ? (
        <p className="flex items-center gap-2 p-6 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading the log...
        </p>
      ) : rows.length === 0 ? (
        <p className="m-4 rounded-lg border border-dashed border-(--dc-accent)/30 p-6 text-center text-sm text-gray-500">
          Nothing has been assigned yet{batchState ? " in that state" : ""}.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-[1100px] w-full text-sm">
            <thead>
              <tr className="border-b-2 border-(--dc-accent)/20 bg-(--dc-accent-soft) text-xs font-semibold uppercase tracking-wide text-(--dc-accent-strong)">
                {["Batch", "Agent", "Partner", "Assigned", "#", "Serial", "Outcome", "Attempts", "Last call", "By"].map(
                  (h, i) => (
                    <th
                      key={h}
                      scope="col"
                      className={`px-3 py-2 text-left ${
                        i === 0 ? "sticky left-0 z-10 bg-(--dc-accent-soft)" : ""
                      }`}
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.batch_id}-${r.sale_id}`} className="group border-b border-gray-100">
                  <td className="sticky left-0 z-10 bg-white px-3 py-2 transition group-hover:bg-(--dc-accent-soft)">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATE_TONE[r.batch_state]}`}>
                      {r.batch_state}
                    </span>
                    {r.reclaim_reason && (
                      <p className="mt-0.5 text-xs text-purple-700">{r.reclaim_reason}</p>
                    )}
                  </td>
                  <td className="px-3 py-2 text-gray-900">{r.agent_name ?? "—"}</td>
                  <td className="px-3 py-2 text-gray-700">{r.partner_name}</td>
                  <td className="px-3 py-2 text-gray-500">
                    {new Date(r.assigned_at).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-gray-500">{r.position}</td>
                  <td className="px-3 py-2 font-mono text-xs text-gray-700">{r.stove_serial_no}</td>
                  <td className={`px-3 py-2 text-xs font-medium ${OUTCOME_TONE[r.verification_outcome] ?? "text-gray-500"}`}>
                    {outcomeLabel(r.verification_outcome)}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-gray-700">{r.attempt_count ?? 0}</td>
                  <td className="px-3 py-2 text-gray-500">
                    {r.last_attempt_at ? new Date(r.last_attempt_at).toLocaleString() : "—"}
                  </td>
                  <td className="px-3 py-2 text-gray-500">{r.last_attempt_by ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {more && !loading && (
        <div className="border-t border-gray-100 px-4 py-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => load(true, cursor)}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Load more
          </button>
        </div>
      )}
    </div>
  );
}
