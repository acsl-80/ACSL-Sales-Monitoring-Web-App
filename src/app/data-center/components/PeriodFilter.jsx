import { useMemo, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarRange, Check, ChevronDown, TriangleAlert } from "lucide-react";
import { PERIOD_CHOICES, resolvePeriod, yearsAvailable } from "../lib/period";

/**
 * When, asked the same way everywhere.
 *
 * Every surface in the module answers a question about a stretch of time, and
 * each of them had grown its own way of asking: two bare date boxes here, a
 * month dropdown there, nothing at all on Partner Records. Two surfaces could
 * not be set to the same period without typing the same dates twice, and
 * nothing on screen said which period you were looking at - so a scorecard
 * covering everything sat beside a table covering last week and read as a
 * contradiction.
 *
 * One control, one vocabulary. It shows the period it is on, because a filter
 * you cannot see is a filter you forget you set, and a number read under a
 * forgotten filter is a wrong number carried into a meeting.
 *
 * Grouped by the grain a person thinks in - days, months, years - rather than
 * one flat list of eleven. Years are last and are the default, because a year
 * of work is what people mean when they say "the numbers".
 */
export default function PeriodFilter({
  period,
  onChange,
  earliest = null,
  /** Named so the chip says what is being narrowed, not just when. */
  noun = "records",
  /**
   * Which area's accent the popover wears.
   *
   * Radix portals the panel to <body>, so it cannot inherit the colour of the
   * page that opened it, and colour is wayfinding in this module - a slate-blue
   * panel opening out of an ochre page reads as a different area's control.
   */
  area = "stove-records",
  className = "",
}) {
  const [open, setOpen] = useState(false);
  const resolved = useMemo(() => resolvePeriod(period), [period]);
  const years = useMemo(() => yearsAvailable(earliest), [earliest]);

  const groups = useMemo(() => {
    const out = [];
    for (const choice of PERIOD_CHOICES) {
      const last = out[out.length - 1];
      if (last && last.name === choice.group) last.items.push(choice);
      else out.push({ name: choice.group, items: [choice] });
    }
    return out;
  }, []);

  const pickedYears = period.years ?? [];

  const toggleYear = (y) => {
    const next = pickedYears.includes(y)
      ? pickedYears.filter((v) => v !== y)
      : [...pickedYears, y];
    onChange({ key: "years", years: next });
  };

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`Change the period: showing ${noun} for ${resolved.label}`}
            className="inline-flex items-center gap-1.5 rounded-md border border-(--dc-accent)/30 bg-(--dc-accent-soft)/25 px-3 py-1.5 text-sm font-medium text-(--dc-accent-strong) transition hover:bg-(--dc-accent-soft)/50"
          >
            <CalendarRange className="h-4 w-4" />
            <span className="text-gray-600">{noun} for</span>
            <span>{resolved.label}</span>
            <ChevronDown className="h-3.5 w-3.5 opacity-60" />
          </button>
        </PopoverTrigger>

        <PopoverContent
          align="start"
          className="dc-root w-[min(92vw,28rem)] p-0"
          data-area={area}
        >
          <div className="max-h-[70dvh] overflow-y-auto p-3">
            {groups.map((g) => (
              <div key={g.name} className="mb-3 last:mb-0">
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  {g.name}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {g.items.map((c) => {
                    const on = period.key === c.key;
                    return (
                      <button
                        key={c.key}
                        type="button"
                        onClick={() => {
                          if (c.key === "years") {
                            onChange({ key: "years", years: pickedYears.length ? pickedYears : [years[0]] });
                          } else if (c.key === "custom") {
                            onChange({ key: "custom", from: period.from, to: period.to });
                          } else {
                            onChange({ key: c.key });
                            setOpen(false);
                          }
                        }}
                        aria-pressed={on}
                        className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-sm transition ${
                          on
                            ? "border-(--dc-accent) bg-(--dc-accent) text-white"
                            : "border-gray-200 text-gray-700 hover:border-(--dc-accent)/40 hover:bg-(--dc-accent-soft)/30"
                        }`}
                      >
                        {on && <Check className="h-3.5 w-3.5" />}
                        {c.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            {period.key === "years" && (
              <div className="rounded-lg border border-gray-200 p-3">
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-600">
                  Which years
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {years.map((y) => {
                    const on = pickedYears.includes(y);
                    return (
                      <button
                        key={y}
                        type="button"
                        onClick={() => toggleYear(y)}
                        aria-pressed={on}
                        className={`rounded-md border px-2.5 py-1.5 text-sm tabular-nums transition ${
                          on
                            ? "border-(--dc-accent) bg-(--dc-accent) text-white"
                            : "border-gray-200 text-gray-700 hover:border-(--dc-accent)/40"
                        }`}
                      >
                        {y}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2 text-xs text-gray-500">
                  Only the years the register actually holds are offered. An empty
                  year on this list would read as a year with no sales rather than
                  a year that never existed.
                </p>
              </div>
            )}

            {period.key === "custom" && (
              <div className="rounded-lg border border-gray-200 p-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-600">
                  Between these dates
                </p>
                <div className="flex flex-wrap items-end gap-2">
                  <label className="flex-1">
                    <span className="mb-1 block text-xs text-gray-600">From</span>
                    <input
                      type="date"
                      value={period.from ?? ""}
                      aria-label="From date"
                      onChange={(e) =>
                        onChange({ key: "custom", from: e.target.value || undefined, to: period.to })
                      }
                      className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-(--dc-accent) focus:outline-none"
                    />
                  </label>
                  <label className="flex-1">
                    <span className="mb-1 block text-xs text-gray-600">To</span>
                    <input
                      type="date"
                      value={period.to ?? ""}
                      aria-label="To date"
                      onChange={(e) =>
                        onChange({ key: "custom", from: period.from, to: e.target.value || undefined })
                      }
                      className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-(--dc-accent) focus:outline-none"
                    />
                  </label>
                </div>
                <p className="mt-2 text-xs text-gray-500">
                  Either one on its own works: a start with no end runs to today.
                </p>
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>

      {resolved.caveat && (
        <p className="inline-flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {resolved.caveat}
        </p>
      )}
    </div>
  );
}
