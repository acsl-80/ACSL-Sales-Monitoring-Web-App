import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import Link from "@/compat/Link";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import DataCentreShell from "../components/DataCentreShell";
import ExportButton from "../components/ExportButton";
import CallRecordEditor from "../features/call-centre/CallRecordEditor";
import { useKeyset } from "../features/call-centre/control/useKeyset";
import { KIND, KindPill, OUTCOME_TONE, clockOf, sentenceOf } from "../features/call-centre/control/HappenedToday";
import { dataCenterAssign } from "../lib/client";
import { useFeature } from "../lib/access";
import { DATA_CENTER_FEATURES } from "../lib/features";
import { plural } from "../lib/plural";

/**
 * /data-center/call-centre/activity (Phase 26, C2)
 *
 * The full feed: one row per thing that happened, newest first. A strip of the
 * window's totals, an hourly histogram, one filter row, keyset pages of 50,
 * export with a column picker. An editor without assignment.manage reads only
 * their own rows; the server decides, the page only says so.
 */
const COLUMNS = [
  { key: "at", label: "When" },
  { key: "kind", label: "Kind" },
  { key: "actor_name", label: "Who" },
  { key: "stove_serial_no", label: "Stove ID" },
  { key: "end_user_name", label: "Buyer" },
  { key: "partner_name", label: "Partner" },
  { key: "attempt_no", label: "Try number", get: (r) => r.detail?.attempt_no ?? "" },
  { key: "outcome", label: "Outcome", get: (r) => r.detail?.outcome_label ?? r.detail?.review_outcome ?? r.detail?.reason ?? "" },
  { key: "note", label: "Note", get: (r) => r.detail?.note ?? "" },
  { key: "sale_id", label: "Sale id" },
  { key: "batch_id", label: "Batch id" },
  { key: "actor_id", label: "Agent id" },
];
const SIZES = [50, 100, 200];

