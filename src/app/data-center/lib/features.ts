/**
 * Tier 2 of the Data Center permission model.
 *
 * Tier 1 decides whether the module exists for a user at all, and lives in the
 * host app's static route map (`src/lib/permissions.ts`, route key
 * `data-center`). Tier 2 decides what they can do once inside, and lives in
 * `data_center.feature_grants` as data, because "different features for
 * different users" cannot be expressed by a compile-time role map without a
 * redeploy per user.
 *
 * These keys are the contract between the UI and the edge function. The UI uses
 * them to decide what to render; the edge function uses the same strings to
 * decide what it will actually do. The edge function is the authority. A key
 * checked only here hides a button, and a hidden button is not a permission.
 */

export const DATA_CENTER_FEATURES = {
  /** Read Table 1, the sold stove records. */
  RECORDS_VIEW: "records.view",
  /** Read Table 2, the call centre layer. */
  CALL_RECORDS_VIEW: "call_records.view",
  /** Enter or amend call outcomes and verification. */
  CALL_RECORDS_EDIT: "call_records.edit",
  /** Upload and validate an import batch. Staging only, commits nothing. */
  IMPORT_UPLOAD: "import.upload",
  /**
   * Commit a validated batch. Deliberately separate from IMPORT_UPLOAD:
   * committing moves stoves from available to sold and visibly changes the
   * sales app's inventory, so being able to prepare an import and being able
   * to land it are two different privileges.
   */
  IMPORT_COMMIT: "import.commit",
  /** Work the exceptions queue: rows whose serial did not match stock. */
  IMPORT_EXCEPTIONS: "import.exceptions",
  /** Read the computed dashboards. */
  DASHBOARD_VIEW: "dashboard.view",
  /** Edit the field registry and option lists. */
  REGISTRY_MANAGE: "registry.manage",
  /** Grant and revoke tier-2 features for other users. */
  GRANTS_MANAGE: "grants.manage",
  /** Work the digitalisation workbench: open a stove and type its sale. */
  DIGITISATION_WORK: "digitisation.work",
  /** Hand work to call agents, and take it back. */
  ASSIGNMENT_MANAGE: "assignment.manage",
  /** See the records sent back to you, and close them. */
  CORRECTIONS_FIX: "corrections.fix",
  /** Decide who send-backs reach, and which account a rep name means. */
  CORRECTIONS_ROUTE: "corrections.route",
} as const;

export type DataCenterFeature =
  (typeof DATA_CENTER_FEATURES)[keyof typeof DATA_CENTER_FEATURES];

/** Every key, for the grant-management UI and for validating server responses. */
export const ALL_DATA_CENTER_FEATURES: DataCenterFeature[] =
  Object.values(DATA_CENTER_FEATURES);

/** Human labels for the grant-management UI. */
export const FEATURE_LABELS: Record<DataCenterFeature, string> = {
  [DATA_CENTER_FEATURES.RECORDS_VIEW]: "View sold stove records",
  [DATA_CENTER_FEATURES.CALL_RECORDS_VIEW]: "View call centre records",
  [DATA_CENTER_FEATURES.CALL_RECORDS_EDIT]: "Record call outcomes",
  [DATA_CENTER_FEATURES.IMPORT_UPLOAD]: "Upload and validate imports",
  [DATA_CENTER_FEATURES.IMPORT_COMMIT]: "Commit imports",
  [DATA_CENTER_FEATURES.IMPORT_EXCEPTIONS]: "Work the exceptions queue",
  [DATA_CENTER_FEATURES.DASHBOARD_VIEW]: "View dashboards",
  [DATA_CENTER_FEATURES.REGISTRY_MANAGE]: "Manage fields and option lists",
  [DATA_CENTER_FEATURES.GRANTS_MANAGE]: "Manage feature access",
  [DATA_CENTER_FEATURES.DIGITISATION_WORK]: "Use the digitalisation workbench",
  [DATA_CENTER_FEATURES.ASSIGNMENT_MANAGE]: "Assign and reassign call work",
  [DATA_CENTER_FEATURES.CORRECTIONS_FIX]: "Treat records sent back to Sales",
  [DATA_CENTER_FEATURES.CORRECTIONS_ROUTE]: "Decide who receives send-backs",
};
