// Recovers from stale build assets after a new deployment.
//
// When a new version is deployed, hashed chunk filenames change. A browser tab
// still holding the previous index.html will request chunks that no longer
// exist (404) and dynamic imports reject with "Failed to fetch dynamically
// imported module". The only real fix is a hard reload so the tab picks up the
// new asset manifest. We guard with sessionStorage so we never loop.

const RELOAD_FLAG = "app:chunk-reload-at";
const RELOAD_COOLDOWN_MS = 30_000;

export function isChunkLoadError(error: unknown): boolean {
  const message =
    typeof error === "string"
      ? error
      : error && typeof error === "object" && "message" in error
        ? String((error as { message?: unknown }).message ?? "")
        : "";

  if (!message) return false;

  return (
    message.includes("Failed to fetch dynamically imported module") ||
    message.includes("error loading dynamically imported module") ||
    message.includes("Importing a module script failed") ||
    message.includes("Unable to preload CSS") ||
    /Loading (CSS )?chunk .* failed/i.test(message)
  );
}

export function reloadForStaleChunks(): boolean {
  if (typeof window === "undefined") return false;

  try {
    const last = Number(window.sessionStorage.getItem(RELOAD_FLAG) ?? 0);
    if (last && Date.now() - last < RELOAD_COOLDOWN_MS) {
      // Already tried very recently — don't loop, let the error surface.
      return false;
    }
    window.sessionStorage.setItem(RELOAD_FLAG, String(Date.now()));
  } catch {
    // sessionStorage unavailable (private mode) — still attempt one reload.
  }

  window.location.reload();
  return true;
}

/**
 * Installs global listeners that detect stale-asset failures and reload once.
 * Safe to call multiple times; only the first call registers listeners.
 */
let installed = false;

export function installChunkReloadHandler(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  // Vite fires this when a preloaded module fails to load.
  window.addEventListener("vite:preloadError", (event) => {
    event.preventDefault();
    reloadForStaleChunks();
  });

  window.addEventListener("unhandledrejection", (event) => {
    if (isChunkLoadError(event.reason)) {
      reloadForStaleChunks();
    }
  });

  window.addEventListener("error", (event) => {
    if (isChunkLoadError(event.error ?? event.message)) {
      reloadForStaleChunks();
    }
  });
}
