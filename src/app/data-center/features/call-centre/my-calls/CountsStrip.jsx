import { COUNT_COLUMNS } from "./views";

/**
 * What the agent did, per view, for today, this week and the chosen window
 * (Phase 28, D45). A call counts by its recorded outcome, a send-back the
 * agent opened counts to With Sales, All is the sum. The server computes
 * every number over `v_call_attempts_resolved`, so the July and August
 * sheet calls are here under the agent who made them.
 *
 * The chosen window's row appears only when it is neither today nor the
 * week to today, so the strip is two rows on an ordinary day.
 */
const COLS = COUNT_COLUMNS;

function windowLabel(day) {
  if (day.range === "span") return "Chosen days";
  if (day.range === "week") return `Week to ${labelFor(day.day)}`;
  return labelFor(day.day);
}
function labelFor(iso) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

export default function CountsStrip({ day }) {
  if (!day?.counts) return null;
  const selectedIsToday = day.range === "day" && day.day === day.today;
  const selectedIsWeek = day.range === "week" && day.day === day.today;
  const rows = [
    { key: "today", label: "Today", counts: day.counts.today },
    { key: "week", label: "This week", counts: day.counts.week },
  ];
  if (!selectedIsToday && !selectedIsWeek) rows.push({ key: "selected", label: windowLabel(day), counts: day.counts.selected });

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm" data-my-counts>
      <table className="w-full min-w-[36rem] text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500">
            <th className="px-4 py-2 font-semibold">Your calls</th>
            {COLS.map((c) => (
              <th key={c.key} className="px-3 py-2 text-right font-semibold">{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((r) => (
            <tr key={r.key} data-my-count-row={r.key}>
              <td className="px-4 py-1.5 font-medium text-gray-900">{r.label}</td>
              {COLS.map((c) => (
                <td key={c.key} className="px-3 py-1.5 text-right tabular-nums text-gray-800" data-my-count={`${r.key}-${c.key}`}>
                  {Number(r.counts?.[c.count] ?? 0).toLocaleString()}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
