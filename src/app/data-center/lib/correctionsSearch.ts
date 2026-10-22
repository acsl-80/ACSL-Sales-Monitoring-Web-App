/**
 * What narrows the sent-back list, read from a URL (D67).
 *
 * Shared by the list's route and the workspace's, so "next record" walks the
 * same list the person opened the record from. Held here rather than in a
 * route file, which should export its Route and nothing a second file needs.
 */
export type CorrectionsNarrowing = {
  /** The rep's name folded to lower case, as routing keys it. */
  rep?: string;
  partner?: string;
  /** The reason's option id. */
  reason?: string;
  /** Serial, transaction, name or phone. */
  q?: string;
  /** Only what is routed to the signed-in person. */
  mine?: boolean;
};

/*
 * The router's default parser reads `?q=101093799` as JSON, so a stove ID in a
 * link arrives as a number. Every stove ID is digits, and dropping it lost the
 * search from every link that carried one (D69).
 */
const short = (v: unknown, max: number) => {
  const t = typeof v === "number" && Number.isFinite(v) ? String(v) : v;
  return typeof t === "string" && t.trim() ? t.trim().slice(0, max) : undefined;
};

export const narrowingFrom = (search: Record<string, unknown>): CorrectionsNarrowing => ({
  rep: short(search.rep, 120),
  partner: short(search.partner, 200),
  reason: short(search.reason, 40),
  q: short(search.q, 80),
  mine: search.mine === true || search.mine === "1" || search.mine === "true" ? true : undefined,
});
