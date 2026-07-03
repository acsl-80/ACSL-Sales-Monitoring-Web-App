
import React, { useEffect, createContext, useContext } from "react";
import { useRouter } from "@/compat/navigation";
import { useAuth } from "../contexts/useAuth";
import { getRolePermissions, isSuperAdminRole, type RouteKey } from "@/lib/permissions";

type ProtectedRouteProp = {
  children?: React.ReactNode;
  allowedRoles?: string[];
  requireSuperAdmin?: boolean;
  requireAdminAccess?: boolean;
  /** Gate by the PERMISSIONS route map — the single source of truth for the RBAC matrix. */
  routeKey?: RouteKey;
};

// When a parent ProtectedRoute is already mounted (the app shell in __root),
// nested usage becomes a passthrough so we don't double-run auth gates or
// flash the spinner on every navigation.
const ProtectedRouteMountedContext = createContext(false);

const ProtectedRoute = ({
  children,
  allowedRoles,
  requireSuperAdmin = false,
  requireAdminAccess = false,
  routeKey,
}: ProtectedRouteProp) => {
  const alreadyMounted = useContext(ProtectedRouteMountedContext);
  const {
    user,
    loading,
    isAuthenticated,
    isSuperAdmin,
    hasAdminAccess,
    userRole,
  } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;

    if (!isAuthenticated) {
      if (!alreadyMounted) router.push("/login");
      return;
    }

    if (isSuperAdmin || isSuperAdminRole(userRole)) return;

    if (routeKey && !getRolePermissions(userRole).routes.includes(routeKey)) {
      router.push("/unauthorized");
      return;
    }

    if (allowedRoles && allowedRoles.length > 0) {
      if (!userRole || !allowedRoles.includes(userRole)) {
        router.push("/unauthorized");
        return;
      }
    }

    if (requireSuperAdmin && !isSuperAdmin) {
      router.push("/unauthorized");
      return;
    }

    if (requireAdminAccess && !hasAdminAccess) {
      router.push("/unauthorized");
      return;
    }
  }, [
    loading,
    isAuthenticated,
    isSuperAdmin,
    hasAdminAccess,
    userRole,
    allowedRoles,
    requireSuperAdmin,
    requireAdminAccess,
    routeKey,
    router,
    alreadyMounted,
  ]);

  // Nested instance: outer ProtectedRoute already verified the session.
  // Just enforce any extra role gate inline, no spinner.
  if (alreadyMounted) {
    return <>{children}</>;
  }

  if (user) {
    return (
      <ProtectedRouteMountedContext.Provider value={true}>
        {children}
      </ProtectedRouteMountedContext.Provider>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
        </div>
      </div>
    );
  }

  return null;
};

export default ProtectedRoute;
