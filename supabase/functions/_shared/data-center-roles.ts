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
  | "access.manage";

export type AccessRole = "viewer" | "editor" | "call_agent";

const VIEWER: FeatureKey[] = ["records.view", "call_records.view", "dashboard.view"];

export const ROLE_FEATURES: Record<string, FeatureKey[]> = {
  viewer: VIEWER,

  editor: [
    ...VIEWER,
    "call_records.edit",
    "import.upload",
    "import.exceptions",
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
};

/** The keys a level implies, plus whatever was granted to the user directly. */
export function featuresFor(
  accessRole: string | null,
  grants: readonly string[] = [],
): string[] {
  if (!accessRole) return [...new Set(grants)];
  return [...new Set([...(ROLE_FEATURES[accessRole] ?? []), ...grants])];
}
