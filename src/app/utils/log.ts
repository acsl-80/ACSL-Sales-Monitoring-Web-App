/**
 * The host app's one way to say something to the console.
 *
 * Slice 8b of the 2026-09-02 review (finding F33). One hundred and fifty-five
 * console.log calls shipped to production across twenty-two files, and
 * several of them said who was signed in: the user's email on every auth
 * state change, the first hundred characters of whatever sat under an auth
 * key in local storage, the full page address including any fragment. The
 * Data Center has never logged to the console at all; the host now logs
 * through this and nothing else.
 *
 * It prints in development, and in production only when support has set the
 * flag below in the browser's local storage for the session they are
 * looking at. Nothing else reaches the console. As a second wall, the
 * production build marks console.log, console.debug and console.info as pure,
 * so a stray call left in a file is dropped at build time; the call below is
 * made through a variable so that wall does not silence the flag.
 *
 * What is passed here is still read by a person over somebody's shoulder.
 * Say that something happened; never say who, and never a token.
 */

export const DEBUG_FLAG = "acsl:debug";

function enabled(): boolean {
  if (import.meta.env.DEV) return true;
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(DEBUG_FLAG) === "1";
  } catch {
    return false;
  }
}

const sink = console;

export function debug(...args: unknown[]): void {
  if (!enabled()) return;
  sink.debug(...args);
}
