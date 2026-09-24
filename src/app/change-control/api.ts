// The one door to Change Control from inside this app.
//
// Every call goes through the change-request-intake edge function
// (supabase/functions/change-request-intake/index.ts) with the caller's own
// session — the session travels with supabase.functions.invoke automatically,
// so nothing here reads or sends a token by hand. That function checks the
// caller's role and passes the ERP's own answers back unchanged (a refusal
// keeps its plain words and status).
//
// This is the only file in the app allowed to call change-request-intake:
// every page and component below goes through here, never
// `supabase.functions.invoke` directly, so the contract only has to be gotten
// right in one place.

import { getSupabase } from "@/lib/supabaseClient";
import type {
  ChangeControlForm,
  ChangeControlRequest,
  ConfirmResult,
  RaiseRequestInput,
  RaiseRequestResult,
  ReplyResult,
  UploadResult,
} from "./types";

const FUNCTION_NAME = "change-request-intake";
const FALLBACK_ERROR = "Change Control could not do that just now. Please try again later.";

// supabase-js hands back an HTTP error as `error` (a FunctionsHttpError) whose
// `.context` is the raw Response — the function's own `{ error: "..." }` body
// lives there, not on the error object itself.
async function messageFromInvokeError(error: unknown): Promise<string> {
  const withContext = error as { context?: Response; message?: string } | null;
  if (withContext?.context && typeof withContext.context.json === "function") {
    try {
      const body = await withContext.context.json();
      if (body && typeof body.error === "string") return body.error;
    } catch {
      // The server's own body could not be read as JSON; fall through.
    }
  }
  return withContext?.message || FALLBACK_ERROR;
}

async function invoke<T>(body: BodyInit | Record<string, unknown>): Promise<T> {
  const supabase = getSupabase();
  const { data, error } = await supabase.functions.invoke(FUNCTION_NAME, { body });
  if (error) throw new Error(await messageFromInvokeError(error));
  if (data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string") {
    throw new Error((data as { error: string }).error);
  }
  return data as T;
}

export function getForm(): Promise<ChangeControlForm> {
  return invoke<ChangeControlForm>({ action: "form" });
}

export function listRequests(): Promise<ChangeControlRequest[]> {
  return invoke<ChangeControlRequest[]>({ action: "list" });
}

export function raiseRequest(request: RaiseRequestInput): Promise<RaiseRequestResult> {
  return invoke<RaiseRequestResult>({ action: "raise", request });
}

export function replyToRequest(requestId: string, body: string): Promise<ReplyResult> {
  return invoke<ReplyResult>({ action: "reply", request_id: requestId, body });
}

export function confirmFix(
  requestId: string,
  fixed: boolean,
  note?: string,
): Promise<ConfirmResult> {
  return invoke<ConfirmResult>({ action: "confirm", request_id: requestId, fixed, note });
}

/** One to five screenshots, attached to the request itself (no `commentId`) or to one reply. */
export function attachScreenshots(
  requestId: string,
  files: File[],
  commentId?: string,
): Promise<UploadResult> {
  const form = new FormData();
  form.set("request_id", requestId);
  if (commentId) form.set("comment_id", commentId);
  for (const file of files) form.append("files", file, file.name);
  return invoke<UploadResult>(form);
}
