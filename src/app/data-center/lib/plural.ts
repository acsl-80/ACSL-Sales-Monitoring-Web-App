/**
 * "1 sale", "12 sales".
 *
 * The module said "1 record(s)" and "1 sales" in nine places. A count is the
 * most common thing an operations screen prints, and a parenthesised (s) is the
 * mark of an interface nobody finished.
 */
const NUMBER = new Intl.NumberFormat("en-NG");

/**
 * Words ending in a sibilant take -es.
 *
 * "1-2 of 2 batchs" shipped, on the confirmation queue, because the default
 * plural was `${one}s` and nothing told it otherwise. Fixing it at the two call
 * sites would have left the next one to find it again, so the rule lives here:
 * -ch, -sh, -s, -x and -z take -es, and everything else keeps the plain -s.
 * Deliberately not -h on its own, or "month" would become "monthes".
 */
function defaultPlural(one: string): string {
  return /(ch|sh|[sxz])$/i.test(one) ? `${one}es` : `${one}s`;
}

export function plural(n: number, one: string, many = defaultPlural(one)): string {
  return `${NUMBER.format(n)} ${n === 1 ? one : many}`;
}
