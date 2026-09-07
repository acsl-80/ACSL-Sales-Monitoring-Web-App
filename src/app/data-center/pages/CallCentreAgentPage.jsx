import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import Link from "@/compat/Link";
import { ArrowLeft, Loader2, Pause, Play, UserPlus } from "lucide-react";
import DataCentreShell from "../components/DataCentreShell";
import ExportButton from "../components/ExportButton";
import AgentDetail from "../features/call-centre/agents/AgentDetail";
import AssignDialog from "../features/call-centre/pool/AssignDialog";
import CallRecordEditor from "../features/call-centre/CallRecordEditor";
import DayChips from "../features/call-centre/control/DayChips";
import Track from "../features/call-centre/control/Track";
import { OUTCOME_TONE, clockOf } from "../features/call-centre/control/HappenedToday";
import { dataCenterAssign, DataCenterError } from "../lib/client";
import { usePolling } from "../lib/usePolling";
import { useFeature } from "../lib/access";
import { DATA_CENTER_FEATURES } from "../lib/features";
import { plural } from "../lib/plural";
import { whenOf } from "../lib/when";

/**
 * /data-center/call-centre/agents/:agentId (Phase 26, C3)
 *
 * One person's board. Their track for the chosen day with the three figures,
 * then two tabs: To call, the records in their hands in calling order with
 * Reassign and Release per row (the agent detail that already exists), and
 * Called, what they concluded on the chosen day with the outcome and a link
 * to each record. The header carries state, capacity, Pause or Resume, and
 * Hand out more, which opens the dialog with this agent filled in.
 *
 * Reads `agent_day`, which an agent may read for themselves and a manager for
 * anyone; the server decides.
 */
const PRESENCE = {
  working: { text: "Working", cls: "bg-(--dc-sev-ok-soft) text-(--dc-sev-ok)" },
  available: { text: "Available", cls: "bg-gray-100 text-gray-700" },
  at_capacity: { text: "At capacity", cls: "bg-(--dc-brief-place-soft) text-(--dc-brief-place)" },
  away: { text: "Away", cls: "bg-(--dc-sev-warning-soft) text-(--dc-sev-warning)" },
  paused: { text: "Paused", cls: "bg-(--dc-brief-history-soft) text-(--dc-brief-history)" },
};
const CALLED_COLUMNS = [
  { key: "at", label: "When" },
  { key: "stove_serial_no", label: "Stove ID" },
  { key: "end_user_name", label: "Buyer" },
  { key: "partner_name", label: "Partner" },
  { key: "attempt_no", label: "Try number" },
  { key: "outcome_label", label: "Outcome" },
  { key: "sale_id", label: "Sale id" },
];

