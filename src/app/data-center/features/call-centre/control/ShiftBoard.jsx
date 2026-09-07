import { Fragment, useMemo, useState } from "react";
import Link from "@/compat/Link";
import {
  ChevronDown, ChevronRight, Loader2, Pause, Play, RotateCcw, UserPlus,
} from "lucide-react";
import { dataCenterAssign, DataCenterError } from "../../../lib/client";
import ConfirmDialog from "../../../components/ConfirmDialog";
import ExportButton from "../../../components/ExportButton";
import CallRecordEditor from "../CallRecordEditor";
import AgentDetail from "../agents/AgentDetail";
import AssignDialog from "../pool/AssignDialog";
import Track from "./Track";
import { plural } from "../../../lib/plural";
import { whenOf } from "../../../lib/when";

/**
 * The shift board (Phase 26, C2): one row per agent, the chosen day on the
 * axis. Every call sits on the hour it was logged, in its outcome family; a
 * flag where a batch was handed to them or taken back; called, verified and
 * to-call at the right, with the day's pace against the configured target.
 *
 * Replaces the agents panel. Keeps its levers (Assign now, Reclaim quiet
 * batches, each behind a confirm), its export, the capacity select, Pause
 * and Resume, the expand-to-detail row, and its ids and data attributes,
 * because the specs and the figure links point at them. A call is counted
 * against the login that logged it (D35).
 */
const PRESENCE = {
  working: { text: "Working", cls: "bg-(--dc-sev-ok-soft) text-(--dc-sev-ok)" },
  available: { text: "Available", cls: "bg-gray-100 text-gray-700" },
  at_capacity: { text: "At capacity", cls: "bg-(--dc-brief-place-soft) text-(--dc-brief-place)" },
  away: { text: "Away", cls: "bg-(--dc-sev-warning-soft) text-(--dc-sev-warning)" },
  paused: { text: "Paused", cls: "bg-(--dc-brief-history-soft) text-(--dc-brief-history)" },
};

const COLUMNS = [
  { key: "full_name", label: "Agent" },
  { key: "email", label: "Email" },
  { key: "access_role", label: "Level" },
  { key: "presence", label: "State" },
  { key: "is_enabled", label: "Taking work", get: (r) => (r.is_enabled ? "yes" : "no") },
  { key: "called", label: "Called" },
  { key: "verified", label: "Verified" },
  { key: "to_call", label: "To call" },
  { key: "open_batches", label: "Open batches" },
  { key: "max_open_batches", label: "Capacity" },
  { key: "first_call", label: "First call", get: (r) => r.marks?.[0]?.at ?? "" },
  { key: "last_call", label: "Last call", get: (r) => r.marks?.[r.marks.length - 1]?.at ?? "" },
  { key: "last_seen_at", label: "Last save" },
  { key: "current_serial", label: "On record" },
  { key: "agent_id", label: "Agent id" },
];

