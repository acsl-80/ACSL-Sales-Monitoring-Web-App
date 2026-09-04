import { Fragment, useState } from "react";
import { dataCenterAssign, DataCenterError } from "../../../lib/client";
import { usePaged } from "../../../lib/usePaged";
import Pagination from "../../../components/Pagination";
import ConfirmDialog from "../../../components/ConfirmDialog";
import CallRecordEditor from "../CallRecordEditor";
import AgentDetail from "./AgentDetail";
import AssignDialog from "../pool/AssignDialog";
import { plural } from "../../../lib/plural";
import { whenOf } from "../../../lib/when";
import ExportButton from "../../../components/ExportButton";
import {
  ChevronDown, ChevronRight, Loader2, Pause, Play, RotateCcw, UserPlus,
} from "lucide-react";

/**
 * The agents: who is taking work, what each holds against their capacity,
 * what they did today, and where they are right now. The levers that hand
 * work out (Run the engine, Reclaim quiet batches) live here, beside the
 * people they affect, and no longer in the log.
 *
 * Presence is derived, never declared: Working when a save landed within
 * `presence.working_within_minutes`, Away when nothing landed for
 * `presence.away_after_minutes`, Paused when not taking work, Available in
 * between and under capacity. "On record" is the last draft's stove, said as
 * a last save rather than a live cursor, because drafts are deleted on save
 * and the autosave is the only heartbeat there is.
 */

const PRESENCE = {
  working: { label: "Working", dot: "bg-emerald-600", text: "text-emerald-800" },
  available: { label: "Available", dot: "bg-(--dc-accent)", text: "text-(--dc-accent-strong)" },
  at_capacity: { label: "At capacity", dot: "bg-amber-500", text: "text-amber-800" },
  away: { label: "Away", dot: "bg-gray-400", text: "text-gray-600" },
  paused: { label: "Paused", dot: "bg-amber-600", text: "text-amber-900" },
};

const AGENT_COLUMNS = [
  { key: "full_name", label: "Agent" },
  { key: "email", label: "Email" },
  { key: "access_role", label: "Level" },
  { key: "presence", label: "State" },
  { key: "is_enabled", label: "Taking work", get: (r) => (r.is_enabled ? "yes" : "no") },
  { key: "open_batches", label: "Open batches" },
  { key: "max_open_batches", label: "Capacity" },
  { key: "records_held", label: "Records held" },
  { key: "attempts_today", label: "Done today" },
  { key: "last_seen_at", label: "Last save" },
  { key: "current_serial", label: "On record" },
];

