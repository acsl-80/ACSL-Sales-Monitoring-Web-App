// Recovery: read endpoint.
//
// R1 answers one question, "what can this caller do in Recovery", and nothing
// else. Later slices add their reads here and their writes to their own
// function, on the Data Center's pattern.
//
// WHY THIS TALKS TO POSTGRES DIRECTLY
//
// `recovery` is deliberately absent from [api].schemas in supabase/config.toml,
// and usage on it is revoked from anon and authenticated, so neither the
// browser nor supabase-js can reach it. This function opens its own
// connection for the schema and uses supabase-js only for what lives in
// `public`: verifying the caller's token and reading their profile.
//
// AUTHORITY
//
// Access is resolved here, from the caller's token, on every request. The UI
// gate in src/app/recovery/lib/access.tsx is presentation only.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { withReadConnection } from "../_shared/data-center-db.ts";
import { featuresFor, isSuperAdmin, RECOVERY_FEATURES } from "../_shared/recovery-roles.ts";

// Explicit origin list, never `*`: these answers are gated on a bearer token,
// and a permissive origin turns any page the user visits into a caller.
// RECOVERY_ALLOWED_ORIGINS (comma separated) adds hosts; Vercel previews match
// by suffix.
const DEFAULT_ORIGINS = [
  "https://sales.atmosfair.com.ng",
  "http://localhost:5173",
  "http://localhost:3000",
  "http://127.0.0.1:5173",
];
const ORIGIN_SUFFIXES = [".vercel.app"];

function originAllowed(origin: string): boolean {
  // No Origin header is a non-browser caller, authenticated by its token.
  if (!origin) return true;
  const configured = (Deno.env.get("RECOVERY_ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  return (
    [...DEFAULT_ORIGINS, ...configured].includes(origin) ||
    ORIGIN_SUFFIXES.some((s) => origin.endsWith(s))
  );
}

function corsFor(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
  if (origin && originAllowed(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function json(body: unknown, status: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

type Access = {
  hasAccess: boolean;
  accessLevel: string | null;
  features: string[];
  isSuperAdmin: boolean;
};

const NO_ACCESS: Access = { hasAccess: false, accessLevel: null, features: [], isSuperAdmin: false };

/** One round trip: the person's level and their individual grants. */
async function resolveAccess(userId: string): Promise<Access> {
  return withReadConnection(async (connection) => {
    const result = await connection.queryObject<{
      access_level: string | null;
      feature_keys: string[] | null;
    }>({
      text: `select
               (select access_level from recovery.module_access where user_id = $1) as access_level,
               (select coalesce(array_agg(feature_key), '{}')
                  from recovery.feature_grants where user_id = $1) as feature_keys`,
      args: [userId],
    });
    const level = result.rows[0]?.access_level ?? null;
    if (level === null) return NO_ACCESS;
    return {
      hasAccess: true,
      accessLevel: level,
      features: featuresFor(level, result.rows[0]?.feature_keys ?? []),
      isSuperAdmin: false,
    };
  });
}

serve(async (req) => {
  const cors = corsFor(req);

  // The allowlist is enforced in the status, not only the header: the API
  // gateway rewrites Access-Control-Allow-Origin on the way out, and it cannot
  // turn a 403 into data.
  if (!originAllowed(req.headers.get("Origin") ?? "")) {
    return json({ error: "Origin not permitted", code: "bad_origin" }, 403, cors);
  }
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") {
    return json({ error: "Method not allowed", code: "method_not_allowed" }, 405, cors);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Missing authorization header", code: "no_token" }, 401, cors);
    }
    const token = authHeader.slice("Bearer ".length);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: auth, error: authError } = await supabase.auth.getUser(token);
    if (authError || !auth?.user) {
      return json({ error: "Unauthorized", code: "invalid_token" }, 401, cors);
    }
    const userId = auth.user.id;

    const { data: profile } = await supabase
      .from("profiles")
      .select("role, status")
      .eq("id", userId)
      .single();
    if (!profile) {
      return json({ error: "No profile for this user", code: "no_profile" }, 403, cors);
    }

    let body: { action?: string } = {};
    try {
      body = await req.json();
    } catch {
      return json({ error: "Body must be JSON", code: "bad_body" }, 400, cors);
    }

    switch (body.action) {
      case "access": {
        // A disabled account holds nothing, whatever its rows say: the same
        // rule scope_organization_ids() applies to the sales app's tables.
        if (profile.status !== "active") return json({ data: NO_ACCESS }, 200, cors);

        // A super admin holds every key and needs no row, as in the Data Center.
        if (isSuperAdmin(profile.role)) {
          return json(
            {
              data: {
                hasAccess: true,
                accessLevel: null,
                features: [...RECOVERY_FEATURES],
                isSuperAdmin: true,
              } satisfies Access,
            },
            200,
            cors,
          );
        }
        return json({ data: await resolveAccess(userId) }, 200, cors);
      }

      default:
        return json({ error: "Unknown action", code: "unknown_action" }, 400, cors);
    }
  } catch (err) {
    // Full detail to the log, a calm message to the caller, nothing internal.
    console.error("[recovery-read]", err);
    return json({ error: "Something went wrong. Please try again.", code: "server_error" }, 500, cors);
  }
});
