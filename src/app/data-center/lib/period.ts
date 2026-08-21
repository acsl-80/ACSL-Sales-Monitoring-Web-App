/**
 * One definition of "when", for every surface in the module.
 *
 * Each table grew its own idea of a date filter: the records table has two
 * bare date inputs, the assignment log has two more, the sheet has a month
 * dropdown, and Partner Records had nothing at all. Four controls, four
 * vocabularies, and no way to ask the same question of two of them - which is
 * how you end up with a partner scorecard covering all time sitting next to a
 * record list covering last week and nobody noticing.
 *
 * So: one set of periods, resolved to the two values every surface already
 * speaks, `dateFrom` and `dateTo`. Adding the control to a surface is wiring,
 * not a new server contract.
 *
 * Everything here is deliberately dependency-free and pure. Dates are the
 * classic place to be off by a day at a boundary, and a pure function over an
 * injected "today" is something you can actually check.
 */

export type PeriodKey =
  | "today"
  | "last7"
  | "last30"
  | "thisMonth"
  | "lastMonth"
  | "thisQuarter"
  | "last6"
  | "thisYear"
  | "lastYear"
  | "years"
  | "custom"
  | "all";

export type Period = {
  key: PeriodKey;
  /** Only for `years`. Whole calendar years, in any order. */
  years?: number[];
  /** Only for `custom`. YYYY-MM-DD. */
  from?: string;
  to?: string;
};

export type ResolvedPeriod = {
  /** YYYY-MM-DD, inclusive. Undefined means unbounded on that side. */
  dateFrom?: string;
  dateTo?: string;
  /** How the chip reads: a phrase that completes "showing ...". */
  label: string;
  /**
   * Said out loud when the range covers more than the words suggest. Picking
   * 2024 and 2026 asks for a range, and a range contains 2025.
   */
  caveat?: string;
};

/** The default. A year of work is what people mean by "the numbers". */
export const DEFAULT_PERIOD: Period = { key: "thisYear" };

