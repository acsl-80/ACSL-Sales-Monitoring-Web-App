// Synchronous helpers for reading the cached Supabase session from
// localStorage. Used to avoid the "Verifying authentication..." flash on
// reload by hydrating auth state immediately, before the async
// supabase.auth.getSession() call resolves.

export type CachedUser = {
  id: string;
  email?: string;
  app_metadata?: Record<string, any>;
  user_metadata?: Record<string, any>;
} | null;

const ROLE_CACHE_KEY = "lovable.auth.cachedRole";

function readSupabaseSessionRaw(): any | null {
  if (typeof window === "undefined") return null;
  try {
    const key = Object.keys(localStorage).find(
      (k) => k.startsWith("sb-") && k.endsWith("-auth-token"),
    );
    if (!key) return null;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // supabase-js stores either the session directly or { currentSession: {...} }
    return parsed?.currentSession || parsed;
  } catch {
    return null;
  }
}

export function getCachedUser(): CachedUser {
  const session = readSupabaseSessionRaw();
  if (!session) return null;
  const expiresAt = session.expires_at ? session.expires_at * 1000 : 0;
  // Treat as valid if not expired. We still refresh in the background.
  if (expiresAt && expiresAt < Date.now()) return null;
  const u = session.user;
  if (!u?.id) return null;
  return {
    id: u.id,
    email: u.email,
    app_metadata: u.app_metadata,
    user_metadata: u.user_metadata,
  };
}

export function hasCachedSession(): boolean {
  return getCachedUser() !== null;
}

export function getCachedRole(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(ROLE_CACHE_KEY);
  } catch {
    return null;
  }
}

export function setCachedRole(role: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (role) localStorage.setItem(ROLE_CACHE_KEY, role);
    else localStorage.removeItem(ROLE_CACHE_KEY);
  } catch {
    // ignore
  }
}
