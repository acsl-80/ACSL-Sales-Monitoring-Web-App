import Door from "../../call-centre/control/Door";
import { ArrowRight } from "lucide-react";

/**
 * Figures that are doors (import redesign, 2026-09-07).
 *
 * The same rule as the call centre's board: a number that names a countable
 * thing opens the rows behind it, in the colour of what it leads to. Each
 * figure is `{ key, value, label, href, tone, sub }`; a null value renders as
 * a quiet dash so a read that failed or is not permitted never shows a zero
 * that reads as a fact (the module's rule since the dashboard's missing
 * metric rendered as 0).
 *
 * `compact` is the four-across strip inside a card (Waiting to confirm);
 * the default is the page's band.
 */
const TONE = {
  sold: "bg-(image:--dc-fig-sold)",
  verified: "bg-(image:--dc-fig-verified)",
  transferred: "bg-(image:--dc-fig-transferred)",
  unverified: "bg-(image:--dc-fig-unverified)",
  plum: "bg-(image:--dc-fig-plum)",
  crit: "bg-(image:--dc-fig-crit)",
};

function Figure({ f, compact }) {
  const shown = f.value == null ? "…" : Number(f.value).toLocaleString();
  const body = (
    <>
      <span
        className={`block font-semibold tabular-nums text-white ${compact ? "text-xl" : "text-3xl"}`}
      >
        {shown}
      </span>
      <span className="mt-0.5 block text-xs font-medium text-white/90">{f.label}</span>
      {f.sub && !compact && <span className="mt-0.5 block text-[11px] text-white/80">{f.sub}</span>}
      {f.href && (
        <ArrowRight className="absolute right-3 top-3 h-3.5 w-3.5 text-white/70" aria-hidden />
      )}
    </>
  );
  const cls = `relative block rounded-xl text-left shadow-sm ${compact ? "p-2.5" : "p-3 min-h-[84px] flex flex-col justify-end"} ${TONE[f.tone] ?? TONE.plum} ${f.href ? "transition hover:-translate-y-px" : ""}`;
  if (!f.href) {
    return (
      <div className={cls} data-import-figure={f.key}>
        {body}
      </div>
    );
  }
  return (
    <Door
      href={f.href}
      className={cls}
      data-import-figure={f.key}
      aria-label={`${f.label}: ${shown}`}
    >
      {body}
    </Door>
  );
}

export default function ImportFigures({ figures, compact = false, className = "" }) {
  const shown = figures.filter(Boolean);
  if (shown.length === 0) return null;
  return (
    <div
      className={`grid grid-cols-2 gap-2.5 ${shown.length >= 4 ? "md:grid-cols-4" : shown.length === 3 ? "md:grid-cols-3" : ""} ${className}`}
      data-import-figures
    >
      {shown.map((f) => (
        <Figure key={f.key} f={f} compact={compact} />
      ))}
    </div>
  );
}
