/**
 * The Data Center module's only data path.
 *
 * Nothing else under `src/app/data-center/` may call `getSupabase()` for module
 * data. Everything goes through here, which keeps the boundary in one file: if
 * this module ever needs to move, this is the seam.
 *
 * Why the module cannot use the Supabase client directly: `data_center` is
 * deliberately absent from `[api].schemas` in supabase/config.toml, so
 * PostgREST does not expose it and `supabase.from(...)` cannot reach it. That
 * omission is the isolation guarantee, and it is also what stops the
 * sales-mobile Flutter app seeing this data. The `data-center-*` edge functions
 * connect to Postgres directly instead.
 */

import { getSupabase } from "@/lib/supabaseClient";
import { supabaseUrl as SUPABASE_URL } from "@/lib/supabaseConfig";

/** Block 31: nothing waits forever. */
const REQUEST_TIMEOUT_MS = 20_000;

export class DataCenterError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code = "unknown") {
    super(message);
    this.name = "DataCenterError";
    this.status = status;
    this.code = code;
  }
}

async function authHeader(): Promise<string> {
  const { data, error } = await getSupabase().auth.getSession();
  if (error || !data.session) {
    throw new DataCenterError("Your session has expired. Please sign in again.", 401, "no_session");
  }
  return `Bearer ${data.session.access_token}`;
}

/**
 * Call a `data-center-*` edge function.
 *
 * The caller's grants are resolved server-side from this token on every
 * request. Nothing here is trusted to have gated anything.
 */
async function call<T>(fn: string, action: string, payload: unknown = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: await authHeader(),
      },
      body: JSON.stringify({ action, ...(payload as object) }),
      signal: controller.signal,
    });

    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      // A non-JSON body from an edge function is always a failure, so fall
      // through to the status check rather than guessing at the content.
    }

    if (!response.ok) {
      const detail = body as { error?: string; code?: string } | null;
      throw new DataCenterError(
        detail?.error ?? `Request to ${fn} failed.`,
        response.status,
        detail?.code ?? "request_failed",
      );
    }

    // Block 13: validate the shape rather than trusting it.
    if (body === null || typeof body !== "object" || !("data" in body)) {
      throw new DataCenterError(
        `Malformed response from ${fn}.`,
        502,
        "malformed_response",
      );
    }

    return (body as { data: T }).data;
  } catch (err) {
    if (err instanceof DataCenterError) throw err;
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new DataCenterError(
        "The Data Center took too long to respond. Please try again.",
        504,
        "timeout",
      );
    }
    // Block 34: log the detail, hand the user something calm.
    console.error(`[data-center] ${fn}/${action} failed`, err);
    throw new DataCenterError("Could not reach the Data Center.", 0, "network");
  } finally {
    clearTimeout(timer);
  }
}

export type AccessResponse = {
  /** Tier-2 feature keys this user actually holds. */
  features: string[];
  /** True when the host role short-circuits every check, mirroring usePermissions. */
  isSuperAdmin: boolean;
  organizationId: string | null;
};

export const dataCenterClient = {
  /**
   * Resolve the caller's tier-2 grants. Called once when the module mounts.
   * The answer is advisory to the UI and authoritative nowhere: every
   * subsequent call re-resolves grants server-side from the same token.
   */
  getAccess: () => call<AccessResponse>("data-center-read", "access"),
};

export default dataCenterClient;
