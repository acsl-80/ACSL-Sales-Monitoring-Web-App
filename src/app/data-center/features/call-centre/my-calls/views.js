import { STANDING_WORDS } from "../../../lib/outcome";

/**
 * The seven views of My calls (Phase 28, D45).
 *
 * Each view is a set of standings, read from the `standing` the server puts
 * on every held record (D41), so the page never derives "verified" or "new"
 * itself. New is the working surface and the default; Others is exactly
 * `in_progress`: called, not concluded, not with Sales. All is everything the
 * agent holds. The keys are what the URL carries in `view`.
 */
export const MY_VIEWS = [
  { key: "new", label: STANDING_WORDS.never_called, standings: ["never_called"], count: null },
  { key: "verified", label: STANDING_WORDS.verified, standings: ["verified"], count: "verified" },
  { key: "partially_verified", label: STANDING_WORDS.partially_verified, standings: ["partially_verified"], count: "partially_verified" },
  { key: "unreachable", label: STANDING_WORDS.unreachable, standings: ["unreachable"], count: "unreachable" },
  { key: "with_sales", label: STANDING_WORDS.with_sales, standings: ["with_sales"], count: "with_sales" },
  { key: "others", label: "Others", standings: ["in_progress"], count: "others" },
  { key: "all", label: "All", standings: null, count: "all" },
];

export const DEFAULT_VIEW = "new";
export const VIEW_KEYS = MY_VIEWS.map((v) => v.key);

/** The view for a key, New when the key is unknown or absent. */
export function viewFor(key) {
  return MY_VIEWS.find((v) => v.key === key) ?? MY_VIEWS[0];
}

/** The held records that belong in a view. */
export function itemsIn(view, items) {
  if (!view.standings) return items;
  return items.filter((i) => view.standings.includes(i.standing));
}
