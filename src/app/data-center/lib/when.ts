/**
 * Dates and times, said one way across the module.
 *
 * Slice 7a of the 2026-09-02 review. Every screen had its own one-liner,
 * some twenty of them, each calling toLocaleDateString or toLocaleString with
 * no locale and no zone. A call logged at 22:30 UTC on the 5th is 23:30 on
 * the 5th in Lagos and shows as the 6th on a browser set to Asia; the
 * attempt row showed the date alone, so two calls on one day were told apart
 * by nothing. Times here are the business's: Africa/Lagos, the Nigerian
 * English locale, 24-hour, and the same shape wherever they appear.
 *
 * Every timestamp the module handles is timestamptz, serialised as ISO with
 * its offset, so the zone below is applied on display and nothing is guessed
 * on the way in. Date-only strings (a sales_date) are formatted on their own
 * calendar day; Lagos sits east of UTC, so midnight UTC is still that day.
 */

const ZONE = "Africa/Lagos";
const LOCALE = "en-NG";

const DATE = new Intl.DateTimeFormat(LOCALE, {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: ZONE,
});

const WHEN = new Intl.DateTimeFormat(LOCALE, {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: ZONE,
});

const TIME = new Intl.DateTimeFormat(LOCALE, {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: ZONE,
});

function toDate(value: unknown): Date | null {
  if (value == null || value === "") return null;
  const d = value instanceof Date ? value : new Date(value as string | number);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "5 Mar 2026"; `empty` when there is no date. */
export function dateOf<E = string>(value: unknown, empty: E | string = "—"): string | E {
  const d = toDate(value);
  return d ? DATE.format(d) : empty;
}

/** "5 Mar 2026, 23:30"; `empty` when there is no time. */
export function whenOf<E = string>(value: unknown, empty: E | string = "—"): string | E {
  const d = toDate(value);
  return d ? WHEN.format(d) : empty;
}

/** "23:30"; `empty` when there is no time. */
export function timeOf<E = string>(value: unknown, empty: E | string = "—"): string | E {
  const d = toDate(value);
  return d ? TIME.format(d) : empty;
}
