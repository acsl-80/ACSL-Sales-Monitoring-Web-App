/**
 * Ranges, in months.
 *
 * The module already has `lib/period.ts`, which resolves named periods to
 * dates for the records tables. This is deliberately not that. Analysis is
 * filed by month rather than by day, so its bounds are `2026-08`, and the
 * comparison it needs - this range against the one immediately before it - has
 * no equivalent there.
 *
 * That comparison is the whole of "year on year". A year against the year
 * before, a quarter against the quarter before and a month against the month
 * before are one mechanism: take the range, count its months, and step back
 * that many. Building a separate year-on-year feature would have given one
 * answer where this gives all of them.
 */

const RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export const isMonth = (m) => typeof m === "string" && RE.test(m);

/** `2026-08` plus n months, n negative to go back. */
export function shiftMonth(month, n) {
  if (!isMonth(month)) return month;
  const [y, m] = month.split("-").map(Number);
  const zero = y * 12 + (m - 1) + n;
  const year = Math.floor(zero / 12);
  const mon = zero - year * 12 + 1;
  return `${String(year).padStart(4, "0")}-${String(mon).padStart(2, "0")}`;
}

/** How many months the range covers, inclusive of both ends. */
export function monthSpan(from, to) {
  if (!isMonth(from) || !isMonth(to)) return 0;
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return ty * 12 + tm - (fy * 12 + fm) + 1;
}

/**
 * The equal-length range immediately before this one.
 *
 * Returns null for an unbounded range: "everything, compared with everything
 * before everything" is not a question, and offering a comparison that cannot
 * mean anything is worse than offering none.
 */
export function previousRange(from, to) {
  if (!isMonth(from) || !isMonth(to)) return null;
  const span = monthSpan(from, to);
  if (span < 1) return null;
  return { from: shiftMonth(from, -span), to: shiftMonth(to, -span) };
}

/**
 * The choices, built from the months the run actually holds.
 *
 * Years are not hardcoded and not derived from today's date. A run whose
 * newest data is from March offers no April, because offering a period the
 * data cannot fill produces an empty chart that reads as a collapse in trade.
 */
export function rangeChoices(months) {
  const list = [...(months ?? [])].filter(isMonth).sort();
  if (!list.length) return [{ key: "all", label: "All time", from: null, to: null }];

  const newest = list[list.length - 1];
  const years = [...new Set(list.map((m) => m.slice(0, 4)))].sort().reverse();

  const rolling = [3, 6, 12]
    .map((n) => ({
      key: `last${n}`,
      label: n === 12 ? "Last 12 months" : `Last ${n} months`,
      from: shiftMonth(newest, -(n - 1)),
      to: newest,
    }))
    // A rolling window wider than the data is the same as "all time" wearing a
    // different name, and two controls that do the same thing invite the reader
    // to look for the difference.
    .filter((r) => r.from >= list[0]);

  return [
    { key: "all", label: "All time", from: null, to: null },
    { key: "thisMonth", label: `${newest} only`, from: newest, to: newest },
    ...rolling,
    ...years.map((y) => ({
      key: `y${y}`,
      label: y,
      from: `${y}-01`,
      to: `${y}-12`,
    })),
  ];
}

/** Whichever choice matches the current bounds, or null when they are custom. */
export function matchChoice(choices, from, to) {
  return choices.find((c) => (c.from ?? null) === (from ?? null) && (c.to ?? null) === (to ?? null)) ?? null;
}

/** A signed change, or null when there is nothing to compare against. */
export function delta(now, before) {
  if (before == null || now == null) return null;
  if (!before) return null;
  return ((now - before) / before) * 100;
}
