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
import { getSupabase } from "@/lib/supabaseClient";
import { recoveryClient } from "./client";

const CACHE_KEY = "recovery_module_access_v2";
const CACHE_TTL_MS = 15 * 60 * 1000;

type Cached = { at: number; userId: string; value: boolean };

/**
 * The cached answer, only if it is fresh AND was given to this same person.
 * Bound to the user so the next person to sign in on the same tab never
 * inherits someone else's entry.
 */
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
  // Starts closed and opens only once this person's answer is known.
  const [hasAccess, setHasAccess] = useState(false);

  useEffect(() => {
    let alive = true;
    let resolvedFor: string | null = null;

    // A change of person (sign-out, another sign-in) asks again rather than
    // keeping what the last person was shown. A token refresh for the same
    // person changes nothing. The re-check is deferred out of the callback,
    // because supabase-js can deadlock on an auth call made inside it.
    const { data: listener } = getSupabase().auth.onAuthStateChange((_event, session) => {
      const userId = session?.user.id ?? null;
      if (userId === resolvedFor) return;
      if (alive) setHasAccess(false);
      setTimeout(() => void resolve(), 0);
    });

    async function resolve() {
      if (!enabled) return;
      const { data } = await getSupabase().auth.getSession();
      const userId = data.session?.user.id;
      resolvedFor = userId ?? null;
      if (!userId) {
        if (alive) setHasAccess(false);
        return;
      }
      const cached = readCache(userId);
      if (cached !== null) {
        if (alive) setHasAccess(cached);
        return;
      }
      try {
        const access = await recoveryClient.getAccess();
        const value = Boolean(access.hasAccess);
        writeCache(userId, value);
        if (alive) setHasAccess(value);
      } catch {
        // Fail closed, and do not cache a transient failure.
        if (alive) setHasAccess(false);
      }
    }

    void resolve();
    return () => {
      alive = false;
      listener.subscription.unsubscribe();
    };
  }, [enabled]);

  return enabled && hasAccess;
}