/** Local calendar date, not UTC: "today" means the user's today. */
export function iso(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function daysBack(today: Date, days: number): Date {
  const d = new Date(today);
  d.setDate(d.getDate() - days);
  return d;
}

function monthsBack(today: Date, months: number): Date {
  const d = new Date(today);
  d.setMonth(d.getMonth() - months);
  return d;
}

const MONTH_NAME = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export const PERIOD_CHOICES: { key: PeriodKey; label: string; group: string }[] = [
  { key: "today", label: "Today", group: "Days" },
  { key: "last7", label: "Last 7 days", group: "Days" },
  { key: "last30", label: "Last 30 days", group: "Days" },
  { key: "thisMonth", label: "This month", group: "Months" },
  { key: "lastMonth", label: "Last month", group: "Months" },
  { key: "thisQuarter", label: "This quarter", group: "Months" },
  { key: "last6", label: "Last 6 months", group: "Months" },
  { key: "thisYear", label: "This year", group: "Years" },
  { key: "lastYear", label: "Last year", group: "Years" },
  { key: "years", label: "Pick years", group: "Years" },
  { key: "custom", label: "Custom range", group: "Anything else" },
  { key: "all", label: "Everything", group: "Anything else" },
];

/**
 * A period, turned into the two dates the server filters on.
 *
 * `today` is a parameter so this is testable and so a page rendered at 23:59
 * cannot disagree with the request it sends at 00:00.
 */
export function resolvePeriod(period: Period, today: Date = new Date()): ResolvedPeriod {
  const y = today.getFullYear();

  switch (period.key) {
    case "today":
      return { dateFrom: iso(today), dateTo: iso(today), label: "today" };

    case "last7":
      return {
        dateFrom: iso(daysBack(today, 6)),
        dateTo: iso(today),
        label: "the last 7 days",
      };

    case "last30":
      return {
        dateFrom: iso(daysBack(today, 29)),
        dateTo: iso(today),
        label: "the last 30 days",
      };

    case "thisMonth":
      return {
        dateFrom: iso(new Date(y, today.getMonth(), 1)),
        dateTo: iso(new Date(y, today.getMonth() + 1, 0)),
        label: `${MONTH_NAME[today.getMonth()]} ${y}`,
      };

    case "lastMonth": {
      const first = new Date(y, today.getMonth() - 1, 1);
      return {
        dateFrom: iso(first),
        dateTo: iso(new Date(first.getFullYear(), first.getMonth() + 1, 0)),
        label: `${MONTH_NAME[first.getMonth()]} ${first.getFullYear()}`,
      };
    }

    case "thisQuarter": {
      const q = Math.floor(today.getMonth() / 3);
      return {
        dateFrom: iso(new Date(y, q * 3, 1)),
        dateTo: iso(new Date(y, q * 3 + 3, 0)),
        label: `Q${q + 1} ${y}`,
      };
    }

    case "last6":
      return {
        // Five months back to the first of that month, so "last 6 months"
        // is six whole months rather than five and a fraction.
        dateFrom: iso(new Date(monthsBack(today, 5).getFullYear(), monthsBack(today, 5).getMonth(), 1)),
        dateTo: iso(today),
        label: "the last 6 months",
      };

    case "thisYear":
      return {
        dateFrom: `${y}-01-01`,
        dateTo: `${y}-12-31`,
        label: String(y),
      };

    case "lastYear":
      return {
        dateFrom: `${y - 1}-01-01`,
        dateTo: `${y - 1}-12-31`,
        label: String(y - 1),
      };

    case "years": {
      const picked = [...new Set(period.years ?? [])].sort((a, b) => a - b);
      if (picked.length === 0) return resolvePeriod({ key: "thisYear" }, today);
      const first = picked[0];
      const last = picked[picked.length - 1];
      const contiguous = last - first + 1 === picked.length;
      return {
        dateFrom: `${first}-01-01`,
        dateTo: `${last}-12-31`,
        label: picked.length === 1 ? String(first) : picked.join(", "),
        /**
         * Said rather than glossed over. A date range is a range; it cannot
         * skip a year in the middle, and a filter that silently included a
         * year nobody asked for would be found much later, in a total that
         * would not add up.
         */
        caveat: contiguous
          ? undefined
          : `A range runs end to end, so ${first} to ${last} includes ${
              Array.from({ length: last - first + 1 }, (_, i) => first + i)
                .filter((v) => !picked.includes(v))
                .join(", ")
            } as well.`,
      };
    }

    case "custom": {
      if (!period.from && !period.to) return { label: "any date" };
      return {
        dateFrom: period.from,
        dateTo: period.to,
        label: period.from && period.to
          ? `${period.from} to ${period.to}`
          : period.from
            ? `from ${period.from}`
            : `up to ${period.to}`,
      };
    }

    case "all":
    default:
      return { label: "every date" };
  }
}

/**
 * The years worth offering.
 *
 * From the earliest date the data actually holds to this year, newest first,
 * because the recent ones are the ones people pick. A register that starts in
 * 2023 should not offer 2019: an empty year on a menu reads as a year with no
 * sales rather than a year that never existed.
 */
export function yearsAvailable(earliest: string | null, today: Date = new Date()): number[] {
  const now = today.getFullYear();
  const start = earliest ? new Date(earliest).getFullYear() : now;
  const from = Number.isFinite(start) && start <= now ? start : now;
  const out: number[] = [];
  for (let y = now; y >= from; y -= 1) out.push(y);
  return out;
}

/* ------------------------------------------------------------ the wire */

/**
 * A period as one URL parameter.
 *
 * The module's rule is that a narrowed view is a URL, never component state,
 * so back restores it and a colleague can be sent the thing you are looking
 * at. A period is four values, and four parameters on five routes is twenty
 * declarations that have to agree. One string is one parser.
 *
 *   thisYear
 *   years:2024,2026
 *   custom:2026-03-01..2026-03-31
 */
export function encodePeriod(period: Period): string | undefined {
  if (period.key === "thisYear") return undefined; // the default needs no URL
  if (period.key === "years") {
    const ys = [...new Set(period.years ?? [])].sort((a, b) => a - b);
    return ys.length ? `years:${ys.join(",")}` : undefined;
  }
  if (period.key === "custom") {
    if (!period.from && !period.to) return undefined;
    return `custom:${period.from ?? ""}..${period.to ?? ""}`;
  }
  return period.key;
}

const SIMPLE = new Set<PeriodKey>([
  "today", "last7", "last30", "thisMonth", "lastMonth",
  "thisQuarter", "last6", "thisYear", "lastYear", "all",
]);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Anything unrecognised falls back to the default rather than throwing. */
export function decodePeriod(raw: unknown): Period {
  if (typeof raw !== "string" || raw === "") return DEFAULT_PERIOD;

  if (raw.startsWith("years:")) {
    const years = raw
      .slice(6)
      .split(",")
      .map((v) => Number(v.trim()))
      .filter((v) => Number.isInteger(v) && v >= 1970 && v <= 2999);
    return years.length ? { key: "years", years } : DEFAULT_PERIOD;
  }

  if (raw.startsWith("custom:")) {
    const [from, to] = raw.slice(7).split("..");
    const ok = (v: string) => (ISO_DATE.test(v) ? v : undefined);
    const f = ok(from ?? "");
    const t = ok(to ?? "");
    return f || t ? { key: "custom", from: f, to: t } : DEFAULT_PERIOD;
  }

  return SIMPLE.has(raw as PeriodKey) ? { key: raw as PeriodKey } : DEFAULT_PERIOD;
}
