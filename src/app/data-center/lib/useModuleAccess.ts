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
 *
 * The cache records whose answer it is (D64). sessionStorage outlives a
 * sign-out on the same tab, and an answer with no owner was once shown to
 * whoever signed in next.
 */
import { useEffect, useState } from "react";
import { dataCenterClient, onSignedInUser, signedInUserId } from "./client";

const CACHE_KEY = "dc_module_access_v2";
const CACHE_TTL_MS = 15 * 60 * 1000;

type Cached = { at: number; userId: string; value: boolean };

/** The cached answer, only if it is fresh AND was given to this same person. */
function readCache(userId: string): boolean | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as Cached;
    if (cached.userId !== userId || Date.now() - cached.at >= CACHE_TTL_MS) return null;
    return cached.value;
  } catch {
    return null;
  }
}

function writeCache(userId: string, value: boolean) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), userId, value } satisfies Cached));
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
  // Starts closed and opens only once this person's answer is known.
  const [hasAccess, setHasAccess] = useState(false);

  useEffect(() => {
    if (!enabled) return;

    let alive = true;
    let resolvedFor: string | null = null;
    // Each check takes a number and only the newest may answer, so a slow
    // reply about the last person cannot land on the next one.
    let latest = 0;

    // A change of person (sign-out, another sign-in) asks again rather than
    // keeping what the last person was shown. A token refresh for the same
    // person changes nothing. The re-check is deferred out of the callback,
    // because supabase-js can deadlock on an auth call made inside it.
    const unsubscribe = onSignedInUser((userId) => {
      if (userId === resolvedFor) return;
      // Retire any check still in flight now, not when the next one starts:
      // its reply is about the person who just left.
      latest++;
      if (alive) setHasAccess(false);
      setTimeout(() => void resolve(), 0);
    });

    async function resolve() {
      const run = ++latest;
      const current = () => alive && run === latest;

      const userId = await signedInUserId();
      if (!current()) return;
      resolvedFor = userId;
      if (!userId) {
        setHasAccess(false);
        return;
      }
      const cached = readCache(userId);
      if (cached !== null) {
        setHasAccess(cached);
        return;
      }
      try {
        const access = await dataCenterClient.getAccess();
        if (!current()) return;
        const value = Boolean(access.hasAccess);
        writeCache(userId, value);
        setHasAccess(value);
      } catch {
        // Fail closed and do not cache: a transient failure should not deny
        // the entry for fifteen minutes.
        if (current()) setHasAccess(false);
      }
    }

    void resolve();
    return () => {
      alive = false;
      unsubscribe();
      // Whoever is here when the hook is next enabled starts closed too.
      setHasAccess(false);
    };
  }, [enabled]);

  return enabled && hasAccess;
}
