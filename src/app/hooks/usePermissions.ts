import { useMemo } from "react";
import { useAuth } from "../contexts/useAuth";
import {
  getRolePermissions,
  isSuperAdminRole,
  type RouteKey,
  type FeatureKey,
} from "@/lib/permissions";

/**
 * What the signed-in role may see and do.
 *
 * Slice 10c of the 2026-09-02 review (finding F13): the two checks used to be
 * new functions on every render, so every memo that listed them as a
 * dependency recomputed on every render. They are now stable for as long as
 * the role is, which is what a dependency array expects of them.
 */
export function usePermissions() {
  const { userRole } = useAuth();
  return useMemo(() => {
    const permissions = getRolePermissions(userRole);
    const superAdmin = isSuperAdminRole(userRole);
    const canRoute = (route: RouteKey): boolean => superAdmin || permissions.routes.includes(route);
    const can = (feature: FeatureKey): boolean => superAdmin || permissions.features.includes(feature);
    return { can, canRoute, isSuperAdmin: superAdmin };
  }, [userRole]);
}
