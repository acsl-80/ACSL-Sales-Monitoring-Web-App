/**
 * One way to say an amount of money in the host app.
 *
 * Slice 8a of the 2026-09-02 review (finding F27). Sixteen local copies of
 * formatCurrency and a dozen raw templates rendered naira six ways: a prefix
 * with en-NG grouping, the same with no locale at all, Intl currency style
 * with two decimals, with none, on en-US ("NGN 43,000.00"), and once with no
 * symbol. Several had no guard, so a missing amount printed "₦NaN" or
 * "₦undefined", and one threw and took its table down.
 *
 * One rendering now: the naira sign, en-NG grouping, decimals only when the
 * amount has them. ₦43,000 and ₦43,000.50, never ₦43,000.00 for a whole
 * amount and never ₦NaN. Anything empty or unparseable returns `empty`, which
 * a caller sets to what its screen has always shown.
 */

export type FormatCurrencyOptions = {
  /** What to show for nothing or for a value that is not an amount. */
  empty?: string;
};

const NAIRA = new Intl.NumberFormat("en-NG", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

/** The value as a number of naira, or null when it is nothing or not a number. */
export function toAmount(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n =
    typeof value === "number" ? value : Number(String(value).replace(/[₦,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function formatCurrency(value: unknown, { empty = "N/A" }: FormatCurrencyOptions = {}): string {
  const n = toAmount(value);
  if (n == null) return empty;
  return n < 0 ? `-₦${NAIRA.format(-n)}` : `₦${NAIRA.format(n)}`;
}
