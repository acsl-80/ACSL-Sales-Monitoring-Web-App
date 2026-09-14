import { useEffect, useState } from "react";

/**
 * Whether a media query matches, as state.
 *
 * The module's two big tables are virtualized, which means the row height is a
 * number in JavaScript rather than a class in CSS. A phone needs a taller row
 * than a desktop, so the breakpoint has to be readable from JavaScript too;
 * a `sm:` class cannot reach the arithmetic that decides how many rows fit.
 *
 * Server-safe: the initial value is false and the real answer arrives on the
 * first effect, so a hydration mismatch is impossible.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);

  return matches;
}

/** Below the `sm` breakpoint: a phone held in one hand. */
export function useIsPhone(): boolean {
  return useMediaQuery("(max-width: 639px)");
}
