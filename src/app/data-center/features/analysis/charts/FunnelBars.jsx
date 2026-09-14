import { Link } from "@tanstack/react-router";
import { share } from "../lib/readAnalysis";

/**
 * The gate chain, with the drop between gates named.
 *
 * Drawn in the DOM rather than by recharts, for the same reason as the
 * heatmap: the mark here is a labelled row, not a point on a continuous axis.
 * A funnel is five numbers and four subtractions, and the subtractions are the
 * part anybody acts on.
 *
 * Each stage carries its share of the FIRST stage, not of the one above it.
 * "94% of the previous step" reads as healthy five times in a row while two
 * thirds of the records quietly fall out of the bottom, which is exactly the
 * arithmetic this chart exists to make impossible to miss.
 *
 * The chain is monotonically non-increasing by construction in SQL, because
 * each stage's filter contains the one before it. If a bar is ever wider than
 * the bar above it, the compute is wrong and this will show it rather than
 * hide it behind a max().
 */
export default function FunnelBars({ stages, drillFor, unit = "records" }) {
  const first = stages[0]?.value ?? 0;

  return (
    <ol className="space-y-2">
      {stages.map((s, i) => {
        const prev = i > 0 ? stages[i - 1] : null;
        const lost = prev ? prev.value - s.value : 0;
        const pct = share(s.value, first);
        const target = drillFor?.(s) ?? null;

        return (
          <li key={s.key}>
            <div className="flex items-baseline justify-between gap-3 text-xs">
              <span className="font-medium text-gray-900">{s.label}</span>
              <span className="tabular-nums text-gray-600">
                <span className="font-bold text-gray-900">{s.value.toLocaleString()}</span>
                {pct != null && <span className="ml-1.5">{pct.toFixed(1)}% of sold</span>}
              </span>
            </div>

            <div className="mt-1 h-6 w-full overflow-hidden rounded bg-gray-100">
              {target ? (
                <Link
                  to={target.to}
                  search={target.search}
                  aria-label={`${s.label}: ${s.value} ${unit}`}
                  className="block h-full bg-(--dc-accent) transition-[width] duration-200 hover:bg-(--dc-accent-strong)"
                  style={{ width: `${first ? Math.max(0.5, (s.value / first) * 100) : 0}%` }}
                />
              ) : (
                <span
                  className="block h-full bg-(--dc-accent)"
                  style={{ width: `${first ? Math.max(0.5, (s.value / first) * 100) : 0}%` }}
                />
              )}
            </div>

            {prev && lost > 0 && (
              <p className="mt-1 text-xs text-gray-500">
                {lost.toLocaleString()} lost between {prev.label.toLowerCase()} and{" "}
                {s.label.toLowerCase()}
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}