function Presence({ state }) {
  const p = PRESENCE[state] ?? PRESENCE.away;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${p.text}`} data-presence={state}>
      <span className={`h-2 w-2 rounded-full ${p.dot}`} aria-hidden />
      {p.label}
    </span>
  );
}

export default function AgentsPanel({ data, canManage, reload }) {
  const [expanded, setExpanded] = useState(null);
  const [assigning, setAssigning] = useState(null);
  const [openSale, setOpenSale] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const agents = data?.agents ?? [];
  const defaultCap = data?.defaultCap ?? 1;
  const ceiling = data?.capacityCeiling ?? 10;
  const paged = usePaged(agents, 10);
  const taking = agents.filter((a) => a.is_enabled).length;

  const act = async (fn, failed) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await reload?.();
    } catch (err) {
      setError(err instanceof DataCenterError ? err.message : failed);
    } finally {
      setBusy(false);
    }
  };

  const runEngine = () =>
    act(async () => {
      const out = await dataCenterAssign.run();
      setNotice(
        `${plural(out.batches.length, "batch", "batches")} assigned` +
          (out.reclaimed ? `, ${out.reclaimed} reclaimed first` : "") +
          (out.batches.length === 0 && !out.reclaimed
            ? ". Nothing to hand out: agents are at capacity or the pool is empty."
            : "."),
      );
    }, "The engine could not run.");

  const runReclaim = () =>
    act(async () => {
      const out = await dataCenterAssign.reclaim();
      setNotice(
        out.reclaimed
          ? `${plural(out.reclaimed, "quiet batch", "quiet batches")} reclaimed. Their records are back in the pool.`
          : "Nothing to reclaim: every open batch has recent activity.",
      );
    }, "Reclaim failed.");

  const togglePause = (agent) =>
    act(() => dataCenterAssign.setAgentProfile(agent.agent_id, { isEnabled: !agent.is_enabled }), "Could not change that.");

  const setCapacity = (agent, value) =>
    act(() => dataCenterAssign.setAgentProfile(agent.agent_id, { maxOpenBatches: Number(value) }), "Could not change the capacity.");

  if (!data) {
    return (
      <div id="agents-panel" className="flex items-center gap-2 rounded-xl border border-gray-200 border-t-[3px] border-t-(--dc-accent) bg-white p-5 text-sm text-gray-500 shadow-sm">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading the agents...
      </div>
    );
  }

  return (
    <section id="agents-panel" className="rounded-xl border border-gray-200 border-t-[3px] border-t-(--dc-accent) bg-white shadow-sm">
      <ConfirmDialog
        open={confirm !== null}
        title={confirm === "run" ? "Run the engine now?" : "Reclaim quiet batches?"}
        description={
          confirm === "run"
            ? "Every agent with room takes a batch from the pool, in the configured order. Their lists change the moment it runs."
            : "Every open batch with no activity for the stale age goes back to the pool, and its agent loses it. Calls already logged stay on the records."
        }
        cancelLabel="Not now"
        actionLabel={confirm === "run" ? "Run" : "Reclaim"}
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const which = confirm;
          setConfirm(null);
          if (which === "run") runEngine();
          else if (which === "reclaim") runReclaim();
        }}
      />
      <header className="flex flex-wrap items-center gap-2 border-b border-gray-100 bg-(--dc-accent-soft)/30 px-4 py-2.5">
        <h2 className="text-sm font-semibold text-gray-900">Agents and their work</h2>
        <span className="text-xs text-gray-600">
          {plural(taking, "agent")} taking work{agents.length - taking > 0 ? `, ${agents.length - taking} paused` : ""}
        </span>
        {canManage && (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirm("run")}
              className="inline-flex items-center gap-1.5 rounded-md bg-(--dc-accent) px-2.5 py-1.5 text-xs font-medium text-white hover:bg-(--dc-accent-strong) disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              Assign now
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirm("reclaim")}
              className="inline-flex items-center gap-1.5 rounded-md border border-(--dc-accent)/30 px-2.5 py-1.5 text-xs font-medium text-(--dc-accent) transition hover:bg-(--dc-accent-soft)/60 disabled:opacity-50"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Reclaim quiet batches
            </button>
          </div>
        )}
        <ExportButton
          columns={AGENT_COLUMNS}
          rows={() => agents}
          filename="call-agents.csv"
          label="Export agents"
          disabled={agents.length === 0}
        />
      </header>
      {notice && <p className="mx-4 mt-3 rounded-md bg-(--dc-accent-soft)/60 px-3 py-2 text-xs text-(--dc-accent-strong)">{notice}</p>}
      {error && <p className="mx-4 mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[52rem] text-sm">
          <thead>
            <tr className="bg-(--dc-accent-soft) text-left text-xs uppercase tracking-wide text-(--dc-accent-strong)">
              <th className="w-10 px-3 py-2" />
              <th className="px-3 py-2 font-semibold">Agent</th>
              <th className="px-3 py-2 font-semibold">State</th>
              <th className="px-3 py-2 text-right font-semibold">Open batches</th>
              <th className="px-3 py-2 text-right font-semibold">Held</th>
              <th className="px-3 py-2 text-right font-semibold">Done today</th>
              <th className="px-3 py-2 font-semibold">Last save</th>
              <th className="px-3 py-2 font-semibold">On record</th>
              {canManage && <th className="w-44 px-3 py-2" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {paged.slice.map((agent) => {
              const cap = agent.max_open_batches ?? defaultCap;
              const over = agent.open_batches > cap;
              return (
                <Fragment key={agent.agent_id}>
                  <tr className={agent.is_enabled ? "" : "bg-gray-50 text-gray-500"} data-agent-row={agent.agent_id}>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        aria-expanded={expanded === agent.agent_id}
                        aria-label={`What ${agent.full_name || agent.email} is holding`}
                        onClick={() => setExpanded(expanded === agent.agent_id ? null : agent.agent_id)}
                        className="rounded p-1 text-gray-500 transition hover:bg-(--dc-accent-soft) hover:text-(--dc-accent)"
                      >
                        {expanded === agent.agent_id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </button>
                    </td>
                    <td className="px-3 py-2">
                      <span className="block font-medium text-gray-900">{agent.full_name || agent.email}</span>
                      <span className="block text-xs text-gray-500">
                        {agent.email}
                        {agent.email ? " · " : ""}
                        {agent.access_role === "call_agent" ? "call agent" : "editor"}
                      </span>
                    </td>
                    <td className="px-3 py-2"><Presence state={agent.presence} /></td>
                    <td className={`px-3 py-2 text-right tabular-nums ${over ? "font-semibold text-red-700" : "text-gray-700"}`} title={over ? "Over capacity: reclaim or reassign" : undefined}>
                      {agent.open_batches} of{" "}
                      {canManage ? (
                        <select
                          aria-label={`Capacity for ${agent.full_name || agent.email}`}
                          value={cap}
                          onChange={(e) => setCapacity(agent, e.target.value)}
                          className="rounded border border-gray-300 bg-white px-1 py-0.5 text-xs text-gray-800"
                        >
                          {Array.from({ length: ceiling }, (_, i) => i + 1).map((n) => (
                            <option key={n} value={n}>{n}</option>
                          ))}
                        </select>
                      ) : cap}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium text-gray-900">{agent.records_held}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-700">{agent.attempts_today ?? 0}</td>
                    <td className="px-3 py-2 text-xs text-gray-600">{whenOf(agent.last_seen_at)}</td>
                    <td className="px-3 py-2 text-xs text-gray-600">
                      {agent.current_serial ? (
                        <span className="font-mono">{agent.current_serial}</span>
                      ) : (
                        <span className="text-gray-400">nothing open</span>
                      )}
                    </td>
                    {canManage && (
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
                          <UserPlus className="h-3.5 w-3.5" /> Hand out
                        </button>
                      </td>
                    )}
                  </tr>
                  {expanded === agent.agent_id && (
                    <tr>
                      <td colSpan={canManage ? 9 : 8} className="bg-(--dc-surface-muted) p-0">
                        <AgentDetail agent={agent} onChanged={reload} onOpenRecord={setOpenSale} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pagination page={paged.page} pageSize={paged.pageSize} total={paged.total} onPage={paged.setPage} onPageSize={paged.setPageSize} noun="agent" />
      <p className="flex flex-wrap gap-x-4 gap-y-1 border-t border-gray-100 bg-gray-50 px-4 py-2 text-xs text-gray-600">
        <span>Working: saved within {data.presence?.workingWithinMinutes ?? 10} min</span>
        <span>Available: under capacity, nothing recent</span>
        <span>At capacity: nothing recent, no room for a batch</span>
        <span>Away: nothing for {data.presence?.awayAfterMinutes ?? 60} min</span>
        <span>Paused: not taking work</span>
        <span className="ml-auto">Windows and capacity live in Settings</span>
      </p>

      {assigning && (
        <AssignDialog
          agent={assigning}
          pool={data.pool ?? []}
          batchSize={data.batchSize ?? 20}
          priority={data.priority}
          onDone={reload}
          onClose={() => setAssigning(null)}
        />
      )}
      {openSale && <CallRecordEditor saleId={openSale} canEdit onClose={() => setOpenSale(null)} />}
    </section>
  );
}
