/**
 * Has the signed-in person been granted Recovery? For the sidebar only.
 *
 * Staff keep their own sales-app role and are granted Recovery on top, per
 * person, which the static role map cannot express. `Sidebar.jsx` shows the
 * entry when the map allows it OR this resolves true. Same shape as the Data
 * Center's hook: cached in sessionStorage for fifteen minutes, so a person
 * without access costs one small request per session, and being wrong is
 * cheap in the safe direction because the page and the server check again.
 */
import { useEffect, useState } from "react";
import { recoveryClient } from "./client";

const CACHE_KEY = "recovery_module_access_v1";
const CACHE_TTL_MS = 15 * 60 * 1000;

function readCache(): boolean | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { at, value } = JSON.parse(raw) as { at: number; value: boolean };
    return Date.now() - at < CACHE_TTL_MS ? value : null;
  } catch {
    return null;
  }
}

function writeCache(value: boolean) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), value }));
  } catch {
    /* storage unavailable; the cost is one more request */
  }
}

/** Call after granting or revoking, so the sidebar updates without a re-login. */
export function invalidateRecoveryAccessCache() {
  try {
    sessionStorage.removeItem(CACHE_KEY);
  } catch {
    /* nothing to invalidate */
  }
}

export function useRecoveryModuleAccess(enabled: boolean): boolean {
  const [hasAccess, setHasAccess] = useState<boolean>(() => readCache() ?? false);

  useEffect(() => {
    if (!enabled) return;
    if (readCache() !== null) return;

    let alive = true;
    recoveryClient
      .getAccess()
      .then((access) => {
        const value = Boolean(access.hasAccess);
        writeCache(value);
        if (alive) setHasAccess(value);
      })
      .catch(() => {
        // Fail closed, and do not cache a transient failure.
        if (alive) setHasAccess(false);
      });
    return () => {
      alive = false;
    };
  }, [enabled]);

  return hasAccess;
}
