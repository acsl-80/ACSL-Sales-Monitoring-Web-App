import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "@/compat/Link";
import PeriodFilter from "../../components/PeriodFilter";
import { usePeriod } from "../../lib/usePeriod";
import { dataCenterAssign, dataCenterWrite, DataCenterError } from "../../lib/client";
import { plural } from "../../lib/plural";
import ExportButton from "../../components/ExportButton";
import CallRecordEditor from "./CallRecordEditor";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  ClipboardList, Loader2, AlertTriangle, Play, RotateCcw, X,
  ChevronLeft, ChevronRight, Pencil, PhoneCall, Check, Users,
} from "lucide-react";

/**
 * Every record that has been handed to somebody, and what has come of it.
 *
 * One row is one stove record inside one batch: who holds it, whose partner it
 * belongs to, how many times it has been rung and what the last call concluded.
 * That is the question the agents' private spreadsheets could never answer,
 * because each of them only held their own.
 *
 * It used to be a table you could only look at, which made it a report rather
 * than a place of work: seeing that a record had been rung twice and concluded
 * nothing, you then went and found it in the queue. Now the row is the way in.
 * Clicking it opens the same enrichment editor the queue opens, and the quick
 * edit logs a call or settles the verification without leaving the table at
 * all, because those two are most of what anyone does here.
 *
 * Paging is keyset, forward on a cursor the server hands back and backward on
 * the cursors already seen. No OFFSET, ever: at 500,000 rows page 400 would
 * read every row before it.
 */

const STATE_TONE = {
  open: "bg-blue-100 text-blue-800",
  completed: "bg-(--dc-primary)/10 text-(--dc-accent)",
  reclaimed: "bg-purple-100 text-purple-800",
};

const OUTCOME_TONE = {
  fully_verified: "text-(--dc-accent)",
  partially_verified: "text-amber-700",
  unreachable: "text-orange-700",
  not_verified: "text-gray-500",
};

/** The five states a record can settle in, shortest label first on a phone. */
const VERIFICATION = [
  { value: "fully_verified", label: "Fully verified" },
  { value: "partially_verified", label: "Partially verified" },
  { value: "unreachable", label: "Unreachable" },
  { value: "not_verified", label: "Not verified" },
];

const outcomeLabel = (v) => (v ? v.replace(/_/g, " ") : "no outcome yet");
const dateOf = (iso) => (iso ? new Date(iso).toLocaleDateString() : "-");
const whenOf = (iso) => (iso ? new Date(iso).toLocaleString() : "-");

const EXPORT_COLUMNS = [
  { key: "batch_state", label: "Batch state" },
  { key: "partner_name", label: "Partner" },
  { key: "agent_name", label: "Agent" },
  { key: "assigned_at", label: "Assigned" },
  { key: "position", label: "Position" },
  { key: "stove_serial_no", label: "Stove serial" },
  { key: "sales_date", label: "Sold" },
  { key: "number_on_record", label: "Phone" },
  { key: "verification_outcome", label: "Verification" },
  { key: "call_outcome", label: "Call outcome" },
  { key: "attempt_count", label: "Calls made" },
  { key: "last_attempt_at", label: "Last call" },
  { key: "last_attempt_outcome", label: "Last call outcome" },
  { key: "last_attempt_by", label: "Called by" },
  { key: "reclaim_reason", label: "Reclaim reason" },
  { key: "batch_id", label: "Batch id" },
  { key: "sale_id", label: "Sale id" },
];

/* --------------------------------------------------------------- quick edit */

/**
 * The two things anyone does to a record here, without opening it.
 *
 * Logging a call is append-only, so it needs nothing but an outcome. Settling
 * the verification needs the record's version, which is read at the moment of
 * saving rather than held: the server refuses a stale version rather than
 * merging, and a version fetched when the page loaded is stale by definition.
 */
