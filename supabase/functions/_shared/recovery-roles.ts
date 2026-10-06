/**
 * What each Recovery access level can do.
 *
 * The one definition, imported by every `recovery*` edge function. The Data
 * Center learned what three copies of this table cost (a level added in two of
 * them behaved differently depending on which endpoint you reached), so it is
 * never copied. `src/app/recovery/lib/features.ts` holds labels only; if the
 * two ever disagree, this file wins.
 *
 * A level is a starting set. `recovery.feature_grants` adds keys per person on
 * top; nothing subtracts. A granted key this file does not know is ignored,
 * so a typo in a grant row gives nobody anything.
 *
 * Not to be confused with the sales-app role `recoverer` in
 * `public.profiles.role`. That says what kind of account a person holds; these
 * levels say what they may do inside Recovery. See src/app/recovery/PLAN.md.
 */

export const RECOVERY_FEATURES = [
  "recovery.view",
  "recovery.edit",
  "recovery.import",
  "recovery.assign",
] as const;

export type RecoveryFeature = (typeof RECOVERY_FEATURES)[number];

export type RecoveryAccessLevel = "viewer" | "recovery_agent" | "data_manager";

export const LEVEL_FEATURES: Record<RecoveryAccessLevel, RecoveryFeature[]> = {
  viewer: ["recovery.view"],
  recovery_agent: ["recovery.view", "recovery.edit"],
  data_manager: ["recovery.view", "recovery.edit", "recovery.import", "recovery.assign"],
};

const KNOWN = new Set<string>(RECOVERY_FEATURES);

function isLevel(value: string | null): value is RecoveryAccessLevel {
  return value !== null && Object.prototype.hasOwnProperty.call(LEVEL_FEATURES, value);
}

/**
 * The keys a person holds: their level's, plus what was granted to them, minus
 * anything this file does not recognise. No level and no grants is no keys.
 */
export function featuresFor(
  level: string | null,
  grants: readonly string[] = [],
): RecoveryFeature[] {
  const fromLevel = isLevel(level) ? LEVEL_FEATURES[level] : [];
  const keys = new Set<string>([...fromLevel, ...grants.filter((g) => KNOWN.has(g))]);
  return RECOVERY_FEATURES.filter((k) => keys.has(k));
}

/** Only the literal `super_admin` holds Recovery without a row, as in the Data Center. */
export function isSuperAdmin(role: string | null | undefined): boolean {
  return role === "super_admin";
}
