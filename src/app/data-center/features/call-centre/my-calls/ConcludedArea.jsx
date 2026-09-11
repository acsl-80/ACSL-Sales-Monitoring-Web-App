import { ChevronRight } from "lucide-react";
import ExportButton from "../../../components/ExportButton";
import CopyField from "../control/CopyField";
import { CONCLUDED_VIEWS, itemsIn } from "./views";
import { standingLabel } from "../../../lib/outcome";
import { plural } from "../../../lib/plural";
import { whenOf } from "../../../lib/when";

/**
 * The background (Phase 28, D49): the records the agent has concluded or
 * sent to Sales, folded at the bottom of My calls so the working surface
 * stays New. Open it and the four views sit inside as chips; a deep link
 * with `view` opens it on that view. Every record stays openable, because
 * unreachable and sometimes partly verified get revisited (D50 keeps them
 * with the agent until a manager moves them).
 */
export default function ConcludedArea({ items, open, view, onToggle, onView, canEdit, dialler, onOpen, columns }) {
  const concluded = CONCLUDED_VIEWS.flatMap((v) => itemsIn(v, items));
  const current = view ?? CONCLUDED_VIEWS[0];
  const rows = itemsIn(current, items);
  return (
    <section className="rounded-xl border border-gray-200 bg-white shadow-sm" data-my-concluded={open ? "open" : "closed"}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        data-my-concluded-toggle
        className="flex w-full flex-wrap items-center gap-2 px-4 py-2.5 text-left text-sm font-semibold text-gray-900"
      >
        <ChevronRight className={`h-4 w-4 transition ${open ? "rotate-90" : ""}`} />
        Concluded ({concluded.length})
        <span className="text-xs font-normal text-gray-500">
          verified, partly verified, unreachable and with Sales; they stay with you until your manager moves them
        </span>
      </button>
      {open && (
        <div className="border-t border-gray-100">
          <div className="flex flex-wrap items-center gap-2 px-4 py-2.5" role="group" aria-label="Which concluded records to see">
            {CONCLUDED_VIEWS.map((v) => {
              const selected = v.key === current.key;
              const n = itemsIn(v, items).length;
              return (
                <button
                  key={v.key}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onView(v.key)}
                  data-my-view={v.key}
                  className={`inline-flex items-center gap-2 whitespace-nowrap rounded-lg border px-3 py-1.5 text-sm font-semibold transition ${
                    selected
                      ? "border-(--dc-accent) bg-(--dc-accent) text-white shadow-sm"
                      : "border-gray-300 bg-white text-gray-800 hover:border-(--dc-accent) hover:bg-(--dc-accent-soft)/50"
                  }`}
                >
                  {v.label}
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums ${selected ? "bg-white/20 text-white" : "bg-(--dc-accent-soft) text-(--dc-accent-strong)"}`}>
                    {n.toLocaleString()}
                  </span>
                </button>
              );
            })}
            <span className="ml-auto">
              <ExportButton columns={columns} rows={() => rows.map((i) => ({ ...i, standing_label: standingLabel(i.standing) }))} filename={`my-calls-${current.key}.csv`} label="Export this view" disabled={rows.length === 0} />
            </span>
          </div>
          {rows.length === 0 ? (
            <p className="border-t border-gray-100 px-4 py-4 text-sm text-gray-500">None of your records is {current.label.toLowerCase()}.</p>
          ) : (
            <div className="overflow-x-auto border-t border-gray-100">
              <table className="w-full min-w-[44rem] text-sm">
                <thead>
                  <tr className="bg-(--dc-accent-soft) text-left text-xs uppercase tracking-wide text-(--dc-accent-strong)">
                    <th className="px-3 py-2 font-semibold">Buyer</th>
                    <th className="px-3 py-2 font-semibold">Stove</th>
                    <th className="px-3 py-2 font-semibold">Partner</th>
                    <th className="px-3 py-2 font-semibold">Phone</th>
                    <th className="px-3 py-2 font-semibold">Last call</th>
                    <th className="w-28 px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.map((i) => (
                    <tr key={i.sale_id} data-my-row={i.sale_id}>
                      <td className="px-3 py-2 font-medium text-gray-900">{i.end_user_name ?? "-"}</td>
                      <td className="px-3 py-2 font-mono text-xs text-gray-700">{i.stove_serial_no}</td>
                      <td className="px-3 py-2 text-gray-700">{i.partner_name ?? "-"}</td>
                      <td className="px-3 py-2"><CopyField value={i.phone} label="phone" diallerName={dialler} compact /></td>
                      <td className="px-3 py-2 text-xs text-gray-600">{i.last_attempt_at ? `${whenOf(i.last_attempt_at)} · ${plural(i.attempt_count ?? 0, "try", "tries")}` : "no call logged"}</td>
                      <td className="px-3 py-2 text-right">
                        {canEdit && <button type="button" onClick={() => onOpen(i.sale_id)} className="rounded-md border border-(--dc-primary-mid) px-2.5 py-1 text-xs font-semibold text-(--dc-primary-strong) transition hover:bg-(--dc-primary-soft)">Revisit</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
