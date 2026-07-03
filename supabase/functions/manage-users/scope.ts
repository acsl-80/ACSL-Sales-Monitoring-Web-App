// Caller scoping for User Management (RBAC matrix: User Management → User Manager)
//
// - super_admin           → all users
// - acsl_agent_manager    → ACSL agents reporting to them + users of assigned partners
// - acsl_agent            → partner agents of assigned partners (read-only)
// - partner (admin)       → partner agents of their own organization
// - everyone else         → no access
//
// The response shape stays identical across roles — scope only changes filters.

import { resolveAssignedOrgIds } from "../_shared/resolveAssignedOrgIds.ts";

export interface CallerContext {
  id: string;
  role: string;
  organizationId: string | null;
}

export type CallerScope =
  | { type: "all" }
  | { type: "manager"; orgIds: string[] }
  | { type: "acsl_agent"; orgIds: string[] }
  | { type: "partner"; orgIds: string[] };

export const PARTNER_ROLES = ["partner", "admin"];
export const ORG_USER_ROLES = ["partner_agent", "agent", "agent_user"];
export const ACSL_AGENT_ROLES = ["acsl_agent", "super_admin_agent"];

export const ALLOWED_CALLER_ROLES = [
  "super_admin",
  "acsl_agent_manager",
  // ACSL agents get read-only access so Agent Management → Partner Agents can
  // list agents of their assigned partners (RBAC matrix). Writes stay blocked.
  ...ACSL_AGENT_ROLES,
  ...PARTNER_ROLES,
];

export function isManagerRole(role: string): boolean {
  return role === "acsl_agent_manager";
}

export function isAcslAgentRole(role: string): boolean {
  return ACSL_AGENT_ROLES.includes(role);
}

export function isPartnerRole(role: string): boolean {
  return PARTNER_ROLES.includes(role);
}

export async function resolveCallerScope(
  supabase: any,
  caller: CallerContext
): Promise<CallerScope> {
  if (caller.role === "super_admin") return { type: "all" };
  if (isManagerRole(caller.role)) {
    const { assignedOrgIds } = await resolveAssignedOrgIds(supabase, caller.id);
    return { type: "manager", orgIds: assignedOrgIds };
  }
  if (isAcslAgentRole(caller.role)) {
    const { assignedOrgIds } = await resolveAssignedOrgIds(supabase, caller.id);
    return { type: "acsl_agent", orgIds: assignedOrgIds };
  }
  if (isPartnerRole(caller.role)) {
    return {
      type: "partner",
      orgIds: caller.organizationId ? [caller.organizationId] : [],
    };
  }
  throw new Error("Unauthorized: Access denied for this role.");
}

/** Applies the caller's row-level scope to the users list query. */
export function applyScopeToListQuery(query: any, scope: CallerScope, callerId: string) {
  if (scope.type === "all") return query;

  if (scope.type === "partner" || scope.type === "acsl_agent") {
    if (scope.orgIds.length === 0) return query.eq("role", "__none__");
    return query
      .in("role", ORG_USER_ROLES)
      .in("organization_id", scope.orgIds);
  }

  // Manager: own subordinate ACSL agents + agents of assigned partner orgs
  // (+ their own row, so the create-form manager cascade can resolve them).
  const branches = [
    `and(role.in.(${ACSL_AGENT_ROLES.join(",")}),manager_id.eq.${callerId})`,
    `and(role.eq.acsl_agent_manager,id.eq.${callerId})`,
  ];
  if (scope.orgIds.length > 0) {
    branches.push(
      `and(role.in.(${ORG_USER_ROLES.join(",")}),organization_id.in.(${scope.orgIds.join(",")}))`
    );
  }
  return query.or(branches.join(","));
}

/** Whether a single target profile is inside the caller's scope. */
export function userInScope(
  scope: CallerScope,
  profile: { id: string; role: string; organization_id?: string | null; manager_id?: string | null },
  callerId: string
): boolean {
  if (scope.type === "all") return true;
  if (scope.type === "partner" || scope.type === "acsl_agent") {
    return (
      ORG_USER_ROLES.includes(profile.role) &&
      !!profile.organization_id &&
      scope.orgIds.includes(profile.organization_id)
    );
  }
  if (ACSL_AGENT_ROLES.includes(profile.role)) return profile.manager_id === callerId;
  if (profile.role === "acsl_agent_manager") return profile.id === callerId;
  if (ORG_USER_ROLES.includes(profile.role)) {
    return !!profile.organization_id && scope.orgIds.includes(profile.organization_id);
  }
  return false;
}

/** Roles the caller is allowed to create/assign (mirrors ACCESS_CONTROL.md form rules). */
export function creatableRolesFor(callerRole: string): string[] {
  if (callerRole === "super_admin") {
    return ["super_admin", "acsl_agent_manager", "acsl_agent", "partner", "partner_agent", "agent"];
  }
  // Only super admin can create partner users.
  if (isManagerRole(callerRole)) return ["acsl_agent", "partner_agent", "agent"];
  if (isPartnerRole(callerRole)) return ["partner_agent"];
  return [];
}
