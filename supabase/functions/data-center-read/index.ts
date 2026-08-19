// Data Center: read endpoint.
//
// WHY THIS TALKS TO POSTGRES DIRECTLY
//
// `data_center` is deliberately absent from [api].schemas in
// supabase/config.toml, so PostgREST does not expose it and supabase-js
// `.from(...)` / `.schema(...)` cannot reach it. That omission is the module's
// isolation guarantee, and it is what stops the sales-mobile Flutter app ever
// seeing this data, since mobile talks to the same PostgREST API.
//
// The consequence is that this function opens its own Postgres connection.
// supabase-js is still used, but only for the two things that live in `public`:
// verifying the caller's JWT and reading their role.
//
// AUTHORITY
//
// Tier-2 grants are resolved here, from the caller's token, on every request.
// The UI gate in src/app/data-center/lib/access.tsx is presentation only.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { Pool } from "https://deno.land/x/postgres@v0.17.0/mod.ts";

// Explicit origin allowlist rather than `*`. The rest of this repo uses `*`;
// this module does not, because these responses are gated on a bearer token and
// a permissive origin turns any page the user visits into a caller.
// Override with DATA_CENTER_ALLOWED_ORIGINS (comma separated) if a new host
// appears; Vercel preview URLs are matched by suffix.
const DEFAULT_ORIGINS = [
  "https://sales.atmosfair.com.ng",
  "http://localhost:5173",
  "http://localhost:3000",
  "http://127.0.0.1:5173",
];
const ORIGIN_SUFFIXES = [".vercel.app"];

function originAllowed(origin: string): boolean {
  // No Origin header at all means a non-browser caller (curl, server to
  // server). Those are authenticated by bearer token and are not subject to
  // the same-origin rules this list exists to enforce.
  if (!origin) return true;
  const configured = (Deno.env.get("DATA_CENTER_ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  return (
    [...DEFAULT_ORIGINS, ...configured].includes(origin) ||
    ORIGIN_SUFFIXES.some((s) => origin.endsWith(s))
  );
}

function resolveCors(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
  if (originAllowed(origin) && origin) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function json(body: unknown, status: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

// Mirrors ROLE_ALIASES in src/lib/permissions.ts: only the literal
// `super_admin` short-circuits every check. `super_admin_agent` resolves to
// `acsl_agent` there and must not be treated as a super admin here.
function isSuperAdmin(role: string | null): boolean {
  return role === "super_admin";
}

let pool: Pool | null = null;
function getPool(): Pool {
  if (!pool) {
    const dbUrl = Deno.env.get("SUPABASE_DB_URL");
    if (!dbUrl) throw new Error("SUPABASE_DB_URL is not configured");
    pool = new Pool(dbUrl, 3, true);
  }
  return pool;
}

/**
 * What each access level is entitled to, before any explicit per-feature
 * grants are added on top. This mapping is THE authority; the copy in
 * src/app/data-center/lib/features.ts exists only for labels. If they ever
 * disagree, this one wins and the UI is what is wrong.
 */
const ROLE_FEATURES: Record<string, string[]> = {
  viewer: ["records.view", "call_records.view", "dashboard.view"],
  editor: [
    "records.view",
    "call_records.view",
    "dashboard.view",
    "call_records.edit",
    "import.upload",
    "import.exceptions",
  ],
};

async function resolveAccess(userId: string): Promise<{
  accessRole: string | null;
  features: string[];
}> {
  const connection = await getPool().connect();
  try {
    const access = await connection.queryObject<{ access_role: string }>({
      text: "select access_role from data_center.module_access where user_id = $1",
      args: [userId],
    });
    const accessRole = access.rows[0]?.access_role ?? null;

    const grants = await connection.queryObject<{ feature_key: string }>({
      text: "select feature_key from data_center.feature_grants where user_id = $1",
      args: [userId],
    });

    // Union of what the level implies and what was granted individually.
    const features = new Set<string>(accessRole ? ROLE_FEATURES[accessRole] ?? [] : []);
    for (const row of grants.rows) features.add(row.feature_key);

    return { accessRole, features: [...features] };
  } finally {
    connection.release();
  }
}

serve(async (req) => {
  const cors = resolveCors(req);

  // Enforce the allowlist in the STATUS, not only in the header.
  //
  // Verified locally: the Supabase API gateway (Kong) overwrites
  // Access-Control-Allow-Origin with `*` on the way out, so omitting the header
  // achieves nothing on its own. A proxy can rewrite a header; it cannot turn a
  // 403 with no payload into data. This is the check that actually holds.
  const requestOrigin = req.headers.get("Origin") ?? "";
  if (!originAllowed(requestOrigin)) {
    return json({ error: "Origin not permitted", code: "bad_origin" }, 403, cors);
  }

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }
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
      .select("role, organization_id")
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
        const superAdmin = isSuperAdmin(profile.role);
        // Super admin holds everything implicitly and needs no module_access
        // row, exactly as usePermissions short-circuits in the host app.
        // Everyone else has access only if a row grants it, case by case.
        const resolved = superAdmin
          ? { accessRole: null, features: [] as string[] }
          : await resolveAccess(userId);
        return json(
          {
            data: {
              hasAccess: superAdmin || resolved.accessRole !== null,
              accessRole: resolved.accessRole,
              features: resolved.features,
              isSuperAdmin: superAdmin,
              organizationId: profile.organization_id ?? null,
            },
          },
          200,
          cors,
        );
      }

      default:
        return json(
          { error: `Unknown action: ${body.action ?? "(none)"}`, code: "unknown_action" },
          400,
          cors,
        );
    }
  } catch (err) {
    // Block 34: full detail to the log, a calm message to the caller, and
    // nothing internal leaked either way.
    console.error("[data-center-read]", err);
    return json({ error: "Data Center request failed", code: "internal" }, 500, cors);
  }
});