function Inner() {
  const { can } = useFeature();
  const canManage = can(DATA_CENTER_FEATURES.ASSIGNMENT_MANAGE);
  const canEdit = can(DATA_CENTER_FEATURES.CALL_RECORDS_EDIT);
  const { agentId } = useParams({ from: "/data-center/call-centre_/agents/$agentId" });
  const search = useSearch({ from: "/data-center/call-centre_/agents/$agentId" });
  const navigate = useNavigate();
  const [day, setDay] = useState(null);
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [handing, setHanding] = useState(false);
  const [openSale, setOpenSale] = useState(null);
  const tab = search.tab ?? "to_call";

  const load = useCallback(async () => {
    try {
      const d = await dataCenterAssign.agentDay({ agentId, day: search.day ?? null, range: search.range === "week" ? "week" : "day" });
      setDay(d);
      setError(null);
      if (canManage) dataCenterAssign.agents().then(setMeta).catch(() => {});
    } catch (err) {
      setError(err instanceof DataCenterError ? err.message : "Could not load this agent's day.");
    }
  }, [agentId, search.day, search.range, canManage]);
  useEffect(() => {
    load();
  }, [load]);
  usePolling(load, meta?.refreshSeconds ?? 60);

  const agent = day?.agent ?? null;
  const roster = meta?.agents?.find((a) => a.agent_id === agentId) ?? null;
  const defaultCap = meta?.defaultCap ?? 1;
  const ceiling = meta?.capacityCeiling ?? 10;
  const cap = agent?.max_open_batches ?? defaultCap;
  const over = (agent?.open_batches ?? 0) > cap;
  const isToday = day && day.day === day.today && day.range !== "week";
  const p = PRESENCE[agent?.presence] ?? null;

  const act = async (fn, failed) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err instanceof DataCenterError ? err.message : failed);
    } finally {
      setBusy(false);
    }
  };
  const setTab = (next) => navigate({ to: "/data-center/call-centre/agents/$agentId", params: { agentId }, search: (prev) => ({ ...prev, tab: next === "to_call" ? undefined : next }) });
  const name = agent?.full_name || agent?.email || "this agent";

  return (
    <div className="space-y-4">
      <Link href="/data-center/call-centre" className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2.5 py-1 text-xs font-semibold text-gray-700 hover:border-(--dc-accent)">
        <ArrowLeft className="h-3.5 w-3.5" /> Control centre
      </Link>
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

      <section className="rounded-xl border border-gray-200 border-t-[3px] border-t-(--dc-accent) bg-white shadow-sm" data-agent-page={agentId}>
        <header className="flex flex-wrap items-center gap-3 border-b border-gray-100 bg-(--dc-accent-soft)/30 px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-gray-900">{name}</h2>
            <p className="text-xs text-gray-600">
              {agent?.email}
              {p && <span data-presence={agent.presence} className={`ml-2 inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${p.cls}`}>{p.text}</span>}
              {agent?.current_serial && <> · on <span className="font-mono">{agent.current_serial}</span></>}
              {agent?.last_seen_at && <> · last save {whenOf(agent.last_seen_at)}</>}
            </p>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2 text-xs">
            <span className={`tabular-nums ${over ? "font-semibold text-(--dc-sev-critical)" : "text-gray-700"}`} title={over ? "Over capacity: reassign or release" : undefined}>
              {agent?.open_batches ?? 0} of{" "}
              {canManage && agent ? (
                <select
                  aria-label={`Capacity for ${name}`}
                  value={cap}
                  onChange={(e) => act(() => dataCenterAssign.setAgentProfile(agentId, { maxOpenBatches: Number(e.target.value) }), "Could not change the capacity.")}
                  className="rounded border border-gray-300 bg-white px-1 py-0.5 text-xs text-gray-800"
                >
                  {Array.from({ length: ceiling }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              ) : cap}{" "}
              {cap === 1 ? "batch" : "batches"}
            </span>
            {canManage && agent && (
              <button
                type="button"
                disabled={busy}
                onClick={() => act(() => dataCenterAssign.setAgentProfile(agentId, { isEnabled: !agent.is_enabled }), "Could not change that.")}
                className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 font-semibold transition ${agent.is_enabled ? "border-gray-300 text-gray-700 hover:border-(--dc-brief-history) hover:text-(--dc-brief-history)" : "border-(--dc-brief-who) text-(--dc-brief-who) hover:bg-(--dc-brief-who-soft)"}`}
              >
                {agent.is_enabled ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                {agent.is_enabled ? "Pause" : "Resume"}
              </button>
            )}
            {canManage && (
              <button
                type="button"
                onClick={() => setHanding(true)}
                className="inline-flex items-center gap-1 rounded-md bg-(--dc-fig-sold) px-2.5 py-1 font-semibold text-white shadow-sm transition hover:brightness-110"
              >
                <UserPlus className="h-3.5 w-3.5" /> Hand out more
              </button>
            )}
          </div>
        </header>

        <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 px-4 py-2.5">
          <DayChips today={day?.today} day={search.day} range={search.range} to="/data-center/call-centre/agents/$agentId" params={{ agentId }} />
          <div className="ml-auto flex gap-4 text-sm">
            <span><b className="tabular-nums text-gray-900">{day?.called ?? "…"}</b> <span className="text-gray-600">called</span></span>
            <span><b className="tabular-nums text-(--dc-brief-who)">{day?.verified ?? "…"}</b> <span className="text-gray-600">verified</span></span>
            <span><b className="tabular-nums text-gray-900">{day?.to_call?.length ?? "…"}</b> <span className="text-gray-600">to call</span></span>
          </div>
        </div>

        <div className="px-4 py-3">
          {!day ? (
            <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading the day...</div>
          ) : day.range === "week" ? (
            <div className="grid grid-cols-7 gap-1" data-week>
              {day.tally.map((d) => (
                <div key={d.date} className="rounded-md border border-gray-200 bg-(--dc-surface-muted) px-1 py-1.5 text-center" title={d.date}>
                  <span className="block text-[10px] text-gray-500">{new Date(`${d.date}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", timeZone: "UTC" })}</span>
                  <span className="block text-base font-semibold tabular-nums text-gray-900">{d.called}</span>
                  <span className="block text-[10px] tabular-nums text-(--dc-brief-who)">{d.verified} ok</span>
                </div>
              ))}
            </div>
          ) : (
            <Track marks={day.marks} flags={day.flags} tz={day.tz} isToday={isToday} tall emptyText={day.to_call.length > 0 ? `no calls yet · ${day.to_call.length} in hand` : "no calls"} />
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5 border-t border-gray-100 px-4 py-2" role="tablist">
          {[
            ["to_call", `To call · ${day?.to_call?.length ?? "…"}`],
            ["called", `Called · ${day?.concluded?.length ?? "…"}`],
          ].map(([key, text]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={`rounded-full border px-3 py-1 text-xs font-semibold ${tab === key ? "border-(--dc-accent) bg-(--dc-accent) text-white" : "border-gray-300 bg-white text-gray-700"}`}
            >
              {text}
            </button>
          ))}
          {tab === "called" && day && (
            <span className="ml-auto">
              <ExportButton columns={CALLED_COLUMNS} rows={() => day.concluded} filename={`${name}-called-${day.day}.csv`} label="Export calls" disabled={day.concluded.length === 0} />
            </span>
          )}
        </div>

        {tab === "to_call" && agent && (
          <div className="border-t border-gray-100 bg-(--dc-surface-muted)">
            <AgentDetail agent={{ ...roster, ...agent, records_held: day?.to_call?.length ?? agent.to_call ?? 0 }} agents={meta?.agents ?? []} onChanged={load} onOpenRecord={setOpenSale} />
          </div>
        )}
        {tab === "called" && day && (
          <div className="overflow-x-auto border-t border-gray-100">
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className="bg-(--dc-accent-soft) text-left text-xs uppercase tracking-wide text-(--dc-accent-strong)">
                  <th className="px-3 py-2 font-semibold">When</th>
                  <th className="px-3 py-2 font-semibold">Stove</th>
                  <th className="px-3 py-2 font-semibold">Buyer</th>
                  <th className="px-3 py-2 font-semibold">Partner</th>
                  <th className="px-3 py-2 text-right font-semibold">Try</th>
                  <th className="px-3 py-2 font-semibold">Outcome</th>
                  <th className="w-20 px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {day.concluded.length === 0 && (
                  <tr><td colSpan={7} className="px-3 py-6 text-center text-sm text-gray-500">No calls logged {day.range === "week" ? "this week" : "on this day"}.</td></tr>
                )}
                {[...day.concluded].reverse().map((c) => (
                  <tr key={`${c.at}-${c.sale_id}`} data-called-row>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-gray-600">
                      {day.range === "week" ? `${new Date(c.at).toLocaleDateString("en-GB", { weekday: "short", timeZone: day.tz })} ` : ""}{clockOf(c.at, day.tz)}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-gray-700">{c.stove_serial_no}</td>
                    <td className="px-3 py-2 text-gray-900">{c.end_user_name ?? "-"}</td>
                    <td className="px-3 py-2 text-gray-700">{c.partner_name ?? "-"}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-700">{c.attempt_no}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${OUTCOME_TONE(c.outcome_value)}`}>{c.outcome_label ?? "logged"}</span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button type="button" onClick={() => setOpenSale(c.sale_id)} className="rounded-md border border-(--dc-brief-stove) px-2 py-0.5 text-xs font-semibold text-(--dc-brief-stove) transition hover:bg-(--dc-brief-stove-soft)">Open</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="border-t border-gray-100 bg-gray-50 px-4 py-2 text-xs text-gray-600">{plural(day.concluded.length, "call")}, counted against this login (D35).</p>
          </div>
        )}
      </section>

      {handing && agent && (
        <AssignDialog
          agent={{ ...agent, agent_id: agentId }}
          pool={meta?.pool ?? []}
          batchSize={meta?.batchSize ?? 20}
          priority={meta?.priority}
          onDone={load}
          onClose={() => setHanding(false)}
        />
      )}
      {openSale && <CallRecordEditor saleId={openSale} canEdit={canEdit} onClose={() => setOpenSale(null)} onSaved={load} />}
    </div>
  );
}

export default function CallCentreAgentPage() {
  return (
    <DataCentreShell
      title="An agent's day"
      description="What they have in hand, what they concluded, by date."
      breadcrumb="Agent"
      area="call-centre"
      feature={DATA_CENTER_FEATURES.CALL_RECORDS_VIEW}
    >
      <Inner />
    </DataCentreShell>
  );
}
