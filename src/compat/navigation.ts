// Compatibility shim that mirrors the `next/navigation` API surface used across
// the ported app, backed by TanStack Router. Only the pieces actually used are
// implemented: useRouter (push/replace/back/forward/refresh/prefetch),
// usePathname, useSearchParams, useParams, redirect.
import {
  useNavigate,
  useRouter as useTanstackRouter,
  useLocation,
  useParams as useTanstackParams,
  redirect as tanstackRedirect,
} from "@tanstack/react-router";

// Render-safe declarative redirect. Unlike `redirect()` (which throws and is only
// handled in route lifecycle/SSR), <Navigate> performs the redirect during render
// — use it for redirect-only page components.
export { Navigate } from "@tanstack/react-router";

export interface NextRouter {
  push: (href: string) => void;
  replace: (href: string) => void;
  back: () => void;
  forward: () => void;
  refresh: () => void;
  prefetch: (href: string) => void;
}

export function useRouter(): NextRouter {
  const navigate = useNavigate();
  const router = useTanstackRouter();
  return {
    push: (href: string) => navigate({ to: href }),
    replace: (href: string) => navigate({ to: href, replace: true }),
    back: () => router.history.back(),
    forward: () => router.history.forward(),
    refresh: () => router.invalidate(),
    // No-op: TanStack handles preloading via route config.
    prefetch: () => {},
  };
}

export function usePathname(): string {
  return useLocation({ select: (l) => l.pathname });
}

export function useSearchParams(): URLSearchParams {
  const search = useLocation({ select: (l) => l.searchStr });
  return new URLSearchParams(search ?? "");
}

export function useParams<T = Record<string, string>>(): T {
  return useTanstackParams({ strict: false }) as T;
}

// Imperative redirect (mirrors next/navigation redirect). Throws a TanStack
// redirect so it is handled cleanly during both SSR (302) and client render.
export function redirect(href: string): never {
  throw tanstackRedirect({ to: href });
}
