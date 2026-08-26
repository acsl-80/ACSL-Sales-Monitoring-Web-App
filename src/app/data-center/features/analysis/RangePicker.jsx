import { useId } from "react";
import { rangeChoices, matchChoice, monthSpan } from "./lib/range";
import { monthLabel } from "./lib/readAnalysis";

/**
 * The range control, built from the months the data actually holds.
 *
 * Years are not hardcoded and not taken from today's date. If the newest month
 * in the run is March, no April is offered, because a period the data cannot
 * fill draws an empty chart that reads as a collapse in trade rather than as
 * an absence of data.
 *
 * "Custom" is two month selects rather than a date range, because every metric
 * here is filed by month and a day-level control would imply a precision that
 * does not exist. Offering a control finer than the data is the same error as
 * offering one the data cannot answer.
 *
 * Labelled with htmlFor and an explicit id, never by wrapping. A <label> around
 * a <select> takes the selected <option> into its accessible name, which is how
 * a field called "Partner" ended up answering to "PartnerAny partner" and
 * became unnameable to both a screen reader and a test.
 */
export default function RangePicker({ months, from, to, onChange, disabled }) {
  const presetId = useId();
  const fromId = useId();
  const toId = useId();

  const choices = rangeChoices(months);
  const active = matchChoice(choices, from, to);
  const span = from && to ? monthSpan(from, to) : 0;

  const pick = (key) => {
    if (key === "custom") {
      const list = [...(months ?? [])].sort();
      onChange({ from: from ?? list[0] ?? null, to: to ?? list[list.length - 1] ?? null });
      return;
    }
    const choice = choices.find((c) => c.key === key);
    if (choice) onChange({ from: choice.from, to: choice.to });
  };

  const sorted = [...(months ?? [])].sort();

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div>
        <label htmlFor={presetId} className="block text-xs font-medium text-gray-600">
          Period
        </label>
        <select
          id={presetId}
          disabled={disabled}
          value={active?.key ?? "custom"}
          onChange={(e) => pick(e.target.value)}
          className="mt-1 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm focus:border-(--dc-accent) focus:outline-none"
        >
          {choices.map((c) => (
            <option key={c.key} value={c.key}>
              {c.key === "thisMonth" ? monthLabel(c.from) : c.label}
            </option>
          ))}
          <option value="custom">Choose months</option>
        </select>
      </div>

      {!active && (
        <>
          <div>
            <label htmlFor={fromId} className="block text-xs font-medium text-gray-600">
              From
            </label>
            <select
              id={fromId}
              disabled={disabled}
              value={from ?? ""}
              onChange={(e) => onChange({ from: e.target.value, to })}
              className="mt-1 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm focus:border-(--dc-accent) focus:outline-none"
            >
              {sorted.map((m) => (
                <option key={m} value={m}>
                  {monthLabel(m)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={toId} className="block text-xs font-medium text-gray-600">
              To
            </label>
            <select
              id={toId}
              disabled={disabled}
              value={to ?? ""}
              onChange={(e) => onChange({ from, to: e.target.value })}
              className="mt-1 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm focus:border-(--dc-accent) focus:outline-none"
            >
              {sorted.map((m) => (
                <option key={m} value={m}>
                  {monthLabel(m)}
                </option>
              ))}
            </select>
          </div>
        </>
      )}

      {span > 0 && (
        <p className="pb-1.5 text-xs text-gray-500">
          {span === 1 ? "One month" : `${span} months`}, compared with the{" "}
          {span === 1 ? "month" : `${span} months`} before.
        </p>
      )}
      {span === 0 && (
        <p className="pb-1.5 text-xs text-gray-500">
          Everything the last computation holds. Narrow the period to compare it
          with the one before.
        </p>
      )}
    </div>
  );
}
