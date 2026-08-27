/**
 * One name, one definition, one scope for every number this module shows.
 *
 * WHY THIS FILE EXISTS
 *
 * Four surfaces showed four stove counts and a reader could not tell whether
 * they disagreed or measured different things. They measured different things,
 * mostly, but nothing on screen said so - and the same measure carried
 * different names on different pages: "Transferred to partners" on the
 * dashboard was "Issued" on Partner Records and in every scorecard, and "Fully
 * verified" was "Verified" everywhere else.
 *
 * Two names for one number is worse than a wrong number, because a wrong
 * number gets questioned. Renaming is cheap; the confusion it causes is not,
 * and it recurs every time somebody new reads the page.
 *
 * So the vocabulary lives here and the surfaces import it. A measure is
 * renamed once, in one place, and every page follows.
 *
 * SCOPE IS PART OF THE NAME
 *
 * Most of the confusion was not the noun, it was the silent population behind
 * it. "Issued" over all time and "Issued" in the selected period are different
 * numbers and both are correct. Pairing every figure with its scope is what
 * lets somebody reconcile two pages instead of filing a bug.
 */

export type ScopeKey = "allTime" | "period" | "now";

/** How a figure's population is described, in the same words everywhere. */
export const SCOPES: Record<ScopeKey, string> = {
  allTime: "all time",
  period: "in the period shown",
  now: "right now",
};

export type Measure = {
  /** The canonical name. The only name this measure is given anywhere. */
  label: string;
  /** One sentence, plain, for a tooltip or a hint line. */
  definition: string;
};

export const MEASURES = {
  issued: {
    label: "Issued",
    definition:
      "Stoves sent to partners on consignments, whether or not they have since sold. Was called 'Transferred to partners' on the dashboard and 'Issued' everywhere else; it is one number.",
  },
  received: {
    label: "Received",
    definition:
      "Paper records returned from the field for those stoves. Falls back to the digitalised count where no envelope was logged.",
  },
  digitalised: {
    label: "Digitalised",
    definition: "Receipts typed into the system, from a sheet or the bench.",
  },
  verified: {
    label: "Verified",
    definition:
      "Records the call centre confirmed with the end user. Was called 'Fully verified' on the dashboard.",
  },
  unverified: {
    label: "Unverified",
    definition: "Received and called, but not confirmed.",
  },
  unreachable: {
    label: "Unreachable",
    definition: "Called the agreed number of times and never reached.",
  },
  unresolved: {
    label: "Yet to be resolved",
    definition: "Digitalised but with no outcome yet. Still somebody's work.",
  },
  outstanding: {
    label: "Outstanding",
    definition: "Issued minus digitalised. Sold on paper, not yet typed in.",
  },
  sold: {
    label: "Sold",
    definition: "Sales recorded in the sales app, cancelled ones excluded.",
  },
  unsoldAtPartners: {
    label: "Unsold at partners",
    definition:
      "Stoves shipped to a partner and not yet sold. Larger than Issued minus Sold, because some stock rows are named by no consignment.",
  },
  creditable: {
    label: "Creditable",
    definition:
      "Verified, complete, stove ID confirmed, no double count, no unconfirmed shared phone. The only records worth anything to a carbon buyer.",
  },
} as const satisfies Record<string, Measure>;

export type MeasureKey = keyof typeof MEASURES;

/**
 * "Issued · all time". The separator is a middot rather than a bracket so the
 * scope reads as part of the name and not as an aside.
 */
export function withScope(key: MeasureKey, scope: ScopeKey): string {
  return `${MEASURES[key].label} · ${SCOPES[scope]}`;
}

/** The definition and the scope together, for a `title` attribute. */
export function explain(key: MeasureKey, scope: ScopeKey): string {
  return `${MEASURES[key].definition} Counted ${SCOPES[scope]}.`;
}
