/**
 * One way to say a date in the host app.
 *
 * Slice 8a of the 2026-09-02 review (finding F27). Thirty-six local copies of
 * formatDate said it thirty-six ways: en-GB on most screens, en-US on the
 * receipt and a dozen modals, the browser's own locale in the downloaded and
 * emailed receipt, and no time zone anywhere, so a timestamp moved a day for
 * a reader abroad. Every copy could print the literal "Invalid Date", because
 * a try/catch around toLocaleDateString catches nothing: the call succeeds and
 * returns that string. Only one copy guarded with Number.isNaN, and that is
 * the shape this keeps.
 *
 * en-GB, Africa/Lagos, three shapes and an optional time:
 *
 *   numeric   31/08/2026
 *   short     31 Aug 2026            (the default)
 *   long      31 August 2026
 *   time      31 Aug 2026, 14:30     (24-hour)
 *
 * A date-only string is formatted on its own calendar day: Lagos sits east of
 * UTC, so midnight UTC is still that day. Anything empty or unparseable
 * returns `empty`, which a caller sets to what its screen has always shown.
 */

export type DateStyle = "numeric" | "short" | "long";

export type FormatDateOptions = {
  /** What to show for nothing or for a value that is not a date. */
  empty?: string;
  style?: DateStyle;
  /** Append the time of day. */
  time?: boolean;
};

const ZONE = "Africa/Lagos";
const LOCALE = "en-GB";

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(style: DateStyle, time: boolean): Intl.DateTimeFormat {
  const key = `${style}:${time ? "t" : "d"}`;
  let f = formatters.get(key);
  if (!f) {
    const options: Intl.DateTimeFormatOptions = {
      timeZone: ZONE,
      year: "numeric",
      month: style === "numeric" ? "2-digit" : style === "long" ? "long" : "short",
      day: style === "long" ? "numeric" : "2-digit",
    };
    if (time) {
      options.hour = "2-digit";
      options.minute = "2-digit";
      options.hour12 = false;
    }
    f = new Intl.DateTimeFormat(LOCALE, options);
    formatters.set(key, f);
  }
  return f;
}

/** The value as a Date, or null when it is nothing or not a date. */
export function toDate(value: unknown): Date | null {
  if (value == null || value === "") return null;
  const d = value instanceof Date ? value : new Date(value as string | number);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDate(
  value: unknown,
  { empty = "N/A", style = "short", time = false }: FormatDateOptions = {},
): string {
  const d = toDate(value);
  return d ? formatterFor(style, time).format(d) : empty;
}

/** The same, with the time of day. */
export function formatDateTime(value: unknown, options: FormatDateOptions = {}): string {
  return formatDate(value, { ...options, time: true });
}
