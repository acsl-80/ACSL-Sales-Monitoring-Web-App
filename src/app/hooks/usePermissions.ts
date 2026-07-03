
import { useAuth } from "../contexts/useAuth";
import {
  getRolePermissions,
  isSuperAdminRole,
  type RouteKey,
  type FeatureKey,
} from "@/lib/permissions";

export function usePermissions() {
  const { userRole } = useAuth();
  const permissions = getRolePermissions(userRole);
  const superAdmin = isSuperAdminRole(userRole);

  function canRoute(route: RouteKey): boolean {
    if (superAdmin) return true;
    return permissions.routes.includes(route);
  }

  function can(feature: FeatureKey): boolean {
    if (superAdmin) return true;
    return permissions.features.includes(feature);
  }

  return { can, canRoute, isSuperAdmin: superAdmin };
}
