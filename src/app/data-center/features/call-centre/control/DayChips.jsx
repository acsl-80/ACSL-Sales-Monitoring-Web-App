import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { CalendarDays, CalendarRange } from "lucide-react";

/**
 * Which window the board draws (Phase 26, C2; Phase 28, slice 4).
 *
 * Today, yesterday, this week, a month, a year, a picked day, or a range.
 * The choice lives in the URL (`day`, `range`), never in state, so back
 * restores it and a link carries it. Today is the default and stays out of
 * the URL. `range` is `week`, `YYYY-MM`, `YYYY` or `from..to`; `day` names a
 * picked day or the day a week ends on.
 *
 * "Today" and "yesterday" are the call centre's days, which the board
 * reports back in its own timezone; the chips never compute a date from the
 * browser's clock. A range longer than the configured cap is refused here
 * with the reason, and again by the server.
 */
export const RANGE_SPAN_CAP_DAYS = 92;
const MONTH = /^\d{4}-\d{2}$/;
const YEAR = /^\d{4}$/;
const SPAN = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/;

export function shiftDay(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function labelFor(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}
const monthLabel = (ym) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });

/** What a `range` value is: week, month, year, span or nothing. */
export function rangeKind(range) {
  if (range === "week") return "week";
  if (typeof range !== "string") return null;
  if (MONTH.test(range)) return "month";
  if (YEAR.test(range)) return "year";
  if (SPAN.test(range)) return "span";
  return null;
}

export default function DayChips({ today, day, range, to = "/data-center/call-centre", params, earliestYear }) {
  const navigate = useNavigate();
  const [picking, setPicking] = useState(null);
  const [from, setFrom] = useState("");
  const [until, setUntil] = useState("");
  const [rangeError, setRangeError] = useState(null);

  const go = (next) => {
    setPicking(null);
    navigate({
      to,
      params,
      search: (prev) => {
        const out = { ...prev };
        delete out.day;
        delete out.range;
        if (next.day && next.day !== today) out.day = next.day;
        if (next.range && rangeKind(next.range)) out.range = next.range;
        return out;
      },
    });
  };

  const kind = rangeKind(range);
  const current = day ?? today;
  const isToday = !kind && current === today;
  const isYesterday = !kind && today && current === shiftDay(today, -1);
  const isPicked = !kind && !isToday && !isYesterday;
  const thisMonth = today ? today.slice(0, 7) : "";
  const thisYear = today ? today.slice(0, 4) : "";
  const years = [];
  for (let y = Number(thisYear || 0); y >= Number(earliestYear ?? Number(thisYear || 0) - 2); y--) years.push(String(y));

  const applySpan = () => {
    if (!from || !until) return setRangeError("Pick both days.");
    if (until < from) return setRangeError("The end is before the start.");
    const days = Math.round((Date.parse(`${until}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
    if (days > RANGE_SPAN_CAP_DAYS) return setRangeError(`At most ${RANGE_SPAN_CAP_DAYS} days at a time; pick a year or a month for longer.`);
    setRangeError(null);
    return go({ range: `${from}..${until}` });
  };

  // Until the board has said what today is, the chips cannot compute
  // yesterday; they wait, disabled, rather than doing nothing on a click.
  const ready = Boolean(today);
  const chipCls = (active) =>
    `inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition disabled:opacity-60 ${
      active ? "border-(--dc-accent) bg-(--dc-accent) text-white" : "border-gray-300 bg-white text-gray-700 hover:border-(--dc-accent)/60"
    }`;
  const chip = (active, text, onClick, extra = {}) => (
    <button type="button" onClick={onClick} disabled={!ready} aria-pressed={active} className={chipCls(active)} {...extra}>
      {text}
    </button>
  );

  return (
    <div className="flex flex-col gap-2" data-day-chips>
      <div className="flex flex-wrap items-center gap-1.5">
        {chip(isToday, today ? `Today, ${labelFor(today)}` : "Today", () => go({}))}
        {chip(isYesterday, "Yesterday", () => today && go({ day: shiftDay(today, -1) }))}
        {chip(kind === "week", "This week", () => go({ day: current, range: "week" }))}
        <label className={chipCls(kind === "month")}>
          <span>{kind === "month" ? monthLabel(range) : "Month"}</span>
          <input
            type="month"
            aria-label="Pick a month"
            value={kind === "month" ? range : thisMonth}
            max={thisMonth || undefined}
            disabled={!ready}
            onChange={(e) => e.target.value && go({ range: e.target.value })}
            className="w-[1.1rem] cursor-pointer bg-transparent text-transparent outline-none"
          />
        </label>
        <label className={chipCls(kind === "year")}>
          <span className="sr-only">Pick a year</span>
          <select
            aria-label="Pick a year"
            value={kind === "year" ? range : ""}
            disabled={!ready}
            onChange={(e) => e.target.value && go({ range: e.target.value })}
            className={`cursor-pointer bg-transparent text-xs font-semibold outline-none ${kind === "year" ? "text-white" : "text-gray-700"}`}
          >
            <option value="" disabled>Year</option>
            {years.map((y) => <option key={y} value={y} className="text-gray-900">{y}</option>)}
          </select>
        </label>
        <label className={chipCls(isPicked)}>
          <CalendarDays className="h-3.5 w-3.5" aria-hidden />
          <span>{isPicked ? labelFor(current) : "Pick a day"}</span>
          <input
            type="date"
            aria-label="Pick a day"
            value={current ?? ""}
            max={today ?? undefined}
            disabled={!ready}
            onChange={(e) => e.target.value && go({ day: e.target.value })}
            className="w-[1.1rem] cursor-pointer bg-transparent text-transparent outline-none"
          />
        </label>
        {chip(kind === "span", (
          <><CalendarRange className="h-3.5 w-3.5" aria-hidden />{kind === "span" ? `${labelFor(range.slice(0, 10))} to ${labelFor(range.slice(12))}` : "Range"}</>
        ), () => setPicking(picking === "span" ? null : "span"), { "aria-expanded": picking === "span", "data-range-chip": true })}
      </div>
      {picking === "span" && (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-gray-200 bg-(--dc-surface-muted) px-3 py-2" data-range-picker>
          <label className="text-xs text-gray-600">
            <span className="mb-0.5 block font-semibold uppercase tracking-wide">From</span>
            <input type="date" value={from} max={today ?? undefined} onChange={(e) => setFrom(e.target.value)} className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs" />
          </label>
          <label className="text-xs text-gray-600">
            <span className="mb-0.5 block font-semibold uppercase tracking-wide">To</span>
            <input type="date" value={until} max={today ?? undefined} onChange={(e) => setUntil(e.target.value)} className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs" />
          </label>
          <button type="button" onClick={applySpan} className="rounded-md bg-(--dc-accent) px-3 py-1.5 text-xs font-semibold text-white">Show</button>
          <span className="text-xs text-gray-500">{rangeError ?? `Up to ${RANGE_SPAN_CAP_DAYS} days, one cell per day.`}</span>
        </div>
      )}
    </div>
  );
}
