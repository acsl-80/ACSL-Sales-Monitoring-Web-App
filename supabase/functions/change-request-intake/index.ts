// change-request-intake: Change Control from inside the sales app (decisions D14, D15, D16).
//
// ACSL staff who work in this app raise and follow change requests without an ERP login. This
// function is the sales side of the door: it checks the caller's session and role here, then calls
// the ERP's change-control-intake function with a key held only in this project's secrets. The
// ERP files the request, and answers only about requests this person raised.
//
// Who the person is always comes from the session, never from the request body: their sales account
// id, their name and role from their profile, and their email only when it is confirmed (the ERP
// uses it to file the request under the same person's ERP login, if they have one).
//
// Secrets on this project: CC_ERP_URL (the ERP project's address) and CC_INTAKE_KEY (the same key
// set on the ERP project). Without both, every call answers that Change Control is not set up here.
//
//   POST application/json      {"action": "form"}
//                              {"action": "raise",   "request": {title, what_happened, what_expected,
//                                                                type, app, module, page_url, impact, context}}
//                              {"action": "list"}
//                              {"action": "reply",   "request_id": "...", "body": "..."}
//                              {"action": "confirm", "request_id": "...", "fixed": true, "note": "..."}
//   POST multipart/form-data   request_id, comment_id (optional), files (one to five screenshots)
//
// Answers are the ERP's own, passed through: plain-word refusals keep their words and status.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Who may use the door (D16: ACSL staff only). Keep in step with the change-control-link feature in
// src/lib/permissions.ts, and with its aliases: a legacy role is judged as the role it stands for.
const ALLOWED_ROLES = new Set(["super_admin", "acsl_agent_manager", "acsl_agent"]);
const ROLE_ALIASES: Record<string, string> = { super_admin_agent: "acsl_agent", admin: "partner" };

// The request fields the form may send; anything else in the body is dropped.
const REQUEST_FIELDS = ["title", "what_happened", "what_expected", "type", "app", "module", "page_url", "impact", "context"];

const MAX_FILES = 5;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ERP_TIMEOUT_MS = 25_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const refuse = (status: number, error: string) => json(status, { error });

function pickRequest(value: unknown): Record<string, unknown> {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const picked: Record<string, unknown> = { via: "sales_app" };
  for (const key of REQUEST_FIELDS) {
    // A null is left out rather than sent: the ERP reads a missing field as "not given".
    if (source[key] !== undefined && source[key] !== null) picked[key] = source[key];
  }
  return picked;
}

// Calls the ERP. Its refusals in plain words pass through; a refused key or a missing ERP secret
// means this project is set up wrong, which the person cannot fix, so they get a plain line instead.
async function erp(body: BodyInit, contentType: string | null): Promise<Response> {
  const base = (Deno.env.get("CC_ERP_URL") ?? "").replace(/\/+$/, "");
  const key = Deno.env.get("CC_INTAKE_KEY") ?? "";
  if (!base || key.length < 32) return refuse(503, "Change Control is not set up here yet.");

  let res: Response;
  try {
    res = await fetch(`${base}/functions/v1/change-control-intake`, {
      method: "POST",
      headers: { "x-cc-intake-key": key, ...(contentType ? { "Content-Type": contentType } : {}) },
      body,
      signal: AbortSignal.timeout(ERP_TIMEOUT_MS),
    });
  } catch (error) {
    console.error("change-request-intake: the ERP could not be reached:", (error as Error)?.message);
    return refuse(502, "Change Control cannot be reached at the moment. Please try again later.");
  }
  if (res.status === 401 || res.status === 503) {
    console.error("change-request-intake: the ERP refused the door itself:", res.status);
    return refuse(502, "Change Control cannot be reached at the moment. Please try again later.");
  }
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    console.error("change-request-intake: the ERP answered without JSON:", res.status);
    return refuse(502, "Change Control cannot be reached at the moment. Please try again later.");
  }
  return json(res.status, parsed);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return refuse(405, "POST only");

  // The token is read off the header and handed to getUser explicitly: a client given only a global
  // Authorization header has no session of its own and answers every valid token with "missing".
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return refuse(401, "Please sign in again.");
  const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: authError } = await admin.auth.getUser(jwt);
  const user = userData?.user;
  if (authError || !user) return refuse(401, "Please sign in again.");

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("role, status, full_name, username")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError) {
    console.error("change-request-intake: profile read failed:", profileError.message);
    return refuse(500, "Change Control could not do that just now. Please try again later.");
  }
  const role = profile?.role ? (ROLE_ALIASES[profile.role] ?? profile.role) : "";
  if (!profile || profile.status !== "active" || !ALLOWED_ROLES.has(role)) {
    return refuse(403, "Change requests are open to ACSL staff only.");
  }

  const person = {
    sales_user_id: user.id,
    name: (profile.full_name ?? "").trim() || (profile.username ?? "").trim() || "ACSL staff",
    role,
    email: user.email_confirmed_at && user.email ? user.email : null,
  };

  try {
    if ((req.headers.get("content-type") ?? "").startsWith("multipart/form-data")) {
      const form = await req.formData();
      const requestId = form.get("request_id");
      const commentId = form.get("comment_id");
      if (typeof requestId !== "string" || !UUID.test(requestId)) return refuse(400, "The request is missing or not valid.");
      if (commentId !== null && (typeof commentId !== "string" || !UUID.test(commentId))) {
        return refuse(400, "The reply is not valid.");
      }
      const files = form.getAll("files").filter((f): f is File => f instanceof File);
      if (files.length === 0) return refuse(400, "Attach at least one file.");
      if (files.length > MAX_FILES) return refuse(400, `At most ${MAX_FILES} files can be attached at a time.`);
      if (files.some((f) => f.size > MAX_FILE_BYTES)) return refuse(400, "Files can be at most 5 MB.");

      // Rebuilt, so the sales account id is the session's and nothing else in the form travels on.
      const onward = new FormData();
      onward.set("sales_user_id", person.sales_user_id);
      onward.set("request_id", requestId);
      if (typeof commentId === "string") onward.set("comment_id", commentId);
      for (const file of files) onward.append("files", file, file.name);
      return await erp(onward, null);
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return refuse(400, "Send JSON with an action.");
    const send = (payload: Record<string, unknown>) => erp(JSON.stringify(payload), "application/json");

    switch (body.action) {
      case "form":
        return await send({ action: "form" });
      case "raise":
        return await send({ action: "raise", person, request: pickRequest(body.request) });
      case "list":
        return await send({ action: "list", sales_user_id: person.sales_user_id });
      case "reply":
        return await send({
          action: "reply",
          sales_user_id: person.sales_user_id,
          request_id: body.request_id,
          body: body.body,
        });
      case "confirm":
        return await send({
          action: "confirm",
          sales_user_id: person.sales_user_id,
          request_id: body.request_id,
          fixed: body.fixed,
          note: body.note,
        });
      default:
        return refuse(400, "Unknown action.");
    }
  } catch (error) {
    console.error("change-request-intake failed:", (error as Error)?.message);
    return refuse(500, "Change Control could not do that just now. Please try again later.");
  }
});
