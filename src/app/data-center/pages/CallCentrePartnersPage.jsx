import { useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import Link from "@/compat/Link";
import { ArrowLeft, ChevronLeft, ChevronRight, UserPlus } from "lucide-react";
import DataCentreShell from "../components/DataCentreShell";
import ExportButton from "../components/ExportButton";
import AssignDialog from "../features/call-centre/pool/AssignDialog";
import { useKeyset } from "../features/call-centre/control/useKeyset";
import { dataCenterAssign } from "../lib/client";
import { useFeature } from "../lib/access";
import { DATA_CENTER_FEATURES } from "../lib/features";
import { plural } from "../lib/plural";
import { whenOf } from "../lib/when";
import { useEffect } from "react";
import StandingBar, { StandingLegend } from "../components/StandingBar";

/**
 * /data-center/call-centre/partners (Phase 26, C2)
 *
 * The whole pool, partner by partner: waiting, new within the recent window,
 * oldest sale, who is on it, the configured batch size, Hand out on the row.
 * Filters and sort live in the URL; pages are keyset. The strip on top says
 * the whole pool in four numbers before a single row is read.
 */
const COLUMNS = [
  { key: "partner_name", label: "Partner" },
  { key: "state", label: "State" },
  { key: "waiting", label: "Waiting" },
  { key: "new_recent", label: "New recently" },
  { key: "oldest_sale", label: "Oldest sale" },
  { key: "on_it", label: "On it", get: (r) => (r.on_it ?? []).join("; ") },
  { key: "batch_size", label: "Batch size" },
  { key: "never_called", label: "Never called" },
  { key: "in_progress", label: "In progress" },
  { key: "verified", label: "Verified" },
  { key: "partially_verified", label: "Partly verified" },
  { key: "unreachable", label: "Unreachable" },
  { key: "with_sales", label: "With Sales" },
  { key: "total", label: "Records" },
  { key: "organization_id", label: "Partner id" },
];
const SORTS = [
  { key: "waiting", label: "Most waiting" },
  { key: "new", label: "Newest work" },
  { key: "oldest", label: "Oldest sale" },
  { key: "name", label: "Name" },
];
const SIZES = [25, 50, 100];

function Inner() {
  const { can } = useFeature();
  const canManage = can(DATA_CENTER_FEATURES.ASSIGNMENT_MANAGE);
  const search = useSearch({ from: "/data-center/call-centre_/partners" });
  const navigate = useNavigate();
  const [q, setQ] = useState(search.q ?? "");
  const [handing, setHanding] = useState(null);
  const [agentsMeta, setAgentsMeta] = useState(null);
  const limit = search.limit ?? 25;
  const sort = search.sort ?? "waiting";

  const set = (patch) =>
    navigate({
      to: "/data-center/call-centre/partners",
      search: (prev) => {
        const out = { ...prev, ...patch };
        for (const k of Object.keys(out)) if (out[k] === undefined || out[k] === "" || out[k] === false) delete out[k];
        return out;
      },
    });

  const keyset = useKeyset(
    (cursor) => dataCenterAssign.poolPartners({ q: search.q ?? null, state: search.state ?? null, nobodyOn: Boolean(search.nobodyOn), sort, limit, cursor }),
    [search.q, search.state, search.nobodyOn, sort, limit],
  );
  useEffect(() => {
    if (canManage) dataCenterAssign.agents().then(setAgentsMeta).catch(() => setAgentsMeta(null));
  }, [canManage]);

  const totals = keyset.page?.totals;
  const rows = keyset.rows;
  const states = Array.from(new Set((agentsMeta?.pool ?? []).map((p) => p.state).filter(Boolean))).sort();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/data-center/call-centre" className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2.5 py-1 text-xs font-semibold text-gray-700 hover:border-(--dc-accent)">
          <ArrowLeft className="h-3.5 w-3.5" /> Control centre
        </Link>
      </div>
      <section className="rounded-xl border border-gray-200 border-t-[3px] border-t-(--dc-brief-stove) bg-white shadow-sm">
        <div className="grid grid-cols-2 divide-x divide-gray-100 border-b border-gray-100 md:grid-cols-4" data-strip>
          {[
            ["waiting in all", totals?.waiting],
            ["partners with work", totals?.partners],
            ["partners nobody is on", totals?.nobody_on],
            [`new in the last ${plural(totals?.recent_days ?? 7, "day")}`, totals?.new_recent],
          ].map(([label, value]) => (
            <div key={label} className="px-4 py-3">
              <span className="block text-xl font-semibold tabular-nums text-gray-900">{value == null ? "…" : Number(value).toLocaleString()}</span>
              <span className="block text-xs text-gray-600">{label}</span>
            </div>
          ))}
        </div>
        <form
          className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-4 py-2.5"
          onSubmit={(e) => { e.preventDefault(); set({ q }); }}
        >
          <label htmlFor="pp-q" className="sr-only">Find a partner</label>
          <input id="pp-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a partner" className="w-48 rounded-md border border-gray-300 px-2 py-1 text-xs focus:border-(--dc-accent) focus:outline-none" />
          <label htmlFor="pp-state" className="text-xs text-gray-600">State</label>
          <select id="pp-state" value={search.state ?? ""} onChange={(e) => set({ state: e.target.value })} className="rounded-md border border-gray-300 px-1.5 py-1 text-xs">
            <option value="">All states</option>
            {states.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <label htmlFor="pp-sort" className="text-xs text-gray-600">Sort</label>
          <select id="pp-sort" value={sort} onChange={(e) => set({ sort: e.target.value })} className="rounded-md border border-gray-300 px-1.5 py-1 text-xs">
            {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <button
            type="button"
            aria-pressed={Boolean(search.nobodyOn)}
            onClick={() => set({ nobodyOn: !search.nobodyOn })}
            className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${search.nobodyOn ? "border-(--dc-accent) bg-(--dc-accent) text-white" : "border-gray-300 bg-white text-gray-700"}`}
          >
            Nobody on it
          </button>
          <button type="submit" className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-semibold text-gray-700">Apply</button>
          <span className="ml-auto" />
          <ExportButton columns={COLUMNS} rows={() => rows} filename="waiting-by-partner.csv" label="Export partners" disabled={rows.length === 0} />
        </form>
        {keyset.error && <p className="mx-4 mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{keyset.error}</p>}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[48rem] text-sm">
            <thead>
              <tr className="bg-(--dc-brief-stove-soft) text-left text-xs uppercase tracking-wide text-(--dc-brief-stove)">
                <th className="px-3 py-2 font-semibold">Partner</th>
                <th className="px-3 py-2 font-semibold">State</th>
                <th className="px-3 py-2 text-right font-semibold">Waiting</th>
                <th className="px-3 py-2 text-right font-semibold">New, {totals?.recent_days ?? 7}d</th>
                <th className="px-3 py-2 font-semibold">Oldest sale</th>
                <th className="px-3 py-2 font-semibold">On it</th>
                <th className="min-w-[14rem] px-3 py-2 font-semibold">Where things stand</th>
                <th className="px-3 py-2 text-right font-semibold">Batch size</th>
                {canManage && <th className="w-28 px-3 py-2" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {keyset.loading && rows.length === 0 && <tr><td colSpan={9} className="px-3 py-4 text-center text-xs text-gray-500">Loading...</td></tr>}
              {!keyset.loading && rows.length === 0 && <tr><td colSpan={9} className="px-3 py-6 text-center text-sm text-gray-500">No partner matches.</td></tr>}
              {rows.map((r) => (
                <tr key={r.organization_id} className="hover:bg-(--dc-brief-stove-soft)/40">
                  <td className="px-3 py-2">
                    <Link href={`/data-center/call-centre/records?organizationId=${encodeURIComponent(r.organization_id)}&preset=todo&label=${encodeURIComponent(r.partner_name)}`} className="font-medium text-gray-900 underline decoration-(--dc-brief-stove)/40 underline-offset-2 hover:decoration-(--dc-brief-stove)">
                      {r.partner_name}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-gray-700">{r.state ?? ""}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium text-gray-900">{r.waiting.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-700">{r.new_recent}</td>
                  <td className="px-3 py-2 text-gray-700">{whenOf(r.oldest_sale)}</td>
                  <td className="px-3 py-2 text-xs">
                    {r.on_it.length > 0 ? r.on_it.join(", ") : <span className="rounded-full bg-(--dc-sev-warning-soft) px-2 py-0.5 font-semibold text-(--dc-sev-warning)">nobody</span>}
                  </td>
                  <td className="px-3 py-2" data-partner-standing={r.organization_id}>
                    <StandingBar counts={r} height="h-4" />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-700">{r.batch_size}</td>
                  {canManage && (
                    <td className="px-3 py-2 text-right">
                      <button type="button" onClick={() => setHanding(r)} className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-(--dc-primary-mid) px-2.5 py-1 text-xs font-semibold text-(--dc-primary-strong) transition hover:bg-(--dc-primary-soft)">
                        <UserPlus className="h-3.5 w-3.5" /> Hand out
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t border-gray-100 px-4 py-2">
          <StandingLegend />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 px-4 py-2.5 text-sm">
          <p className="text-gray-600">
            {keyset.loading ? "Loading..." : `${plural(rows.length, "partner")} on page ${keyset.pageNumber}${keyset.page ? ` of ${keyset.page.total} matching` : ""}`}
          </p>
          <div className="flex items-center gap-3">
            <label htmlFor="pp-limit" className="text-xs text-gray-600">Per page</label>
            <select id="pp-limit" value={limit} onChange={(e) => set({ limit: Number(e.target.value) })} className="rounded-md border border-gray-300 px-1.5 py-1 text-xs">
              {SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <button type="button" onClick={keyset.goPrevious} disabled={!keyset.hasPrevious || keyset.loading} aria-label="Previous page" className="rounded-md border border-gray-300 p-1 text-gray-600 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
            <span className="px-1 text-xs tabular-nums text-gray-600">{keyset.pageNumber}</span>
            <button type="button" onClick={keyset.goNext} disabled={!keyset.hasNext || keyset.loading} aria-label="Next page" className="rounded-md border border-gray-300 p-1 text-gray-600 disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>
      </section>
      {handing && (
        <AssignDialog
          agents={agentsMeta?.agents ?? []}
          initialOrgId={handing.organization_id}
          pool={rows.map((r) => ({ organization_id: r.organization_id, partner_name: r.partner_name, callable: r.waiting, oldest: r.oldest_sale }))}
          batchSize={handing.batch_size ?? agentsMeta?.batchSize ?? 20}
          priority={agentsMeta?.priority}
          onDone={keyset.reload}
          onClose={() => setHanding(null)}
        />
      )}
    </div>
  );
}

export default function CallCentrePartnersPage() {
  return (
    <DataCentreShell
      title="Waiting, by partner"
      description="Every partner with records waiting to be called, who is on them, and a hand-out on each row."
      breadcrumb="Waiting by partner"
      area="call-centre"
      feature={DATA_CENTER_FEATURES.ASSIGNMENT_MANAGE}
    >
      <Inner />
    </DataCentreShell>
  );
}
