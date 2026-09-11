import { STANDING_WORDS } from "../../../lib/outcome";

/**
 * How the records an agent holds are grouped on My calls (Phase 28, D45,
 * re-cut by D49).
 *
 * Three groups, read from the `standing` the server puts on every held
 * record (D41), so the page never derives "verified" or "new" itself:
 *
 *   new        the working surface: never called
 *   callbacks  called, not concluded: callbacks with a time and the other
 *              numbers to try again (standing in_progress)
 *   concluded  verified, partly verified, unreachable, with Sales, folded
 *              at the bottom and openable for a revisit
 *
 * `CONCLUDED_VIEWS` are the chips inside the folded area; their keys are
 * what the URL carries in `view`.
 */
export const CONCLUDED_VIEWS = [
  { key: "verified", label: STANDING_WORDS.verified, standings: ["verified"], count: "verified" },
  { key: "partially_verified", label: STANDING_WORDS.partially_verified, standings: ["partially_verified"], count: "partially_verified" },
  { key: "unreachable", label: STANDING_WORDS.unreachable, standings: ["unreachable"], count: "unreachable" },
  { key: "with_sales", label: STANDING_WORDS.with_sales, standings: ["with_sales"], count: "with_sales" },
];
export const CONCLUDED_STANDINGS = CONCLUDED_VIEWS.flatMap((v) => v.standings);

/** The chips of the counts strip: the concluded views, then Others and All. */
export const COUNT_COLUMNS = [
  ...CONCLUDED_VIEWS,
  { key: "others", label: "Others", count: "others" },
  { key: "all", label: "All", count: "all" },
];

export const viewFor = (key) => CONCLUDED_VIEWS.find((v) => v.key === key) ?? null;
export const isNew = (i) => i.standing === "never_called";
export const isCallback = (i) => i.standing === "in_progress";
export const isConcluded = (i) => CONCLUDED_STANDINGS.includes(i.standing);
export const itemsIn = (view, items) => items.filter((i) => view.standings.includes(i.standing));
