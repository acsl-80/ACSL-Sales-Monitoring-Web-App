import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "@/compat/Link";
import { dataCenterAssign, DataCenterError } from "../../lib/client";
import { usePaged } from "../../lib/usePaged";
import Pagination from "../../components/Pagination";
import ExportButton from "../../components/ExportButton";
import CallRecordEditor from "./CallRecordEditor";
import { plural } from "../../lib/plural";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import ConfirmDialog from "../../components/ConfirmDialog";
import { Pause, Play } from "lucide-react";
import {
  Loader2,
  UserPlus,
  ChevronDown,
  ChevronRight,
  Undo2,
  RefreshCw,
  Users,
  PhoneOff,
  ExternalLink,
} from "lucide-react";

/**
 * Who is calling whom, and the two buttons that change it.
 *
 * The engine could already hand work out well; what nobody could do was see it
 * or overrule it. The assignment log listed batches, which answers "what
 * happened" and never "who is holding what right now", and there was no way to
 * say give this partner to Hanifa or take those forty back, he is on leave.
 *
 * So this is a console over the same tables the engine writes. A supervisor
 * picks an agent, picks a partner, picks a number, and assigns; assigning twice
 * from two partners is how one agent ends up with ten of each, which is what
 * was asked for and what a batch-per-partner design already produces. Nothing
 * here can put a record in two places at once, because that is a partial unique
 * index rather than a rule this file remembers to apply.
 */

const dateOf = (iso) => (iso ? new Date(iso).toLocaleDateString() : "-");
const whenOf = (iso) => (iso ? new Date(iso).toLocaleString() : "never");

const AGENT_COLUMNS = [
  { key: "full_name", label: "Agent" },
  { key: "email", label: "Email" },
  { key: "access_role", label: "Level" },
  { key: "is_enabled", label: "Taking work", get: (r) => (r.is_enabled ? "yes" : "no") },
  { key: "open_batches", label: "Open batches" },
  { key: "records_held", label: "Records held" },
  { key: "last_activity_at", label: "Last activity" },
];

const ITEM_COLUMNS = [
  { key: "partner_name", label: "Partner" },
  { key: "stove_serial_no", label: "Stove serial" },
  { key: "number_on_record", label: "Phone" },
  { key: "sales_date", label: "Sold" },
  { key: "position", label: "Position in batch" },
  { key: "attempt_count", label: "Calls made" },
  { key: "call_outcome", label: "Last outcome" },
  { key: "verification_outcome", label: "Verification" },
  { key: "assigned_at", label: "Assigned" },
  { key: "batch_id", label: "Batch" },
  { key: "sale_id", label: "Sale id" },
];

/* ------------------------------------------------------------ assign dialog */

/**
 * Pick a partner, pick how many, assign.
 *
 * The partner list is the pool: only partners with records still needing a
 * call, largest backlog first. Offering a partner with nothing left would be
 * offering a button that does nothing.
 */
