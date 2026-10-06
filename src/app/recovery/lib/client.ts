/**
 * The Recovery module's only door to its data.
 *
 * Every read and write goes through the `recovery*` edge functions, because the
 * `recovery` schema is not reachable from the browser at all. The sales app's
 * Supabase client is used for one thing: the signed-in person's token, which
 * signs each call so the server can decide what they may do.
 */
import { getSupabase } from "@/lib/supabaseClient";
import { supabaseUrl as SUPABASE_URL } from "@/lib/supabaseConfig";
import type { RecoveryAccessLevel, RecoveryFeature } from "./features";

const REQUEST_TIMEOUT_MS = 20_000;

export class RecoveryError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code = "unknown") {
    super(message);
    this.name = "RecoveryError";
    this.status = status;
    this.code = code;
  }
}

export type AccessResponse = {
  hasAccess: boolean;
  accessLevel: RecoveryAccessLevel | null;
  features: RecoveryFeature[];
  isSuperAdmin: boolean;
};

async function authHeader(): Promise<string> {
  const { data, error } = await getSupabase().auth.getSession();
  if (error || !data.session) {
    throw new RecoveryError("Your session has expired. Please sign in again.", 401, "no_session");
  }
  return `Bearer ${data.session.access_token}`;
}

async function call<T>(fn: string, action: string, payload: object = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: await authHeader() },
      body: JSON.stringify({ action, ...payload }),
      signal: controller.signal,
    });

    let body: { data?: T; error?: string; code?: string } | null = null;
    try {
      body = await response.json();
    } catch {
      // A body that is not JSON is a failure; the status check below says so.
    }

    if (!response.ok || !body || body.data === undefined) {
      throw new RecoveryError(
        body?.error ?? `Request to ${fn} failed.`,
        response.status,
        body?.code ?? "request_failed",
      );
    }
    return body.data;
  } catch (err) {
    if (err instanceof RecoveryError) throw err;
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new RecoveryError("Recovery took too long to answer. Please try again.", 0, "timeout");
    }
    throw new RecoveryError("Recovery could not be reached. Check your connection.", 0, "network");
  } finally {
    clearTimeout(timer);
  }
}

export const recoveryClient = {
  /** What the signed-in person may do in Recovery, decided by the server. */
  getAccess: () => call<AccessResponse>("recovery-read", "access"),
};
