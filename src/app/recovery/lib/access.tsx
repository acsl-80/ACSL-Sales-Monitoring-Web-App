/**
 * Recovery access, for rendering.
 *
 * `useRecoveryAccess().can(key)` mirrors the sales app's `usePermissions().can`
 * so it reads familiarly. It is presentation only: the edge function resolves
 * the same grants from the caller's token on every request, and when the two
 * disagree the server wins.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { recoveryClient, RecoveryError } from "./client";
import type { RecoveryAccessLevel, RecoveryFeature } from "./features";

type AccessState = {
  hasAccess: boolean;
  accessLevel: RecoveryAccessLevel | null;
  features: Set<RecoveryFeature>;
  isSuperAdmin: boolean;
  loading: boolean;
  error: string | null;
};

const INITIAL: AccessState = {
  hasAccess: false,
  accessLevel: null,
  features: new Set(),
  isSuperAdmin: false,
  loading: true,
  error: null,
};

const AccessContext = createContext<AccessState>(INITIAL);

export function RecoveryAccessProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AccessState>(INITIAL);

  useEffect(() => {
    let alive = true;
    recoveryClient
      .getAccess()
      .then((access) => {
        if (!alive) return;
        setState({
          hasAccess: Boolean(access.hasAccess),
          accessLevel: access.accessLevel ?? null,
          features: new Set(access.features ?? []),
          isSuperAdmin: Boolean(access.isSuperAdmin),
          loading: false,
          error: null,
        });
      })
      .catch((err: unknown) => {
        if (!alive) return;
        // Fail closed: an access check that did not succeed grants nothing.
        setState({
          ...INITIAL,
          loading: false,
          error: err instanceof RecoveryError ? err.message : "Recovery access could not be checked.",
        });
      });
    return () => {
      alive = false;
    };
  }, []);

  return <AccessContext.Provider value={state}>{children}</AccessContext.Provider>;
}

export function useRecoveryAccess() {
  const state = useContext(AccessContext);
  return useMemo(
    () => ({ ...state, can: (key: RecoveryFeature) => state.features.has(key) }),
    [state],
  );
}