function QuickEdit({ row, outcomes, onDone }) {
  const [open, setOpen] = useState(false);
  const [outcomeId, setOutcomeId] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const needsNote = outcomes.find((o) => o.id === outcomeId)?.value === "other";

  const run = async (work) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      setOutcomeId("");
      setNote("");
      setOpen(false);
      await onDone();
    } catch (err) {
      setError(err instanceof DataCenterError ? err.message : "That did not save.");
    } finally {
      setBusy(false);
    }
  };

  const logCall = () =>
    run(() =>
      dataCenterWrite.logAttempt(row.sale_id, {
        outcomeId: outcomeId || null,
        note: note.trim() || null,
      }),
    );

  const settle = (value) =>
    run(async () => {
      const current = await dataCenterWrite.callRecord(row.sale_id);
      await dataCenterWrite.saveCallRecord(
        row.sale_id,
        { verification_outcome: value },
        current?.record?.version ?? null,
      );
    });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Quick edit ${row.stove_serial_no}`}
          onClick={(e) => e.stopPropagation()}
          className="rounded p-1 text-gray-500 transition hover:bg-(--dc-accent-soft) hover:text-(--dc-accent)"
        >
          <Pencil className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        onClick={(e) => e.stopPropagation()}
        className="dc-root w-[min(22rem,90vw)] p-3"
        data-area="call-centre"
      >
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide">
          <Link
            href={`/data-center/stove/${encodeURIComponent(row.stove_serial_no)}`}
            className="text-(--dc-accent-strong) underline decoration-(--dc-accent)/30 underline-offset-2 hover:decoration-(--dc-accent)"
          >
            {row.stove_serial_no}
          </Link>
        </p>
        {error && <p className="mb-2 text-xs text-red-600">{error}</p>}

        <label className="mb-1 block text-xs font-medium text-gray-700" htmlFor={`qo-${row.sale_id}`}>
          Log a call
        </label>
        <div className="flex gap-1.5">
          <select
            id={`qo-${row.sale_id}`}
            value={outcomeId}
            onChange={(e) => setOutcomeId(e.target.value)}
            className="min-w-0 flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-xs focus:border-(--dc-accent) focus:outline-none"
          >
            <option value="">Outcome...</option>
            {outcomes.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
          <button
            type="button"
            disabled={busy || (needsNote && !note.trim())}
            onClick={logCall}
            className="inline-flex shrink-0 items-center gap-1 rounded-md bg-(--dc-accent) px-2 py-1.5 text-xs font-medium text-white transition hover:bg-(--dc-accent-strong) disabled:opacity-40"
          >
            <PhoneCall className="h-3 w-3" /> Log
          </button>
        </div>

        {/* The tenth outcome exists so nobody invents one in a constrained
            column, which only works if it asks what happened. */}
        {needsNote && (
          <textarea
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Say what the outcome was"
            aria-label="What happened on this call"
            className="mt-1.5 w-full rounded-md border border-gray-300 px-2 py-1.5 text-xs focus:border-(--dc-accent) focus:outline-none"
          />
        )}

        <p className="mb-1 mt-3 text-xs font-medium text-gray-700">Settle the verification</p>
        <div className="flex flex-wrap gap-1">
          {VERIFICATION.map((v) => {
            const current = row.verification_outcome === v.value;
            return (
              <button
                key={v.value}
                type="button"
                disabled={busy || current}
                onClick={() => settle(v.value)}
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium transition disabled:opacity-60 ${
                  current
                    ? "border-(--dc-accent) bg-(--dc-accent-soft) text-(--dc-accent-strong)"
                    : "border-gray-300 text-gray-700 hover:border-(--dc-accent)/40 hover:bg-(--dc-accent-soft)/50"
                }`}
              >
                {current && <Check className="h-3 w-3" />}
                {v.label}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/* -------------------------------------------------------------------- table */

const PAGE_SIZES = [25, 50, 100];

