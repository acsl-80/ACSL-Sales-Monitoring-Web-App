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
  /**
   * Grant and revoke tier-2 features for other users.
   *
   * This was typed as `access.manage` while every other file - the admin edge
   * function's own gate, the Settings page, the Explore card, two e2e specs
   * and the data_manager comment thirty lines below - used `grants.manage`.
   * So the typed key was granted by no level and offerable by no UI, and the
   * key doing the actual work was not in the type at all. Renamed rather than
   * a second key added: there was only ever one permission here.
   */
  | "grants.manage"
  /** Work the digitalisation workbench: open a stove and type its sale. */
  | "digitisation.work"
  /**
   * Hand work to call agents and take it back.
   *
   * Its own key because assignment was reachable only by a super admin, which
   * put "reassign Hanifa's queue, she is on leave" on the same shoulder as
   * running the company's user accounts.
   */
  | "assignment.manage"
  /**
   * See the records sent back to you, and close them.
   *
   * Held by whoever treats send-backs - the people named in Settings, and the
   * sales reps whose consignments the records came from. It is deliberately
   * the narrowest key in the list: a sales rep needs to see the stoves they
   * are being asked about and say what they did, and nothing else about the
   * module concerns them.
   */
  | "corrections.fix"
  /**
   * Decide who send-backs reach.
   *
   * Choosing the standing recipients, and linking an ERP rep name to an app
   * account. Separate from `corrections.fix` because treating a send-back and
   * deciding who receives them are different jobs, and the second one changes
   * where everybody else's work lands.
   */
  | "corrections.route"
  /**
   * Read the Analysis area.
   *
   * Its own key rather than `dashboard.view`, which every level holds. The
   * Dashboard counts states. Analysis crosses what a buyer told an agent on
   * the phone with the partner and the place they bought in, and the module
   * already keeps Table 1 and Table 2 as separate grants for exactly that
   * reason: seeing sold stove records does not imply seeing what the call
   * centre wrote about the people who bought them, and it implies aggregating
   * it even less.
   */
  | "analysis.view";

export type AccessRole =
  | "viewer"
  | "editor"
  | "call_agent"
  | "data_manager"
  /**
   * Somebody who sells, granted nothing but their own send-backs.
   *
   * A sales rep is a sales-app user who has no business in this module except
   * that records from their consignments come back needing an answer. Giving
   * them `viewer` to achieve that would hand them every sold stove record in
   * their scope to solve a problem about eleven of them.
   */
  | "sales_rep";

const VIEWER: FeatureKey[] = ["records.view", "call_records.view", "dashboard.view"];

export const ROLE_FEATURES: Record<string, FeatureKey[]> = {
  viewer: VIEWER,

  editor: [
    ...VIEWER,
    "call_records.edit",
    // An editor already types and corrects records; a send-back is a record
    // with a question attached, so closing one is the same job.
    "corrections.fix",
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
   * The narrowest level there is: your own send-backs and nothing else.
   *
   * Not a rung below viewer - a different job entirely. They see the records
   * their consignments produced a question about, and they answer. What they
   * can see is narrowed again at read time to send-backs routed to them, so
   * this key alone shows one rep nothing about another rep's stoves.
   */
  sales_rep: ["corrections.fix"],

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
    "corrections.fix",
    "corrections.route",
    // The person who runs the module is the person the findings are for.
    // Nobody else's level implies it, so everybody else needs it granted by
    // hand - which keeps the blast radius of a new area at zero until
    // somebody decides otherwise.
    "analysis.view",
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
