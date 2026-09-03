/**
 * What a call record's outcome is called on screen, and how it is toned.
 *
 * Slice 7a of the 2026-09-02 review. Before this the queue, the editor, the
 * assignment log, My Work, the scorecards and the partner screens each said
 * it differently: "fully verified" with the underscore stripped here,
 * "Unverified" there, "not verified" for a record that did not exist, and an
 * unreachable pill with no tone at all because its map had no key for it.
 * "Unverified" meant partly verified on one screen and not yet verified on
 * another.
 *
 * Decided with Orezi on 2026-09-03: one word per data state.
 *
 *   fully_verified                 Verified
 *   partially_verified             Partly verified
 *   unreachable                    Unreachable
 *   not_verified, or no record     Yet to be resolved
 *
 * A draft is an "unfinished" badge, never a status. A send-back is a flag
 * beside the outcome, never a fifth state. The scorecard groups keep their
 * keys (verified, unverified, unreachable, unresolved) because the URLs and
 * the read API carry them; only their words change here.
 */

export type Outcome = "fully_verified" | "partially_verified" | "unreachable" | "not_verified";

export const OUTCOME_WORDS: Record<Outcome, string> = {
  fully_verified: "Verified",
  partially_verified: "Partly verified",
  unreachable: "Unreachable",
  not_verified: "Yet to be resolved",
};

const asOutcome = (value: unknown): Outcome =>
  value && Object.prototype.hasOwnProperty.call(OUTCOME_WORDS, String(value))
    ? (String(value) as Outcome)
    : "not_verified";

/** The word for an outcome; null, undefined and unknown values read as not yet resolved. */
export function outcomeLabel(value: unknown): string {
  return OUTCOME_WORDS[asOutcome(value)];
}

/** Pill tone: background and text, for a rounded badge. */
export const OUTCOME_PILL: Record<Outcome, string> = {
  fully_verified: "bg-(--dc-primary)/10 text-(--dc-accent)",
  partially_verified: "bg-amber-100 text-amber-800",
  unreachable: "bg-orange-100 text-orange-800",
  not_verified: "bg-gray-100 text-gray-600",
};

/** Text tone, for a table cell. */
export const OUTCOME_TEXT: Record<Outcome, string> = {
  fully_verified: "text-(--dc-accent)",
  partially_verified: "text-amber-700",
  unreachable: "text-orange-700",
  not_verified: "text-gray-500",
};

/** Bar tone, for a chart segment. */
export const OUTCOME_BAR: Record<Outcome, string> = {
  fully_verified: "bg-(--dc-primary)",
  partially_verified: "bg-amber-500",
  unreachable: "bg-orange-500",
  not_verified: "bg-gray-400",
};

export const outcomePill = (value: unknown): string => OUTCOME_PILL[asOutcome(value)];
export const outcomeText = (value: unknown): string => OUTCOME_TEXT[asOutcome(value)];
export const outcomeBar = (value: unknown): string => OUTCOME_BAR[asOutcome(value)];

/** The scorecard groups, said the same way. */
export const GROUP_WORDS: Record<string, string> = {
  verified: "Verified",
  unverified: "Partly verified",
  unreachable: "Unreachable",
  unresolved: "Yet to be resolved",
};

/** A send-back's state, as a flag beside the outcome. */
export const CORRECTION_WORDS: Record<string, string> = {
  open: "Sent back",
  resolved: "Fixed",
  none: "",
};

/** An assignment batch's state. */
export const BATCH_STATE_WORDS: Record<string, string> = {
  open: "Open",
  completed: "Complete",
  reclaimed: "Reclaimed",
};

/**
 * Words for any enum a screen might print: the outcomes and groups above,
 * the two other families the dashboard bars carry, and, for anything else,
 * the value with its underscores turned to spaces rather than the raw key.
 */
export function wordsFor(value: unknown): string {
  if (value == null || value === "") return "";
  const key = String(value);
  if (Object.prototype.hasOwnProperty.call(OUTCOME_WORDS, key)) return OUTCOME_WORDS[key as Outcome];
  if (Object.prototype.hasOwnProperty.call(GROUP_WORDS, key)) return GROUP_WORDS[key];
  if (Object.prototype.hasOwnProperty.call(BATCH_STATE_WORDS, key)) return BATCH_STATE_WORDS[key];
  if (key === "never_called") return "Never called";
  return key.replace(/_/g, " ");
}
