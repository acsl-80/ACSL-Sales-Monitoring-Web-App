/**
 * "1 sale", "12 sales".
 *
 * The module said "1 record(s)" and "1 sales" in nine places. A count is the
 * most common thing an operations screen prints, and a parenthesised (s) is the
 * mark of an interface nobody finished.
 */
const NUMBER = new Intl.NumberFormat("en-NG");

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${NUMBER.format(n)} ${n === 1 ? one : many}`;
}
