/**
 * Labels for Recovery's access levels and feature keys.
 *
 * Labels only. What each level actually grants is decided on the server, in
 * supabase/functions/_shared/recovery-roles.ts, and if this file and that one
 * ever disagree, that one wins and this one is what is wrong.
 */

export type RecoveryFeature = "recovery.view" | "recovery.edit" | "recovery.import" | "recovery.assign";

export type RecoveryAccessLevel = "viewer" | "recovery_agent" | "data_manager";

export const LEVEL_LABELS: Record<RecoveryAccessLevel, string> = {
  viewer: "Viewer",
  recovery_agent: "Recovery agent",
  data_manager: "Data manager",
};

export const FEATURE_LABELS: Record<RecoveryFeature, string> = {
  "recovery.view": "Read records and counts",
  "recovery.edit": "Record households and calls",
  "recovery.import": "Run bulk imports",
  "recovery.assign": "Hand out work and settle conflicts",
};