function AssignDialog({ agent, pool, batchSize, onDone, onClose }) {
  const [orgId, setOrgId] = useState("");
  const [size, setSize] = useState(String(batchSize));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState([]);
  // Capacity is a refusal with a door in it: when the server says the agent
  // is at capacity, the supervisor may give a reason and hand out more.
  const [needsReason, setNeedsReason] = useState(false);
  const [reason, setReason] = useState("");

  const partner = pool.find((p) => p.organization_id === orgId);
  const cap = partner ? Math.min(Number(size) || 0, partner.callable) : Number(size) || 0;

  const assign = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await dataCenterAssign.assignManual(
        agent.agent_id,
        orgId,
        cap,
        needsReason && reason.trim() ? reason.trim() : null,
      );
      if (result.size === 0) {
        setError("That partner had nothing left by the time the batch was made.");
      } else {
        setDone((d) => [...d, { partner: partner?.partner_name, size: result.size }]);
        setOrgId("");
      }
      await onDone();
    } catch (err) {
      setError(err instanceof DataCenterError ? err.message : "Could not assign that batch.");
      if (err instanceof DataCenterError && err.code === "over_capacity") setNeedsReason(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="dc-root flex max-h-[90dvh] w-[90vw] max-w-[90vw] flex-col gap-0 overflow-hidden border-0 p-0 sm:max-w-[90vw]"
        data-area="call-centre"
      >
        <DialogHeader className="border-b border-gray-100 bg-(--dc-accent-soft)/40 px-5 py-4 text-left">
          <DialogTitle className="text-base">
            Assign work to {agent.full_name || agent.email}
          </DialogTitle>
          <DialogDescription>
            One partner at a time. Assign again to add a second partner: an agent
            holding ten of one and ten of another is two batches, never one mixed
            queue.
          </DialogDescription>
        </DialogHeader>

        <div className="mx-auto w-full max-w-4xl flex-1 overflow-y-auto p-5">
          {done.length > 0 && (
            <ul className="mb-4 space-y-1 rounded-lg border border-(--dc-accent)/25 bg-(--dc-accent-soft)/40 p-3 text-sm">
              {done.map((d, i) => (
                <li key={`${d.partner}-${i}`} className="text-(--dc-accent-strong)">
                  Assigned {plural(d.size, "record")} from {d.partner}
                </li>
              ))}
            </ul>
          )}

          {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
          {needsReason && (
            <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
              <label htmlFor="assign-override-reason" className="block text-xs font-semibold uppercase tracking-wide text-amber-900">
                Why hand out more than their capacity
              </label>
              <textarea
                id="assign-override-reason"
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Covering for a colleague, a partner that must finish today..."
                className="mt-1 w-full rounded-md border border-amber-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300"
              />
              <p className="mt-1 text-xs text-amber-900">The reason lands on the batch, so the log says why. Assign again to send it.</p>
            </div>
          )}

          {pool.length === 0 ? (
            <div className="rounded-lg border border-dashed border-(--dc-accent)/40 bg-(--dc-accent-soft)/20 px-4 py-8 text-center text-sm text-gray-600">
              Nothing is waiting to be called. Every record has either been
              concluded or is already someone else&apos;s work.
            </div>
          ) : (
            <>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-600">
                Partners with work waiting
              </p>
              <ul className="mb-4 max-h-72 divide-y divide-gray-100 overflow-y-auto rounded-lg border border-gray-200">
                {pool.map((p) => {
                  const selected = p.organization_id === orgId;
                  return (
                    <li key={p.organization_id}>
                      <button
                        type="button"
                        onClick={() => setOrgId(p.organization_id)}
                        aria-pressed={selected}
                        className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition ${
                          selected
                            ? "bg-(--dc-accent-soft) text-(--dc-accent-strong)"
                            : "hover:bg-(--dc-accent-soft)/40"
                        }`}
                      >
                        <span className="min-w-0 flex-1 truncate font-medium">
                          {p.partner_name}
                        </span>
                        <span className="shrink-0 text-xs text-gray-600">
                          oldest {dateOf(p.oldest)}
                        </span>
                        <span className="shrink-0 tabular-nums font-medium">
                          {plural(p.callable, "record")}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>

              <div className="flex flex-wrap items-end gap-3">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-600">
                    How many
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={500}
                    value={size}
                    onChange={(e) => setSize(e.target.value)}
                    className="w-28 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm tabular-nums focus:border-(--dc-accent) focus:outline-none"
                  />
                </label>
                <p className="pb-2 text-sm text-gray-600">
                  {partner
                    ? `${plural(cap, "record")} from ${partner.partner_name}`
                    : "Pick a partner above"}
                </p>
                <button
                  type="button"
                  disabled={busy || !orgId || cap < 1}
                  onClick={assign}
                  className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-(--dc-accent) px-4 py-2 text-sm font-medium text-white transition hover:bg-(--dc-accent-strong) disabled:opacity-40"
                >
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <UserPlus className="h-4 w-4" />
                  )}
                  Assign
                </button>
              </div>
            </>
          )}
        </div>

        <div className="border-t border-gray-100 px-5 py-3 text-right">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
          >
            Done
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------- agent detail */

/**
 * One agent, opened: their batches by partner, and the records in each.
 *
 * Three levels of the same tree rather than three screens. Which partner, then
 * which serials, then the record itself, because that is the order the question
 * is actually asked in.
 */
function AgentDetail({ agent, onChanged, onOpenRecord }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [openBatch, setOpenBatch] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await dataCenterAssign.agentDetail(agent.agent_id);
      setItems(r.items);
      setError(null);
    } catch (err) {
      setError(err instanceof DataCenterError ? err.message : "Could not load that agent.");
    }
  }, [agent.agent_id]);

  useEffect(() => {
    load();
  }, [load]);

  // Batches, in the order they were handed over. One pass rather than a group-by
  // helper: the list is what an agent holds, so it is tens of rows.
  const batches = useMemo(() => {
    const byId = new Map();
    for (const item of items ?? []) {
      if (!byId.has(item.batch_id)) {
        byId.set(item.batch_id, {
          batch_id: item.batch_id,
          partner_name: item.partner_name,
          assigned_at: item.assigned_at,
          last_activity_at: item.last_activity_at,
          items: [],
        });
      }
      byId.get(item.batch_id).items.push(item);
    }
    return [...byId.values()];
  }, [items]);

  const act = async () => {
    setBusy(true);
    try {
      if (confirm.kind === "batch") await dataCenterAssign.unassignBatch(confirm.batchId);
      else await dataCenterAssign.unassignItem(confirm.saleId);
      setConfirm(null);
      await load();
      await onChanged();
    } catch (err) {
      setError(err instanceof DataCenterError ? err.message : "Could not unassign that.");
    } finally {
      setBusy(false);
    }
  };

  if (error) return <p className="px-4 py-3 text-sm text-red-600">{error}</p>;
  if (items === null) {
    return (
      <p className="flex items-center gap-2 px-4 py-3 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading what they hold...
      </p>
    );
  }
  if (batches.length === 0) {
    return (
      <div className="m-4 rounded-lg border border-dashed border-(--dc-accent)/40 bg-(--dc-accent-soft)/20 px-4 py-6 text-center text-sm text-gray-600">
        Holding nothing right now.
      </div>
    );
  }

  return (
    <div className="space-y-2 p-4">
      <div className="flex justify-end">
        <ExportButton
          columns={ITEM_COLUMNS}
          rows={() => items}
          filename={`assigned-${(agent.full_name || agent.email || "agent").replace(/\W+/g, "-").toLowerCase()}.csv`}
          label="Export what they hold"
        />
      </div>

      {batches.map((batch) => {
        const open = openBatch === batch.batch_id;
        return (
          <div
            key={batch.batch_id}
            className="overflow-hidden rounded-lg border border-(--dc-accent)/20 bg-white"
          >
            <div className="flex flex-wrap items-center gap-2 bg-(--dc-accent-soft)/40 px-3 py-2">
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpenBatch(open ? null : batch.batch_id)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm font-medium text-(--dc-accent-strong)"
              >
                {open ? (
                  <ChevronDown className="h-4 w-4 shrink-0" />
                ) : (
                  <ChevronRight className="h-4 w-4 shrink-0" />
                )}
                <span className="truncate">{batch.partner_name}</span>
                <span className="shrink-0 text-xs font-normal text-gray-600">
                  {plural(batch.items.length, "record")} · assigned {dateOf(batch.assigned_at)}
                </span>
              </button>
              <button
                type="button"
                onClick={() =>
                  setConfirm({
                    kind: "batch",
                    batchId: batch.batch_id,
                    label: `${plural(batch.items.length, "record")} from ${batch.partner_name}`,
                  })
                }
                className="inline-flex shrink-0 items-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 transition hover:border-red-300 hover:bg-red-50 hover:text-red-700"
              >
                <Undo2 className="h-3.5 w-3.5" /> Unassign batch
              </button>
            </div>

            {open && (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[36rem] text-sm">
                  <thead>
                    <tr className="border-b-2 border-(--dc-accent)/25 text-left text-xs uppercase tracking-wide text-gray-600">
                      <th className="w-10 px-3 py-1.5 text-right font-semibold">#</th>
                      <th className="px-3 py-1.5 font-semibold">Stove serial</th>
                      <th className="px-3 py-1.5 font-semibold">Phone</th>
                      <th className="px-3 py-1.5 font-semibold">Sold</th>
                      <th className="px-3 py-1.5 text-right font-semibold">Calls</th>
                      <th className="w-24 px-3 py-1.5" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {batch.items.map((item) => (
                      <tr key={item.sale_id} className="hover:bg-(--dc-accent-soft)/40">
                        <td className="px-3 py-1.5 text-right tabular-nums text-gray-500">
                          {item.position}
                        </td>
                        <td className="px-3 py-1.5">
                          {/*
                            Two different destinations, so two controls rather
                            than one that guesses. The serial opens the call
                            record, which is what a supervisor looking at a
                            queue wants; the arrow beside it opens the whole
                            history, which is what they want when the record
                            does not explain itself.
                          */}
                          <button
                            type="button"
                            onClick={() => onOpenRecord(item.sale_id)}
                            className="font-medium text-(--dc-accent) underline-offset-2 hover:underline"
                          >
                            {item.stove_serial_no}
                          </button>
                          <Link
                            href={`/data-center/stove/${encodeURIComponent(item.stove_serial_no)}`}
                            aria-label={`Everything about ${item.stove_serial_no}`}
                            title={`Everything about ${item.stove_serial_no}`}
                            className="ml-1.5 inline-block align-middle text-gray-400 transition hover:text-(--dc-accent)"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </Link>
                        </td>
                        <td className="px-3 py-1.5 tabular-nums text-gray-700">
                          {item.number_on_record || "-"}
                        </td>
                        <td className="px-3 py-1.5 text-gray-700">{dateOf(item.sales_date)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">
                          {item.attempt_count ?? 0}
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          <button
                            type="button"
                            aria-label={`Unassign ${item.stove_serial_no}`}
                            onClick={() =>
                              setConfirm({
                                kind: "item",
                                saleId: item.sale_id,
                                label: `stove ${item.stove_serial_no}`,
                              })
                            }
                            className="rounded p-1 text-gray-500 transition hover:bg-red-50 hover:text-red-700"
                          >
                            <PhoneOff className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}

      <ConfirmDialog
        open={confirm !== null}
        title="Return this work to the pool?"
        description={
          <>
            {confirm?.label} goes back to being unassigned, and can be given to somebody
            else. Calls already logged against it stay where they are.
          </>
        }
        cancelLabel="Keep it assigned"
        actionLabel="Unassign"
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={act}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ console */

export default function AssignmentConsole({ canEdit }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [assigning, setAssigning] = useState(null);
  const [openSale, setOpenSale] = useState(null);

  const load = useCallback(async () => {
    try {
      setData(await dataCenterAssign.agents());
      setError(null);
    } catch (err) {
      setError(err instanceof DataCenterError ? err.message : "Could not load the agents.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const togglePause = async (agent) => {
    try {
      await dataCenterAssign.setAgentProfile(agent.agent_id, {
        isEnabled: !agent.is_enabled,
        note: agent.is_enabled ? "Paused from the console" : null,
      });
      await load();
    } catch (err) {
      setError(err instanceof DataCenterError ? err.message : "Could not change that.");
    }
  };

  const agents = data?.agents ?? [];
  const pool = data?.pool ?? [];
  const defaultCap = data?.defaultCap ?? 1;
  const paged = usePaged(agents, 10);
  const waiting = pool.reduce((n, p) => n + p.callable, 0);

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-gray-200 border-t-[3px] border-t-(--dc-accent) bg-white p-5 text-sm text-gray-500 shadow-sm">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading the agents...
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 border-t-[3px] border-t-(--dc-accent) bg-white shadow-sm">
      <div className="border-b border-gray-100 bg-(--dc-accent-soft)/30 p-5">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center gap-2">
              <Users className="h-4 w-4 text-(--dc-accent)" />
              <h2 className="text-sm font-semibold text-gray-900">Agents and their work</h2>
            </div>
            <p className="text-sm text-gray-600">
              {plural(waiting, "record")} waiting across{" "}
              {plural(pool.length, "partner")}. Open an agent to see what they hold;
              assign to give them a partner&apos;s records in a batch.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <ExportButton
              columns={AGENT_COLUMNS}
              rows={() => agents}
              filename="call-agents.csv"
              label="Export agents"
              disabled={agents.length === 0}
            />
            <button
              type="button"
              onClick={load}
              aria-label="Refresh"
              className="rounded-md border border-(--dc-accent)/30 p-1.5 text-(--dc-accent) transition hover:bg-(--dc-accent-soft)/60"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {error && <p className="px-5 pt-3 text-sm text-red-600">{error}</p>}

      {agents.length === 0 ? (
        <div className="m-5 rounded-lg border border-dashed border-(--dc-accent)/40 bg-(--dc-accent-soft)/20 px-4 py-8 text-center text-sm text-gray-600">
          Nobody has been made a call agent yet. Grant someone the call agent
          level in Settings and they will appear here.
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[42rem] text-sm">
              <thead>
                <tr className="bg-(--dc-accent-soft) text-left text-xs uppercase tracking-wide text-(--dc-accent-strong)">
                  <th className="w-10 px-3 py-2" />
                  <th className="px-3 py-2 font-semibold">Agent</th>
                  <th className="px-3 py-2 font-semibold">Level</th>
                  <th className="px-3 py-2 text-right font-semibold">Batches</th>
                  <th className="px-3 py-2 text-right font-semibold">Records held</th>
                  <th className="px-3 py-2 font-semibold">Last activity</th>
                  {canEdit && <th className="w-28 px-3 py-2" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {paged.slice.map((agent) => (
                  // A Fragment rather than <>, because the key belongs on the
                  // outermost element the map returns and shorthand cannot
                  // carry one. Two rows per agent: the agent, and what they
                  // hold when it is open.
                  <Fragment key={agent.agent_id}>
                    <tr className={agent.is_enabled ? "" : "bg-gray-50 text-gray-500"}>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          aria-expanded={expanded === agent.agent_id}
                          aria-label={`What ${agent.full_name || agent.email} is holding`}
                          onClick={() =>
                            setExpanded(expanded === agent.agent_id ? null : agent.agent_id)
                          }
                          className="rounded p-1 text-gray-500 transition hover:bg-(--dc-accent-soft) hover:text-(--dc-accent)"
                        >
                          {expanded === agent.agent_id ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </button>
                      </td>
                      <td className="px-3 py-2">
                        <span className="block font-medium text-gray-900">
                          {agent.full_name || agent.email}
                        </span>
                        <span className="block text-xs text-gray-500">{agent.email}</span>
                      </td>
                      <td className="px-3 py-2 text-gray-700">
                        {agent.access_role === "call_agent" ? "Call agent" : "Editor"}
                        {!agent.is_enabled && (
                          <span className="block text-xs text-amber-700">Not taking work</span>
                        )}
                      </td>
                      <td
                        className={`px-3 py-2 text-right tabular-nums ${
                          agent.open_batches > (agent.max_open_batches ?? defaultCap)
                            ? "font-semibold text-red-700"
                            : "text-gray-700"
                        }`}
                        title={agent.open_batches > (agent.max_open_batches ?? defaultCap) ? "Over capacity: reclaim or reassign" : undefined}
                      >
                        {agent.open_batches} of {agent.max_open_batches ?? defaultCap}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium text-gray-900">
                        {agent.records_held}
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-600">
                        {whenOf(agent.last_activity_at)}
                      </td>
                      {canEdit && (
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            onClick={() => togglePause(agent)}
                            aria-label={`${agent.is_enabled ? "Pause" : "Resume"} ${agent.full_name || agent.email}`}
                            className="mr-1.5 inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50"
                          >
                            {agent.is_enabled ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                            {agent.is_enabled ? "Pause" : "Resume"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setAssigning(agent)}
                            className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-(--dc-accent) px-2.5 py-1.5 text-xs font-medium text-white transition hover:bg-(--dc-accent-strong)"
                          >
                            <UserPlus className="h-3.5 w-3.5" /> Assign
                          </button>
                        </td>
                      )}
                    </tr>
                    {expanded === agent.agent_id && (
                      <tr>
                        <td colSpan={canEdit ? 7 : 6} className="bg-(--dc-surface-muted) p-0">
                          <AgentDetail
                            agent={agent}
                            onChanged={load}
                            onOpenRecord={setOpenSale}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={paged.page}
            pageSize={paged.pageSize}
            total={paged.total}
            onPage={paged.setPage}
            onPageSize={paged.setPageSize}
            noun="agent"
          />
        </>
      )}

      {assigning && (
        <AssignDialog
          agent={assigning}
          pool={pool}
          batchSize={data?.batchSize ?? 20}
          onDone={load}
          onClose={() => setAssigning(null)}
        />
      )}

      {openSale && (
        <CallRecordEditor
          saleId={openSale}
          canEdit={false}
          onClose={() => setOpenSale(null)}
          onSaved={load}
        />
      )}
    </div>
  );
}