export default function AssignmentLog({ canRun, canEdit = false }) {
  const [rows, setRows] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [history, setHistory] = useState([]);
  const [pageSize, setPageSize] = useState(25);
  const [scope, setScope] = useState(null);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [batchState, setBatchState] = useState("");
  const [outcomes, setOutcomes] = useState([]);
  // The cursor that produced the page currently on screen. Kept beside the
  // history rather than inside it: "where am I" and "where have I been" are
  // two questions, and conflating them is how a Previous button ends up one
  // page out. It is also what a quick edit reloads against, so saving a row
  // does not throw the reader back to page one.
  const [currentCursorRef, setCurrentCursorRef] = useState(null);
  const [openSale, setOpenSale] = useState(null);

  /**
   * Whose work this is, and whether to read it agent by agent.
   *
   * The log listed every assignment in one flat stream, newest first, which
   * answers "what happened last" and never answers "what is Hanifa holding".
   * That second question is the one a supervisor actually asks - before
   * covering an absence, before moving work, before deciding who is behind.
   */
  const [agents, setAgents] = useState([]);
  const [agentId, setAgentId] = useState("");
  const [grouped, setGrouped] = useState(false);
  const [chosen, setChosen] = useState(() => new Set());
  const [moveTo, setMoveTo] = useState("");

  useEffect(() => {
    let live = true;
    dataCenterAssign
      .agents()
      .then((r) => live && setAgents(r.agents ?? []))
      // A missing agent list costs the filter, not the log. Failing the whole
      // surface because a dropdown could not be filled would be worse than
      // the dropdown being empty.
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  /**
   * The log filters on when work was handed out, which is the date that
   * matters here: an assignment made in March is March's work even if the
   * sale it covers was written in January.
   */
  const { period, setPeriod, resolved, earliest } = usePeriod(
    "/data-center/call-centre",
    "logPeriod",
  );

  /**
   * Move what is ticked, or a whole agent's queue, to somebody else.
   *
   * Straight from here rather than through the pool: a supervisor covering an
   * absence means those records, to that person, and unassign-then-assign
   * would let the engine hand them to a third agent in between.
   */
  const reassign = useCallback(
    async (what) => {
      if (!moveTo) {
        setError("Choose who is taking it first.");
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const r = await dataCenterAssign.reassign(moveTo, what);
        const name = agents.find((a) => a.agent_id === moveTo)?.full_name ?? "that agent";
        setNotice(
          `${r.moved} ${r.moved === 1 ? "record" : "records"} moved to ${name}` +
            (r.closedEmpty > 0
              ? `, and ${r.closedEmpty} emptied ${r.closedEmpty === 1 ? "batch was" : "batches were"} closed.`
              : "."),
        );
        setChosen(new Set());
        await load(currentCursorRef);
      } catch (err) {
        setError(
          err instanceof DataCenterError ? err.message : "Those records could not be moved.",
        );
      } finally {
        setBusy(false);
      }
    },
    [moveTo, agents, load, currentCursorRef],
  );

  const filters = useMemo(
    () => ({
      ...(agentId ? { agentId } : {}),
      ...(batchState ? { batchState } : {}),
      ...(resolved.dateFrom ? { dateFrom: resolved.dateFrom } : {}),
      ...(resolved.dateTo ? { dateTo: resolved.dateTo } : {}),
    }),
    [agentId, batchState, resolved.dateFrom, resolved.dateTo],
  );

  const load = useCallback(
    async (after = null) => {
      setLoading(true);
      try {
        const page = await dataCenterAssign.log({ cursor: after, filters, limit: pageSize });
        setRows(page.rows);
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
    [filters, pageSize],
  );

  // A filter or a page size change starts the paging over: the cursor already
  // in hand points into a result set that no longer exists.
  useEffect(() => {
    setHistory([]);
    setCurrentCursorRef(null);
    load(null);
  }, [load]);

  // The outcome list, once, for the quick edit. Same registry the editor reads,
  // so a choice added in Settings appears in both.
  useEffect(() => {
    if (!canEdit) return;
    dataCenterWrite
      .formSchema()
      .then((s) => setOutcomes(s?.options?.call_outcome ?? []))
      .catch(() => setOutcomes([]));
  }, [canEdit]);

  const goNext = () => {
    if (!cursor) return;
    setHistory((h) => [...h, currentCursorRef]);
    setCurrentCursorRef(cursor);
    load(cursor);
  };

  const goPrevious = () => {
    if (history.length === 0) return;
    const back = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    setCurrentCursorRef(back);
    load(back);
  };

  const runAssignment = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const out = await dataCenterAssign.run();
      setNotice(
        `${plural(out.batches.length, "batch", "batches")} assigned` +
          (out.reclaimed ? `, ${out.reclaimed} reclaimed first` : "") +
          (out.batches.length === 0 && !out.reclaimed
            ? ". Nothing to hand out: agents are at capacity or the pool is empty."
            : "."),
      );
      setHistory([]);
      setCurrentCursorRef(null);
      await load(null);
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
          ? `${plural(out.reclaimed, "quiet batch", "quiet batches")} reclaimed. Their records are back in the pool.`
          : "Nothing to reclaim: every open batch has recent activity.",
      );
      setHistory([]);
      setCurrentCursorRef(null);
      await load(null);
    } catch (err) {
      setError(err instanceof DataCenterError ? err.message : "Reclaim failed.");
    } finally {
      setBusy(false);
    }
  };

  const page = history.length + 1;

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 border-t-[3px] border-t-(--dc-accent) bg-white shadow-sm">
      <div className="border-b border-gray-100 bg-(--dc-accent-soft)/30 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <ClipboardList className="h-4 w-4 text-(--dc-accent)" />
          <span className="text-sm font-semibold text-gray-900">Assignment Log</span>
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
            <ExportButton
              columns={EXPORT_COLUMNS}
              rows={() => rows}
              filename="assignment-log.csv"
              disabled={rows.length === 0}
            />
          </div>
        </div>

        {/* What a row is. The table was read for a fortnight as a list of
            batches, which it is not: it is one line per record inside one. */}
        <p className="mt-1.5 text-sm text-gray-600">
          One line per record handed to an agent: who holds it, whose partner it
          is, and what the last call concluded.
          {canEdit
            ? " Open a row to enrich it, or use the pencil to log a call without leaving the table."
            : ""}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-4 py-2.5">
        <PeriodFilter
          period={period}
          onChange={setPeriod}
          earliest={earliest}
          area="call-centre"
          noun="assignments made"
        />
        <label htmlFor="dc-log-agent" className="text-xs font-medium text-gray-700">
          Agent
        </label>
        <select
          id="dc-log-agent"
          value={agentId}
          onChange={(e) => {
            setAgentId(e.target.value);
            setChosen(new Set());
          }}
          className="rounded-md border border-gray-300 px-2 py-1 text-xs focus:border-(--dc-accent) focus:outline-none"
        >
          <option value="">Everyone</option>
          {agents.map((a) => (
            <option key={a.agent_id} value={a.agent_id}>
              {a.full_name ?? a.email}
              {a.records_held ? ` (${a.records_held} held)` : ""}
            </option>
          ))}
        </select>
        <label className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-700">
          <input
            type="checkbox"
            checked={grouped}
            onChange={(e) => setGrouped(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-gray-300 accent-(--dc-accent)"
          />
          Group by agent
        </label>
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

      {canEdit && chosen.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-(--dc-accent)/25 bg-(--dc-accent-soft)/50 px-4 py-2.5">
          <span className="text-sm font-medium text-(--dc-accent-strong)">
            {chosen.size} {chosen.size === 1 ? "record" : "records"} ticked
          </span>
          <select
            value={moveTo}
            onChange={(e) => setMoveTo(e.target.value)}
            aria-label="Move them to"
            className="rounded-md border border-gray-300 px-2 py-1 text-xs focus:border-(--dc-accent) focus:outline-none"
          >
            <option value="">Move them to...</option>
            {agents
              .filter((a) => a.is_enabled)
              .map((a) => (
                <option key={a.agent_id} value={a.agent_id}>
                  {a.full_name ?? a.email} ({a.records_held} held)
                </option>
              ))}
          </select>
          <button
            type="button"
            disabled={busy || !moveTo}
            onClick={() => reassign({ saleIds: [...chosen] })}
            className="inline-flex items-center gap-1.5 rounded-md bg-(--dc-accent) px-2.5 py-1.5 text-xs font-medium text-white hover:bg-(--dc-accent-strong) disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Users className="h-3.5 w-3.5" />}
            Move
          </button>
          <button
            type="button"
            onClick={() => setChosen(new Set())}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-gray-600 hover:bg-white"
          >
            <X className="h-3 w-3" /> Clear
          </button>
        </div>
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
          <table className="w-full min-w-[64rem] text-sm">
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
                {canEdit && <th scope="col" className="w-12 px-3 py-2" />}
                {canEdit && (
                  <th scope="col" className="w-10 px-3 py-2">
                    <span className="sr-only">Choose</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={`${r.batch_id}-${r.sale_id}`}
                  onClick={canEdit ? () => setOpenSale(r.sale_id) : undefined}
                  className={`group border-b border-gray-100 ${
                    canEdit ? "cursor-pointer hover:bg-(--dc-accent-soft)/50" : ""
                  }`}
                >
                  <td className="sticky left-0 z-10 bg-white px-3 py-2 transition group-hover:bg-(--dc-accent-soft)">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATE_TONE[r.batch_state]}`}>
                      {r.batch_state}
                    </span>
                    {r.reclaim_reason && (
                      <p className="mt-0.5 text-xs text-purple-700">{r.reclaim_reason}</p>
                    )}
                  </td>
                  <td className="px-3 py-2 text-gray-900">
                    {/*
                      Grouping is a heading on the first row of each agent's
                      run rather than a separate rendering path. The log is
                      keyset-paginated, so a real group-by would have to page
                      whole agents rather than whole pages, and a supervisor
                      scanning for a name gets the same answer from a marked
                      boundary.
                    */}
                    {grouped && (
                      <span className="mb-0.5 block text-[11px] font-semibold uppercase tracking-wide text-(--dc-accent)">
                        {r.agent_name ?? "unassigned"}
                      </span>
                    )}
                    {r.agent_name ?? "-"}
                  </td>
                  <td className="px-3 py-2 text-gray-700">{r.partner_name}</td>
                  <td className="px-3 py-2 text-gray-500">{dateOf(r.assigned_at)}</td>
                  <td className="px-3 py-2 tabular-nums text-gray-500">{r.position}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {/*
                      The serial is the way out of this table into the whole
                      history of the stove it names. The row itself opens the
                      call record, so the click has to stop here rather than
                      doing both.
                    */}
                    <Link
                      href={`/data-center/stove/${encodeURIComponent(r.stove_serial_no)}`}
                      onClick={(e) => e.stopPropagation()}
                      title={`Everything about ${r.stove_serial_no}`}
                      className="text-(--dc-accent) underline decoration-(--dc-accent)/30 underline-offset-2 hover:decoration-(--dc-accent)"
                    >
                      {r.stove_serial_no}
                    </Link>
                  </td>
                  <td className={`px-3 py-2 text-xs font-medium ${OUTCOME_TONE[r.verification_outcome] ?? "text-gray-500"}`}>
                    {outcomeLabel(r.verification_outcome)}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-gray-700">{r.attempt_count ?? 0}</td>
                  <td className="px-3 py-2 text-gray-500">{whenOf(r.last_attempt_at)}</td>
                  <td className="px-3 py-2 text-gray-500">{r.last_attempt_by ?? "-"}</td>
                  {canEdit && (
                    <td className="px-3 py-2 text-right">
                      <QuickEdit
                        row={r}
                        outcomes={outcomes}
                        onDone={() => load(currentCursorRef)}
                      />
                    </td>
                  )}
                  {canEdit && (
                    <td className="px-3 py-2">
                      {/*
                        Only an open batch can be moved. A completed or
                        reclaimed one is history, and offering a tick that the
                        server would refuse is offering a dead end.
                      */}
                      {r.batch_state === "open" ? (
                        <input
                          type="checkbox"
                          checked={chosen.has(r.sale_id)}
                          aria-label={`Choose ${r.stove_serial_no} for reassignment`}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            e.stopPropagation();
                            setChosen((prev) => {
                              const next = new Set(prev);
                              if (next.has(r.sale_id)) next.delete(r.sale_id);
                              else next.add(r.sale_id);
                              return next;
                            });
                          }}
                          className="h-4 w-4 rounded border-gray-300 accent-(--dc-accent)"
                        />
                      ) : null}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Keyset paging. Forward on the cursor the server returns, backward on
          the cursors already seen, so neither direction reads a row it is not
          showing. There is no page count, because counting the rows behind a
          keyset cursor means scanning them. */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 px-4 py-2.5 text-sm">
        <p className="text-gray-600">
          {loading ? "Loading..." : `${plural(rows.length, "record")} on page ${page}`}
        </p>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-gray-600">
            Per page
            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              className="rounded-md border border-gray-300 px-1.5 py-1 text-xs text-gray-700 focus:border-(--dc-accent) focus:outline-none"
            >
              {PAGE_SIZES.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={goPrevious}
              disabled={history.length === 0 || loading}
              aria-label="Previous page"
              className="rounded-md border border-gray-300 p-1 text-gray-600 transition hover:border-(--dc-accent)/40 hover:text-(--dc-accent) disabled:opacity-40 disabled:hover:border-gray-300 disabled:hover:text-gray-600"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="px-1 text-xs tabular-nums text-gray-600">{page}</span>
            <button
              type="button"
              onClick={goNext}
              disabled={!more || loading}
              aria-label="Next page"
              className="rounded-md border border-gray-300 p-1 text-gray-600 transition hover:border-(--dc-accent)/40 hover:text-(--dc-accent) disabled:opacity-40 disabled:hover:border-gray-300 disabled:hover:text-gray-600"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {openSale && (
        <CallRecordEditor
          saleId={openSale}
          canEdit={canEdit}
          onClose={() => setOpenSale(null)}
          onSaved={() => load(currentCursorRef)}
        />
      )}
    </div>
  );
}
