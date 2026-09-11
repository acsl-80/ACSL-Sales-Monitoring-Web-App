import { STANDING_ORDER, STANDING_WORDS, STANDING_FILL } from "../lib/outcome";

/**
 * Where a set of call records stands, drawn (Phase 28, D46).
 *
 * One bar, six segments in the standing order, each as wide as its share and
 * carrying its count when there is room; the words in a legend once per
 * surface rather than once per bar. The counts come from
 * `data_center.v_partner_standing` or the assignment log, never from the
 * client: this component only draws what it is handed.
 *
 * `counts` is `{ never_called, in_progress, verified, partially_verified,
 * unreachable, with_sales }`. Colours are the module's figure gradients,
 * painted as background images (a gradient token applied as a colour paints
 * nothing; see PR #94).
 */
export function standingSaid(counts) {
  return STANDING_ORDER.map((k) => `${STANDING_WORDS[k]} ${Number(counts?.[k] ?? 0)}`).join(", ");
}

export default function StandingBar({ counts, legend = false, className = "", height = "h-5" }) {
  const total = STANDING_ORDER.reduce((n, k) => n + Number(counts?.[k] ?? 0), 0);
  return (
    <div className={className} data-standing-bar={total}>
      <div className={`flex w-full gap-0.5 ${height}`} role="img" aria-label={total === 0 ? "No records" : standingSaid(counts)}>
        {total === 0 && <span className="block h-full w-full rounded-[3px] bg-gray-200" />}
        {total > 0 && STANDING_ORDER.map((k) => {
          const n = Number(counts?.[k] ?? 0);
          if (n === 0) return null;
          const share = n / total;
          return (
            <span
              key={k}
              className={`block h-full min-w-[0.9rem] rounded-[3px] text-center text-[10px] font-bold leading-5 ${STANDING_FILL[k]}`}
              style={{ flexGrow: n, flexBasis: 0 }}
              title={`${STANDING_WORDS[k]}: ${n.toLocaleString()}`}
              data-standing-cell={k}
              data-standing-count={n}
            >
              {share >= 0.08 ? n.toLocaleString() : ""}
            </span>
          );
        })}
      </div>
      {legend && <StandingLegend className="mt-1.5" />}
    </div>
  );
}

/** The six words with their swatches, once per surface. */
export function StandingLegend({ className = "" }) {
  return (
    <p className={`flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-gray-600 ${className}`} data-standing-legend>
      {STANDING_ORDER.map((k) => (
        <span key={k} className="inline-flex items-center gap-1">
          <i aria-hidden className={`inline-block h-2.5 w-2.5 rounded-[2px] ${STANDING_FILL[k]}`} /> {STANDING_WORDS[k]}
        </span>
      ))}
    </p>
  );
}
