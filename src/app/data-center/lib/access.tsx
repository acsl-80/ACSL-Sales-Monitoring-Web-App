/**
 * Tier-2 access for the Data Center module.
 *
 * `useFeature().can(key)` deliberately mirrors the host app's
 * `usePermissions().can(key)` signature, so the module reads as familiar to
 * anyone maintaining the rest of the app. The difference is underneath: the
 * host resolves from a compiled role map, this resolves from
 * `data_center.feature_grants` at runtime.
 *
 * This gate is presentation only. It decides what to render. The edge function
 * decides what actually happens, re-resolving the same grants from the caller's
 * JWT on every request. If these two ever disagree, the edge function wins and
 * the UI is the thing that is wrong.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { dataCenterClient, DataCenterError, type AccessRole } from "./client";
import type { DataCenterFeature } from "./features";

type AccessState = {
  /** May this user enter at all? Granted case by case, per user. */
  hasAccess: boolean;
  /** The granted level; null for super_admin, who outranks all three, and for the denied. */
  accessRole: AccessRole | null;
  features: Set<string>;
  isSuperAdmin: boolean;
  organizationId: string | null;
  loading: boolean;
  error: string | null;
};

const INITIAL: AccessState = {
  hasAccess: false,
  accessRole: null,
  features: new Set(),
  isSuperAdmin: false,
  organizationId: null,
  loading: true,
  error: null,
};

const AccessContext = createContext<AccessState>(INITIAL);

export function DataCenterAccessProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AccessState>(INITIAL);

  useEffect(() => {
    let alive = true;

    dataCenterClient
      .getAccess()
      .then((access) => {
        if (!alive) return;
        setState({
          hasAccess: Boolean(access.hasAccess),
          accessRole: access.accessRole ?? null,
          features: new Set(access.features ?? []),
          isSuperAdmin: Boolean(access.isSuperAdmin),
          organizationId: access.organizationId ?? null,
          loading: false,
          error: null,
        });
      })
      .catch((err: unknown) => {
        if (!alive) return;
        // Fail closed. An access lookup that did not succeed grants nothing,
        // because the alternative is a UI that offers actions the server will
        // then refuse.
        setState({
          ...INITIAL,
          loading: false,
          error:
            err instanceof DataCenterError
              ? err.message
              : "Could not load your Data Center access.",
        });
      });

    return () => {
      alive = false;
    };
  }, []);

  return <AccessContext.Provider value={state}>{children}</AccessContext.Provider>;
}

export function useFeature() {
  const state = useContext(AccessContext);

  return useMemo(
    () => ({
      /** Mirrors usePermissions().can() so the module reads like the host app. */
      can(feature: DataCenterFeature): boolean {
        if (state.isSuperAdmin) return true;
        return state.features.has(feature);
      },
      /** May this user enter the module at all? */
      hasAccess: state.isSuperAdmin || state.hasAccess,
      /** The granted level, null for super_admin who outranks all three. */
      accessRole: state.accessRole,
      /** True while grants are still being resolved. Render nothing gated yet. */
      loading: state.loading,
      /** Set when the lookup failed. The module grants nothing in that state. */
      error: state.error,
      isSuperAdmin: state.isSuperAdmin,
      organizationId: state.organizationId,
      grantedFeatures: state.features,
    }),
    [state],
  );
}

/** Renders children only when the caller holds `feature`. */
export function Gated({
  feature,
  children,
  fallback = null,
}: {
  feature: DataCenterFeature;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { can, loading } = useFeature();
  if (loading) return null;
  return can(feature) ? <>{children}</> : <>{fallback}</>;
}
