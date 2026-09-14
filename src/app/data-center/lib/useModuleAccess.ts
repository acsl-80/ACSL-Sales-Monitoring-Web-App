/**
 * Does the signed-in user have Data Center access? For the sidebar.
 *
 * The host app's nav is driven by a static, compile-time role map, which can
 * say "super_admin sees the entry" but cannot say "this particular user was
 * enabled yesterday". This hook closes that gap for exactly one consumer:
 * `Sidebar.jsx` shows the Data Center entry when the static map allows it OR
 * this hook resolves true.
 *
 * The sidebar mounts for every signed-in user of the sales app, so the answer
 * is cached in sessionStorage for fifteen minutes. The cost to a user with no
 * access is one lightweight request per session, and being wrong is cheap in
 * the safe direction: the sidebar entry is presentation, and every page and
 * endpoint re-checks access for real.
 */
import { useEffect, useState } from "react";
import { dataCenterClient } from "./client";

const CACHE_KEY = "dc_module_access_v1";
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
    /* storage full or unavailable; the fallback is just an extra request */
  }
}

/** Call after granting or revoking, so the sidebar updates without a re-login. */
export function invalidateModuleAccessCache() {
  try {
    sessionStorage.removeItem(CACHE_KEY);
  } catch {
    /* nothing to invalidate */
  }
}

export function useDataCenterModuleAccess(enabled: boolean): boolean {
  const [hasAccess, setHasAccess] = useState<boolean>(() => readCache() ?? false);

  useEffect(() => {
    if (!enabled) return;
    if (readCache() !== null) return;

    let alive = true;
    dataCenterClient
      .getAccess()
      .then((access) => {
        const value = Boolean(access.hasAccess);
        writeCache(value);
        if (alive) setHasAccess(value);
      })
      .catch(() => {
        // Fail closed and do not cache: a transient failure should not deny
        // the entry for fifteen minutes.
        if (alive) setHasAccess(false);
      });
    return () => {
      alive = false;
    };
  }, [enabled]);

  return hasAccess;
}
