import { useState } from "react";
import Link from "@/compat/Link";
import { UserPlus } from "lucide-react";
import AssignDialog from "../pool/AssignDialog";
import { plural } from "../../../lib/plural";
import { whenOf } from "../../../lib/when";

/**
 * Waiting, by partner (Phase 26, C2). The top of the pool as partners, most
 * waiting first: waiting, new within the recent window, who holds an open
 * batch of it, and Hand out on the row. The whole list, with filters and
 * pages, is the Partners page behind "See all". A partner's name opens the
 * queue narrowed to their waiting records.
 *
 * Reads `pool_partners` (keyset, five rows). Keeps `#pool-by-partner` and
 * the "Hand out" button name the specs point at.
 */
export default function WaitingByPartner({ partners, agentsMeta, canManage, reload }) {
  const [handing, setHanding] = useState(null);
  const rows = partners?.rows ?? [];
  const totals = partners?.totals;
  const pool = rows.map((r) => ({ organization_id: r.organization_id, partner_name: r.partner_name, callable: r.waiting, oldest: r.oldest_sale }));

  return (
    <section id="pool-by-partner" aria-labelledby="cc-partners" className="rounded-xl border border-gray-200 border-t-[3px] border-t-(--dc-brief-stove) bg-white shadow-sm">
      <header className="flex flex-wrap items-center gap-2 border-b border-gray-100 bg-(--dc-brief-stove-soft)/30 px-4 py-2.5">
        <h2 id="cc-partners" className="text-sm font-semibold text-gray-900">Waiting, by partner</h2>
        <span className="text-xs text-gray-600">
          {totals ? `${totals.waiting.toLocaleString()} waiting across ${plural(totals.partners, "partner")}` : "loading"}
          {totals?.nobody_on ? ` · ${totals.nobody_on} nobody is on` : ""}
        </span>
        <Link
          href="/data-center/call-centre/partners"
          className="ml-auto inline-flex items-center gap-1 rounded-md bg-(--dc-fig-transferred) px-2.5 py-1 text-xs font-semibold text-white shadow-sm transition hover:brightness-110"
        >
          See all {totals?.partners ?? ""} partners
        </Link>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-(--dc-brief-stove-soft) text-left text-xs uppercase tracking-wide text-(--dc-brief-stove)">
              <th className="px-3 py-2 font-semibold">Partner</th>
              <th className="px-3 py-2 text-right font-semibold">Waiting</th>
              <th className="px-3 py-2 text-right font-semibold">New, {totals?.recent_days ?? 7}d</th>
              <th className="px-3 py-2 font-semibold">On it</th>
              {canManage && <th className="w-28 px-3 py-2" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {!partners && (
              <tr><td colSpan={5} className="px-3 py-4 text-center text-xs text-gray-500">Loading the pool...</td></tr>
            )}
            {partners && rows.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-sm text-gray-500">Nothing is waiting to be called.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.organization_id} className="hover:bg-(--dc-brief-stove-soft)/40">
                <td className="px-3 py-2">
                  <Link
                    href={`/data-center/call-centre?organizationId=${encodeURIComponent(r.organization_id)}&preset=todo&label=${encodeURIComponent(r.partner_name)}`}
                    className="font-medium text-gray-900 underline decoration-(--dc-brief-stove)/40 underline-offset-2 hover:decoration-(--dc-brief-stove)"
                  >
                    {r.partner_name}
                  </Link>
                  <span className="block text-xs text-gray-500">{r.state ?? ""}{r.oldest_sale ? ` · oldest sale ${whenOf(r.oldest_sale)}` : ""}</span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums font-medium text-gray-900">{r.waiting.toLocaleString()}</td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-700">{r.new_recent}</td>
                <td className="px-3 py-2 text-xs">
                  {r.on_it.length > 0 ? (
                    <span className="text-gray-700">{r.on_it.join(", ")}</span>
                  ) : (
                    <span className="rounded-full bg-(--dc-sev-warning-soft) px-2 py-0.5 font-semibold text-(--dc-sev-warning)">nobody</span>
                  )}
                </td>
                {canManage && (
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => setHanding(r)}
                      className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-(--dc-primary-mid) px-2.5 py-1 text-xs font-semibold text-(--dc-primary-strong) transition hover:bg-(--dc-primary-soft)"
                    >
                      <UserPlus className="h-3.5 w-3.5" /> Hand out
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {partners && rows.length > 0 && (
        <p className="border-t border-gray-100 bg-gray-50 px-4 py-2 text-xs text-gray-600">
          Top {rows.length} of {partners.total} · the rest, with filters and pages, under See all.
        </p>
      )}
      {handing && (
        <AssignDialog
          agents={agentsMeta?.agents ?? []}
          initialOrgId={handing.organization_id}
          pool={pool}
          batchSize={handing.batch_size ?? agentsMeta?.batchSize ?? 20}
          priority={agentsMeta?.priority}
          onDone={reload}
          onClose={() => setHanding(null)}
        />
      )}
    </section>
  );
}