function Presence({ state }) {
  const p = PRESENCE[state] ?? PRESENCE.available;
  return (
    <span data-presence={state} className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${p.cls}`}>
      {p.text}
    </span>
  );
}

const FILTERS = [
  { key: "all", label: "All" },
  { key: "working", label: "Working" },
  { key: "available", label: "Available" },
  { key: "away", label: "Away" },
  { key: "paused", label: "Paused" },
];

export default function ShiftBoard({ board, agentsMeta, canManage, reload, dayLabel }) {
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("called");
  const [expanded, setExpanded] = useState(null);
  const [assigning, setAssigning] = useState(null);
  const [openSale, setOpenSale] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const agents = board?.agents ?? [];
  const defaultCap = agentsMeta?.defaultCap ?? 1;
  const ceiling = agentsMeta?.capacityCeiling ?? 10;
  const target = board?.dailyTarget ?? 0;
  const isToday = board?.day === board?.today && board?.range !== "week";
  const staleDays = board?.staleAfterDays ?? 3;

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = agents.filter((a) => {
      if (filter !== "all") {
        const state = a.presence === "at_capacity" ? "available" : a.presence;
        if (state !== filter) return false;
      }
      if (needle && !`${a.full_name ?? ""} ${a.email ?? ""}`.toLowerCase().includes(needle)) return false;
      return true;
    });
    const key = { called: (a) => a.called, verified: (a) => a.verified, to_call: (a) => a.to_call, name: (a) => (a.full_name ?? a.email ?? "") }[sort];
    return [...list].sort((a, b) => {
      const x = key(a);
      const y = key(b);
      if (typeof x === "string") return x.localeCompare(y);
      return y - x || (a.full_name ?? "").localeCompare(b.full_name ?? "");
    });
  }, [agents, filter, q, sort]);

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

  const taking = agents.filter((a) => a.is_enabled).length;
  const idleMinutes = (a) => (a.last_seen_at ? Math.round((Date.now() - new Date(a.last_seen_at).getTime()) / 60000) : null);
  const sortHead = (key, label, align = "right") => (
    <th className={`px-3 py-2 font-semibold ${align === "right" ? "text-right" : ""}`} aria-sort={sort === key ? "descending" : "none"}>
      <button type="button" onClick={() => setSort(key)} className={`inline-flex items-center gap-1 ${sort === key ? "underline decoration-(--dc-accent) decoration-2 underline-offset-4" : ""}`}>
        {label}
      </button>
    </th>
  );

  if (!board) {
    return (
      <div id="agents-panel" className="flex items-center gap-2 rounded-xl border border-gray-200 border-t-[3px] border-t-(--dc-accent) bg-white p-5 text-sm text-gray-600">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading the board...
      </div>
    );
  }

  return (
    <section id="agents-panel" aria-labelledby="cc-agents" className="rounded-xl border border-gray-200 border-t-[3px] border-t-(--dc-accent) bg-white shadow-sm">
      <ConfirmDialog
        open={confirm !== null}
        title={confirm === "run" ? "Run the engine now?" : "Reclaim quiet batches?"}
        description={
          confirm === "run"
            ? "Every agent with room takes a batch from the pool, in the configured order. Their lists change the moment it runs."
            : `Every open batch with no activity for ${plural(staleDays, "day")} goes back to the pool, and its agent loses it. Calls already logged stay on the records.`
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
        <h2 id="cc-agents" className="text-sm font-semibold text-gray-900">Agents and their work</h2>
        <span className="text-xs text-gray-600">
          {dayLabel} · {plural(taking, "agent")} taking work{agents.length - taking > 0 ? `, ${agents.length - taking} paused` : ""}
          {target > 0 ? ` · target ${target} calls a day` : ""}
        </span>
        {canManage && (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setAssigning("any")}
              className="inline-flex items-center gap-1.5 rounded-md border border-(--dc-primary-mid) px-2.5 py-1.5 text-xs font-semibold text-(--dc-primary-strong) transition hover:bg-(--dc-primary-soft)"
            >
              <UserPlus className="h-3.5 w-3.5" /> Hand out calls
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirm("run")}
              className="inline-flex items-center gap-1.5 rounded-md bg-(--dc-fig-sold) px-2.5 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:brightness-110 disabled:opacity-60"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              Assign now
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirm("reclaim")}
              className="inline-flex items-center gap-1.5 rounded-md border border-(--dc-brief-history) px-2.5 py-1.5 text-xs font-semibold text-(--dc-brief-history) transition hover:bg-(--dc-brief-history-soft) disabled:opacity-60"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Reclaim quiet batches
            </button>
          </div>
        )}
        <ExportButton columns={COLUMNS} rows={() => rows} filename={`shift-board-${board.day}.csv`} label="Export agents" disabled={rows.length === 0} />
      </header>
      <div className="flex flex-wrap items-center gap-1.5 border-b border-gray-100 px-4 py-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            aria-pressed={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
              filter === f.key ? "border-(--dc-accent) bg-(--dc-accent) text-white" : "border-gray-300 bg-white text-gray-700"
            }`}
          >
            {f.label}
          </button>
        ))}
        <label htmlFor="cc-agent-search" className="sr-only">Find an agent</label>
        <input
          id="cc-agent-search"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find an agent"
          className="ml-auto w-44 rounded-md border border-gray-300 px-2 py-1 text-xs focus:border-(--dc-accent) focus:outline-none"
        />
      </div>
      {notice && <p className="mx-4 mt-3 rounded-md bg-(--dc-accent-soft)/60 px-3 py-2 text-xs text-(--dc-accent-strong)">{notice}</p>}
      {error && <p className="mx-4 mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[60rem] text-sm">
          <thead>
            <tr className="bg-(--dc-accent-soft) text-left text-xs uppercase tracking-wide text-(--dc-accent-strong)">
              <th className="w-10 px-3 py-2" />
              {sortHead("name", "Agent", "left")}
              <th className="px-3 py-2 font-semibold">State</th>
              <th className="px-3 py-2 font-semibold">{board.range === "week" ? "The week, by day" : "The day, by hour"}</th>
              {sortHead("called", "Called")}
              {sortHead("verified", "Verified")}
              {sortHead("to_call", "To call")}
              <th className="px-3 py-2 text-right font-semibold">Open batches</th>
              {canManage && <th className="w-44 px-3 py-2" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.length === 0 && (
              <tr><td colSpan={canManage ? 9 : 8} className="px-4 py-6 text-center text-sm text-gray-500">No agent matches.</td></tr>
            )}
            {rows.map((agent) => {
              const cap = agent.max_open_batches ?? defaultCap;
              const over = agent.open_batches > cap;
              const idle = idleMinutes(agent);
              const idleFlag = agent.is_enabled && agent.to_call > 0 && idle != null && idle >= 30 && agent.presence !== "working";
              const pace = target > 0 && isToday ? paceOf(agent.called, target, board.tz) : null;
              const primary = !agent.is_enabled
                ? { text: "Resume", cls: "border-(--dc-brief-who) text-(--dc-brief-who) hover:bg-(--dc-brief-who-soft)", onClick: () => togglePause(agent), icon: Play }
                : agent.to_call === 0
                ? { text: "Hand out", cls: "bg-(--dc-fig-sold) text-white border-transparent hover:brightness-110", onClick: () => setAssigning(agent), icon: UserPlus }
                : { text: "Open", cls: "border-(--dc-brief-stove) text-(--dc-brief-stove) hover:bg-(--dc-brief-stove-soft)", href: `/data-center/call-centre/agents/${agent.agent_id}`, icon: null };
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
                        {agent.current_serial ? <> · on <span className="font-mono">{agent.current_serial}</span></> : agent.last_seen_at ? ` · last save ${whenOf(agent.last_seen_at)}` : ""}
                        {idleFlag && <span className="ml-1 rounded-full bg-(--dc-sev-warning-soft) px-1.5 text-[10px] font-semibold text-(--dc-sev-warning)">idle {idle} min</span>}
                      </span>
                    </td>
                    <td className="px-3 py-2"><Presence state={agent.presence} /></td>
                    <td className="px-3 py-2">
                      {board.range === "week" ? (
                        <WeekCells days={agent.days ?? []} />
                      ) : (
                        <Track
                          marks={agent.marks}
                          flags={agent.flags}
                          tz={board.tz}
                          isToday={isToday}
                          emptyText={!agent.is_enabled ? "paused" : agent.to_call > 0 ? `no calls yet · ${agent.to_call} in hand` : "no calls"}
                        />
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <span className="font-medium text-gray-900">{agent.called}</span>
                      {pace && <span className={`block text-[11px] ${pace.behind ? "text-(--dc-sev-warning)" : "text-gray-500"}`}>{pace.text}</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-(--dc-brief-who)">{agent.verified}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <span className={`inline-flex items-center justify-end gap-1.5 ${over ? "font-semibold text-(--dc-sev-critical)" : "text-gray-900"}`}>
                        <i aria-hidden className={`inline-block h-2.5 rounded-sm ${over ? "bg-(--dc-fig-crit)" : agent.to_call > 0 ? "bg-(--dc-fig-sold)" : "bg-gray-200"}`} style={{ width: `${Math.min(64, 6 + agent.to_call)}px` }} />
                        {agent.to_call}
                      </span>
                    </td>
                    <td className={`px-3 py-2 text-right tabular-nums ${over ? "font-semibold text-(--dc-sev-critical)" : "text-gray-700"}`} title={over ? "Over capacity: reclaim or reassign" : undefined}>
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
                    {canManage && (
                      <td className="px-3 py-2 text-right">
                        {agent.is_enabled && (
                          <button
                            type="button"
                            onClick={() => togglePause(agent)}
                            aria-label={`Pause ${agent.full_name || agent.email}`}
                            className="mr-1.5 inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 transition hover:border-(--dc-brief-history) hover:text-(--dc-brief-history)"
                          >
                            <Pause className="h-3.5 w-3.5" /> Pause
                          </button>
                        )}
                        {primary.href ? (
                          <Link
                            href={primary.href}
                            aria-label={`${primary.text} ${agent.full_name || agent.email}`}
                            className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-2.5 py-1 text-xs font-semibold transition ${primary.cls}`}
                          >
                            {primary.text}
                          </Link>
                        ) : (
                          <button
                            type="button"
                            onClick={primary.onClick}
                            aria-label={`${primary.text} ${agent.full_name || agent.email}`}
                            className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-2.5 py-1 text-xs font-semibold transition ${primary.cls}`}
                          >
                            {primary.icon ? <primary.icon className="h-3.5 w-3.5" /> : null}
                            {primary.text}
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                  {expanded === agent.agent_id && (
                    <tr>
                      <td colSpan={canManage ? 9 : 8} className="bg-(--dc-surface-muted) p-0">
                        <AgentDetail agent={{ ...agent, records_held: agent.to_call }} agents={agentsMeta?.agents ?? []} onChanged={reload} onOpenRecord={setOpenSale} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="flex flex-wrap gap-x-4 gap-y-1 border-t border-gray-100 bg-gray-50 px-4 py-2 text-xs text-gray-600">
        <span className="inline-flex items-center gap-1"><i className="inline-block h-2.5 w-2 rounded-sm bg-(--dc-brief-who)" /> answered</span>
        <span className="inline-flex items-center gap-1"><i className="inline-block h-2.5 w-2 rounded-sm bg-(--dc-brief-place)" /> callback asked</span>
        <span className="inline-flex items-center gap-1"><i className="inline-block h-2.5 w-2 rounded-sm bg-(--dc-sev-critical)" /> not reached</span>
        <span className="inline-flex items-center gap-1"><i className="inline-block h-0 w-0 border-x-[5px] border-t-[8px] border-x-transparent border-t-(--dc-primary-mid)" /> handed out</span>
        <span className="inline-flex items-center gap-1"><i className="inline-block h-0 w-0 border-x-[5px] border-t-[8px] border-x-transparent border-t-(--dc-brief-history)" /> reclaimed</span>
        <span>Working: saved within {agentsMeta?.presence?.workingWithinMinutes ?? 10} min · Away: nothing for {agentsMeta?.presence?.awayAfterMinutes ?? 60} min</span>
        <span className="ml-auto">Windows, capacity and the daily target live in Settings</span>
      </p>
      {assigning && (
        <AssignDialog
          agent={assigning === "any" ? null : assigning}
          agents={agentsMeta?.agents ?? []}
          pool={agentsMeta?.pool ?? []}
          batchSize={agentsMeta?.batchSize ?? 20}
          priority={agentsMeta?.priority}
          onDone={reload}
          onClose={() => setAssigning(null)}
        />
      )}
      {openSale && (
        <CallRecordEditor saleId={openSale} canEdit={canManage} onClose={() => setOpenSale(null)} onSaved={reload} />
      )}
    </section>
  );
}

/** The week view: seven cells, called and verified per day. */
function WeekCells({ days }) {
  return (
    <div className="grid grid-cols-7 gap-1" data-week>
      {days.map((d) => (
        <div key={d.date} className="rounded-md border border-gray-200 bg-(--dc-surface-muted) px-1 py-1 text-center" title={d.date}>
          <span className="block text-[10px] text-gray-500">{new Date(`${d.date}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" })}</span>
          <span className="block text-sm font-semibold tabular-nums text-gray-900">{d.called}</span>
          <span className="block text-[10px] tabular-nums text-(--dc-brief-who)">{d.verified} ok</span>
        </div>
      ))}
    </div>
  );
}

/** "12 of 30, on pace" against the configured target, for today only. */
function paceOf(called, target, tz) {
  const parts = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: tz }).formatToParts(new Date());
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 12);
  const dayFraction = Math.min(1, Math.max(0.05, (hour - 8) / 10));
  const expected = Math.round(target * dayFraction);
  const behind = called < expected && called < target;
  return { text: `of ${target}${behind ? ", behind pace" : called >= target ? ", target met" : ", on pace"}`, behind };
}
