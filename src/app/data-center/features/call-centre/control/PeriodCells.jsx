/**
 * The board's track for anything longer than a day (Phase 26, C2; Phase 28,
 * slice 4): one cell per day for a week, a month or a span, one cell per
 * month for a year. Counts are shown when the cells are wide enough; below
 * that the cell is a heat mark with the numbers in its title. Days and
 * months ahead are drawn empty and pale.
 *
 * `cells` is `[{ date, called, verified }]` where `date` is YYYY-MM-DD, or
 * YYYY-MM when `grain` is "month". `today` is the call centre's today.
 */
const MONTH_LETTERS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

function labelOf(date, grain, wide) {
  if (grain === "month") {
    const m = Number(date.slice(5, 7)) - 1;
    return wide ? new Date(Date.UTC(2000, m, 1)).toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" }) : MONTH_LETTERS[m];
  }
  const d = new Date(`${date}T00:00:00Z`);
  return wide
    ? d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", timeZone: "UTC" })
    : String(d.getUTCDate());
}

function heat(called, max) {
  if (called === 0) return "bg-(--dc-surface-muted)";
  const q = called / Math.max(1, max);
  if (q < 0.25) return "bg-(--dc-accent-soft)";
  if (q < 0.5) return "bg-(--dc-accent-soft) brightness-95";
  if (q < 0.75) return "bg-(--dc-accent)/60 text-white";
  return "bg-(--dc-accent) text-white";
}

export default function PeriodCells({ cells, grain = "day", today, tall = false }) {
  const n = cells.length;
  const wide = n <= 7;
  const max = Math.max(0, ...cells.map((c) => c.called));
  const ahead = (date) => today && (grain === "month" ? date > today.slice(0, 7) : date > today);
  return (
    <div
      className="grid gap-0.5"
      style={{ gridTemplateColumns: `repeat(${Math.max(1, n)}, minmax(0, 1fr))` }}
      data-period-cells={n}
      data-grain={grain}
      // The week keeps the hook the pages spec has pointed at since C3.
      data-week={n === 7 && grain === "day" ? "" : undefined}
    >
      {cells.map((c) => {
        const future = ahead(c.date);
        return (
          <div
            key={c.date}
            className={`rounded-[4px] border px-0.5 text-center ${tall ? "py-1.5" : "py-1"} ${
              future ? "border-dashed border-gray-200 text-gray-300" : `border-gray-200 ${wide ? "bg-(--dc-surface-muted)" : heat(c.called, max)}`
            }`}
            title={`${c.date}: ${c.called} called, ${c.verified} verified`}
            data-cell={c.date}
            data-called={c.called}
          >
            <span className={`block text-[10px] ${future ? "" : "text-gray-500"} ${wide ? "" : "leading-3"}`}>{labelOf(c.date, grain, wide)}</span>
            {!future && (
              <span className={`block tabular-nums font-semibold ${wide ? "text-sm text-gray-900" : "text-[10px] leading-3"}`}>{c.called}</span>
            )}
            {wide && !future && <span className="block text-[10px] tabular-nums text-(--dc-brief-who)">{c.verified} ok</span>}
          </div>
        );
      })}
    </div>
  );
}

/** The words for a window's track column. */
export function trackHeading(range, day) {
  if (range === "week") return "The week, by day";
  if (range === "month") return `${new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}, by day`;
  if (range === "year") return `${day.slice(0, 4)}, calls by month`;
  if (range === "span") return "The chosen days";
  return "The day, by hour";
}
