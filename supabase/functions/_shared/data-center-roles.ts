/**
 * What each Data Center access level can do.
 *
 * This was copied verbatim into `data-center-read`, `data-center-write` and
 * `data-center-import`. Three copies of an access-control table is three
 * chances for them to disagree, and the disagreement is silent: a role added
 * in two of the three simply behaves differently depending on which endpoint
 * you reach it through.
 *
 * One definition, imported. Adding a level is one edit here.
 *
 * A level is a starting set, not a ceiling. `feature_grants` adds keys per
 * user on top, so an individual can hold something their level does not imply.
 * Nothing subtracts: a level's keys are always granted.
 */

/** Everything a Data Center user can be granted. Keep in step with `lib/features.ts`. */
export type FeatureKey =
  | "records.view"
  | "call_records.view"
  | "call_records.edit"
  | "dashboard.view"
  | "import.upload"
  | "import.exceptions"
  | "import.commit"
  | "registry.manage"
  | "access.manage"
  /** Work the digitalisation workbench: open a stove and type its sale. */
  | "digitisation.work"
  /**
   * Hand work to call agents and take it back.
   *
   * Its own key because assignment was reachable only by a super admin, which
   * put "reassign Hanifa's queue, she is on leave" on the same shoulder as
   * running the company's user accounts.
   */
  | "assignment.manage";

export type AccessRole = "viewer" | "editor" | "call_agent" | "data_manager";

const VIEWER: FeatureKey[] = ["records.view", "call_records.view", "dashboard.view"];

export const ROLE_FEATURES: Record<string, FeatureKey[]> = {
  viewer: VIEWER,

  editor: [
    ...VIEWER,
    "call_records.edit",
    "import.upload",
    "import.exceptions",
    // The workbench is the same act as an upload at a different speed, so the
    // level that may upload may also type. Confirming is still not theirs:
    // import.commit is what releases a record, and it stays separate.
    "digitisation.work",
  ],

  /**
   * A call agent works the phone and nothing else.
   *
   * They edit call records, which is the job, and read the records behind
   * them, which is how they know who to ring. They import nothing: a person
   * paid to make calls has no reason to move stock, and `import.upload` is one
   * step from `import.commit`, which changes the sales app's own inventory.
   *
   * Deliberately not a superset of editor and not a subset either. It is a
   * different job, so it gets a different set rather than a rung on a ladder.
   */
  call_agent: [...VIEWER, "call_records.edit"],

  /**
   * The person who runs the module.
   *
   * Everything inside it: the calling, the records, both ways of getting a
   * paper receipt into the system, the decision to release what has been
   * entered, and deciding who calls whom.
   *
   * `grants.manage` is deliberately withheld. Deciding who may enter the
   * module at all is account administration rather than data management, and
   * a level that can grant itself more is not a level. A super admin can still
   * add it to one person by hand if a particular team needs it.
   */
  data_manager: [
    ...VIEWER,
    "call_records.edit",
    "import.upload",
    "import.exceptions",
    "import.commit",
    "digitisation.work",
    "assignment.manage",
    "registry.manage",
  ],
};

/** The keys a level implies, plus whatever was granted to the user directly. */
export function featuresFor(
  accessRole: string | null,
  grants: readonly string[] = [],
): string[] {
  if (!accessRole) return [...new Set(grants)];
  return [...new Set([...(ROLE_FEATURES[accessRole] ?? []), ...grants])];
}
