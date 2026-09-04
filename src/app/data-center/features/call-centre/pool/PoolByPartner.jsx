import { useMemo, useState } from "react";
import { metricRows } from "../../../lib/metricValue";
import { usePaged } from "../../../lib/usePaged";
import Pagination from "../../../components/Pagination";
import { dateOf } from "../../../lib/when";
import ExportButton from "../../../components/ExportButton";
import AssignDialog from "./AssignDialog";
import { UserPlus } from "lucide-react";

/**
 * The pool by partner: what is unassigned and callable, per partner, what
 * arrived lately, the oldest sale waiting, and who is on that partner now.
 *
 * Callable and recent come from compute (the pool family), because they are
 * counts over sales; the oldest sale and who is on it come live from the
 * small tables through the agents read. "Hand out" opens the same dialog an
 * agent's row opens, with the partner chosen and the agent to pick.
 */
const POOL_COLUMNS = [
  { key: "partner_name", label: "Partner" },
  { key: "callable", label: "Callable" },
  { key: "recent", label: "New lately" },
  { key: "oldest", label: "Oldest sale" },
  { key: "onIt", label: "On it now", get: (r) => r.onIt.join("; ") },
  { key: "organization_id", label: "Organisation id" },
];

export default function PoolByPartner({ metrics, agents, canManage, reload }) {
  const [handing, setHanding] = useState(null);
  const m = metrics?.metrics ?? [];

  const rows = useMemo(() => {
    const recent = new Map(metricRows(m, "pool.recent_by_partner").map((r) => [r.dimension.organization_id, r.value]));
    const live = new Map((agents?.pool ?? []).map((p) => [p.organization_id, p]));
    const onIt = agents?.onIt ?? {};
    const computed = metricRows(m, "pool.callable_by_partner").map((r) => ({
      organization_id: r.dimension.organization_id,
      partner_name: r.dimension.partner_name ?? live.get(r.dimension.organization_id)?.partner_name ?? "Unknown partner",
      callable: r.value,
      recent: recent.get(r.dimension.organization_id) ?? 0,
      oldest: live.get(r.dimension.organization_id)?.oldest ?? null,
      onIt: onIt[r.dimension.organization_id] ?? [],
    }));
    // A partner the live pool knows and the last compute did not (records
    // freed since) still shows, with its live count and no recent figure.
    for (const p of agents?.pool ?? []) {
      if (!computed.some((c) => c.organization_id === p.organization_id)) {
        computed.push({ organization_id: p.organization_id, partner_name: p.partner_name, callable: p.callable, recent: 0, oldest: p.oldest, onIt: onIt[p.organization_id] ?? [] });
      }
    }
    return computed.sort((a, b) => b.callable - a.callable || a.partner_name.localeCompare(b.partner_name));
  }, [m, agents]);

  const paged = usePaged(rows, 10);
  const batchSize = agents?.batchSize ?? 20;

  return (
    <section id="pool-by-partner" className="rounded-xl border border-gray-200 border-t-[3px] border-t-(--dc-accent) bg-white shadow-sm">
      <header className="flex flex-wrap items-center gap-2 border-b border-gray-100 bg-(--dc-accent-soft)/30 px-4 py-2.5">
        <h2 className="text-sm font-semibold text-gray-900">Pool by partner</h2>
        <span className="text-xs text-gray-600">unassigned and callable, from the last compute</span>
        <div className="ml-auto">
          <ExportButton columns={POOL_COLUMNS} rows={() => rows} filename="pool-by-partner.csv" label="Export pool" disabled={rows.length === 0} />
        </div>
      </header>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-gray-600">
          Nothing is waiting to be called. Every record has either been handed out, concluded, or is with Sales.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <thead>
              <tr className="bg-(--dc-accent-soft) text-left text-xs uppercase tracking-wide text-(--dc-accent-strong)">
                <th className="px-3 py-2 font-semibold">Partner</th>
                <th className="px-3 py-2 text-right font-semibold">Callable</th>
                <th className="px-3 py-2 text-right font-semibold">New lately</th>
                <th className="px-3 py-2 font-semibold">Oldest sale</th>
                <th className="px-3 py-2 font-semibold">On it now</th>
                {canManage && <th className="w-32 px-3 py-2" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {paged.slice.map((p) => (
                <tr key={p.organization_id} data-pool-row={p.organization_id}>
                  <td className="px-3 py-2 font-medium text-gray-900">{p.partner_name}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-900">{p.callable.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {p.recent > 0 ? (
                      <span className="rounded-full bg-(--dc-accent-soft) px-2 py-0.5 text-xs font-semibold text-(--dc-accent-strong)">{p.recent}</span>
                    ) : (
                      <span className="text-gray-500">0</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-gray-700">{p.oldest ? dateOf(p.oldest) : "-"}</td>
                  <td className="px-3 py-2 text-xs text-gray-700">{p.onIt.length > 0 ? p.onIt.join(", ") : <span className="text-gray-400">nobody</span>}</td>
                  {canManage && (
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => setHanding(p)}
                        className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-medium transition ${
                          p.onIt.length === 0
                            ? "bg-(--dc-accent) text-white hover:bg-(--dc-accent-strong)"
                            : "border border-(--dc-accent)/30 text-(--dc-accent) hover:bg-(--dc-accent-soft)/60"
                        }`}
                      >
                        <UserPlus className="h-3.5 w-3.5" /> Hand out {Math.min(batchSize, p.callable)}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > 0 && (
        <Pagination page={paged.page} pageSize={paged.pageSize} total={paged.total} onPage={paged.setPage} onPageSize={paged.setPageSize} noun="partner" />
      )}
      {handing && (
        <AssignDialog
          agents={agents?.agents ?? []}
          initialOrgId={handing.organization_id}
          pool={rows.map((r) => ({ organization_id: r.organization_id, partner_name: r.partner_name, callable: r.callable, oldest: r.oldest }))}
          batchSize={batchSize}
          priority={agents?.priority}
          onDone={reload}
          onClose={() => setHanding(null)}
        />
      )}
    </section>
  );
}