function dayShift(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function Histogram({ buckets, tz }) {
  const max = Math.max(1, ...buckets.map((b) => Number(b.calls) + Number(b.other)));
  if (buckets.length === 0) return null;
  return (
    <div className="border-b border-gray-100 px-4 pb-1 pt-3" data-histogram>
      <div className="flex h-14 items-end gap-px">
        {buckets.map((b) => {
          const calls = Number(b.calls);
          const spoke = Number(b.spoke);
          const cb = Number(b.callback);
          const un = Number(b.unreached);
          const total = calls + Number(b.other);
          const label = `${new Date(b.bucket).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", timeZone: tz })}: ${plural(calls, "call")}${b.other ? `, ${b.other} other` : ""}`;
          return (
            <div key={b.bucket} title={label} className="flex flex-1 flex-col justify-end" style={{ height: "100%" }}>
              <div className="flex flex-col-reverse" style={{ height: `${(total / max) * 100}%` }}>
                <i className="block bg-(--dc-brief-who)" style={{ flex: spoke }} />
                <i className="block bg-(--dc-brief-place)" style={{ flex: cb }} />
                <i className="block bg-(--dc-sev-critical)" style={{ flex: un }} />
                <i className="block bg-gray-300" style={{ flex: Number(b.other) }} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-[10px] text-gray-500">
        <span>{new Date(buckets[0].bucket).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: tz })}</span>
        <span>by hour · teal answered, amber callback, red not reached, grey hand-outs and the rest</span>
        <span>{new Date(buckets[buckets.length - 1].bucket).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: tz })}</span>
      </div>
    </div>
  );
}

function Inner() {
  const { can } = useFeature();
  const canManage = can(DATA_CENTER_FEATURES.ASSIGNMENT_MANAGE);
  const canEdit = can(DATA_CENTER_FEATURES.CALL_RECORDS_EDIT);
  const search = useSearch({ from: "/data-center/call-centre_/activity" });
  const navigate = useNavigate();
  const [q, setQ] = useState(search.q ?? "");
  const [agents, setAgents] = useState([]);
  const [openSale, setOpenSale] = useState(null);
  const limit = search.limit ?? 50;
  const from = search.from ?? dayShift(-6);
  const to = search.to ?? dayShift(0);

  const set = (patch) =>
    navigate({
      to: "/data-center/call-centre/activity",
      search: (prev) => {
        const out = { ...prev, ...patch };
        for (const k of Object.keys(out)) if (out[k] === undefined || out[k] === "") delete out[k];
        return out;
      },
    });

  const keyset = useKeyset(
    (cursor) =>
      dataCenterAssign.activity({
        from, to, agentId: search.agentId ?? null, kind: search.kind ?? null, outcome: search.outcome ?? null,
        organizationId: search.organizationId ?? null, q: search.q ?? null, limit, cursor,
      }),
    [from, to, search.agentId, search.kind, search.outcome, search.organizationId, search.q, limit],
  );
  useEffect(() => {
    if (canManage) dataCenterAssign.agents().then((a) => setAgents(a.agents ?? [])).catch(() => setAgents([]));
  }, [canManage]);

  const page = keyset.page;
  const rows = keyset.rows;
  const tz = "Africa/Lagos";
  const totals = page?.totals;
  const applied = useMemo(() => {
    const chips = [];
    if (search.agentId) chips.push({ key: "agentId", text: agents.find((a) => a.agent_id === search.agentId)?.full_name ?? "one agent" });
    if (search.kind) chips.push({ key: "kind", text: KIND[search.kind]?.text ?? search.kind });
    if (search.outcome) chips.push({ key: "outcome", text: search.outcome });
    if (search.organizationId) chips.push({ key: "organizationId", text: "one partner" });
    if (search.q) chips.push({ key: "q", text: `"${search.q}"` });
    return chips;
  }, [search, agents]);

  return (
    <div className="space-y-4">
      <Link href="/data-center/call-centre" className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2.5 py-1 text-xs font-semibold text-gray-700 hover:border-(--dc-accent)">
        <ArrowLeft className="h-3.5 w-3.5" /> Control centre
      </Link>
      <section className="rounded-xl border border-gray-200 border-t-[3px] border-t-(--dc-brief-history) bg-white shadow-sm">
        <div className="grid grid-cols-2 divide-x divide-gray-100 border-b border-gray-100 md:grid-cols-4" data-strip>
          {[
            ["calls logged", totals?.calls],
            ["verified", totals?.verified],
            ["hand-outs", totals?.handed_out],
            ["reclaims", totals?.reclaimed],
          ].map(([label, value]) => (
            <div key={label} className="px-4 py-3">
              <span className="block text-xl font-semibold tabular-nums text-gray-900">{value == null ? "…" : Number(value).toLocaleString()}</span>
              <span className="block text-xs text-gray-600">{label}, {from} to {to}</span>
            </div>
          ))}
        </div>
        {page?.histogram?.length > 0 && <Histogram buckets={page.histogram} tz={tz} />}
        <form className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-4 py-2.5" onSubmit={(e) => { e.preventDefault(); set({ q }); }}>
          <label htmlFor="ac-from" className="text-xs text-gray-600">From</label>
          <input id="ac-from" type="date" value={from} max={to} onChange={(e) => set({ from: e.target.value })} className="rounded-md border border-gray-300 px-1.5 py-1 text-xs" />
          <label htmlFor="ac-to" className="text-xs text-gray-600">To</label>
          <input id="ac-to" type="date" value={to} min={from} onChange={(e) => set({ to: e.target.value })} className="rounded-md border border-gray-300 px-1.5 py-1 text-xs" />
          {canManage && (
            <>
              <label htmlFor="ac-agent" className="text-xs text-gray-600">Agent</label>
              <select id="ac-agent" value={search.agentId ?? ""} onChange={(e) => set({ agentId: e.target.value })} className="rounded-md border border-gray-300 px-1.5 py-1 text-xs">
                <option value="">Everyone</option>
                {agents.map((a) => <option key={a.agent_id} value={a.agent_id}>{a.full_name || a.email}</option>)}
              </select>
            </>
          )}
          <label htmlFor="ac-kind" className="text-xs text-gray-600">Kind</label>
          <select id="ac-kind" value={search.kind ?? ""} onChange={(e) => set({ kind: e.target.value })} className="rounded-md border border-gray-300 px-1.5 py-1 text-xs">
            <option value="">All kinds</option>
            {Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v.text}</option>)}
          </select>
          <label htmlFor="ac-q" className="sr-only">Find a stove or a name</label>
          <input id="ac-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a stove or a name" className="w-48 rounded-md border border-gray-300 px-2 py-1 text-xs focus:border-(--dc-accent) focus:outline-none" />
          <button type="submit" className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-semibold text-gray-700">Apply</button>
          {applied.map((c) => (
            <button key={c.key} type="button" onClick={() => { if (c.key === "q") setQ(""); set({ [c.key]: undefined }); }} className="rounded-full border border-(--dc-accent) bg-(--dc-accent) px-2.5 py-0.5 text-xs font-semibold text-white" aria-label={`Remove filter ${c.text}`}>
              {c.text} ×
            </button>
          ))}
          <span className="ml-auto" />
          <ExportButton columns={COLUMNS} rows={() => rows} filename={`call-centre-activity-${from}-to-${to}.csv`} label="Export activity" disabled={rows.length === 0} />
        </form>
        {page?.scope === "own" && <p className="mx-4 mt-3 rounded-md bg-(--dc-accent-soft)/60 px-3 py-2 text-xs text-(--dc-accent-strong)">Your own activity. A manager sees everyone's.</p>}
        {keyset.error && <p className="mx-4 mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{keyset.error}</p>}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[56rem] text-sm">
            <thead>
              <tr className="bg-(--dc-brief-history-soft) text-left text-xs uppercase tracking-wide text-(--dc-brief-history)">
                <th className="px-3 py-2 font-semibold">When</th>
                <th className="px-3 py-2 font-semibold">Kind</th>
                <th className="px-3 py-2 font-semibold">Who</th>
                <th className="px-3 py-2 font-semibold">What</th>
                <th className="px-3 py-2 font-semibold">Partner</th>
                <th className="px-3 py-2 font-semibold">Outcome</th>
                <th className="w-20 px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {keyset.loading && rows.length === 0 && <tr><td colSpan={7} className="px-3 py-4 text-center text-xs text-gray-500">Loading...</td></tr>}
              {!keyset.loading && rows.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-sm text-gray-500">Nothing happened in this window with these filters.</td></tr>}
              {rows.map((r, i) => (
                <tr key={`${r.at}-${r.kind}-${r.sale_id ?? r.batch_id ?? i}`} className="hover:bg-(--dc-brief-history-soft)/40">
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-gray-600">
                    {new Date(r.at).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: tz })} {clockOf(r.at, tz)}
                  </td>
                  <td className="px-3 py-2"><KindPill kind={r.kind} /></td>
                  <td className="whitespace-nowrap px-3 py-2 text-gray-800">{r.actor_name ?? "-"}</td>
                  <td className="px-3 py-2 text-gray-800">{sentenceOf(r)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-gray-700">{r.partner_name ?? "-"}</td>
                  <td className="px-3 py-2">
                    {r.kind === "call" && r.outcome_value ? (
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${OUTCOME_TONE(r.outcome_value)}`}>{r.detail?.outcome_label ?? r.outcome_value}</span>
                    ) : r.detail?.review_outcome ? (
                      <span className="text-xs text-gray-600">{r.detail.review_outcome === "recall" ? "ring again" : "closed"}</span>
                    ) : r.detail?.state ? (
                      <span className="text-xs text-gray-600">{r.detail.state}</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {r.sale_id && (
                      <button type="button" onClick={() => setOpenSale(r.sale_id)} className="rounded-md border border-(--dc-brief-stove) px-2 py-0.5 text-xs font-semibold text-(--dc-brief-stove) transition hover:bg-(--dc-brief-stove-soft)">Open</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 px-4 py-2.5 text-sm">
          <p className="text-gray-600">{keyset.loading ? "Loading..." : `${plural(rows.length, "event")} on page ${keyset.pageNumber}${page ? ` of ${page.total.toLocaleString()} in the window` : ""}`}</p>
          <div className="flex items-center gap-3">
            <label htmlFor="ac-limit" className="text-xs text-gray-600">Per page</label>
            <select id="ac-limit" value={limit} onChange={(e) => set({ limit: Number(e.target.value) })} className="rounded-md border border-gray-300 px-1.5 py-1 text-xs">
              {SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <button type="button" onClick={keyset.goPrevious} disabled={!keyset.hasPrevious || keyset.loading} aria-label="Previous page" className="rounded-md border border-gray-300 p-1 text-gray-600 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
            <span className="px-1 text-xs tabular-nums text-gray-600">{keyset.pageNumber}</span>
            <button type="button" onClick={keyset.goNext} disabled={!keyset.hasNext || keyset.loading} aria-label="Next page" className="rounded-md border border-gray-300 p-1 text-gray-600 disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>
      </section>
      {openSale && <CallRecordEditor saleId={openSale} canEdit={canEdit} onClose={() => setOpenSale(null)} onSaved={keyset.reload} />}
    </div>
  );
}

export default function CallCentreActivityPage() {
  return (
    <DataCentreShell
      title="Activity"
      description="What happened in the call centre: calls logged, batches handed out and reclaimed, records sent back and fixes reviewed."
      breadcrumb="Activity"
      area="call-centre"
      feature={DATA_CENTER_FEATURES.CALL_RECORDS_VIEW}
    >
      <Inner />
    </DataCentreShell>
  );
}
