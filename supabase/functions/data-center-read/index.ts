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
import { resolveAssignedOrgIds } from "../_shared/resolveAssignedOrgIds.ts";
import { withReadConnection } from "../_shared/data-center-db.ts";
import { BadRequest, buildRecordsQuery, toPage } from "./records-query.ts";
import type { ScopeInput } from "./scope.ts";

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

/**
 * Which sales this caller may see, resolved the way the sales app resolves it.
 *
 * ACSL roles carry assignments that live in their own tables, and a manager
 * additionally inherits their team's. Both are read through the sales app's own
 * helper rather than reimplemented, so the two can never drift into disagreeing
 * about who sees what.
 */
async function resolveScope(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  role: string | null,
  organizationId: string | null,
): Promise<ScopeInput> {
  const scope: ScopeInput = { role, userId, organizationId };

  if (role === "acsl_agent" || role === "acsl_agent_manager" || role === "super_admin_agent") {
    const resolved = await resolveAssignedOrgIds(supabase, userId);
    scope.assignedOrgIds = resolved.assignedOrgIds;
  }

  if (role === "acsl_agent_manager") {
    const { data: subordinates } = await supabase
      .from("profiles")
      .select("id")
      .eq("manager_id", userId)
      .eq("role", "acsl_agent");
    scope.teamAgentIds = [userId, ...(subordinates ?? []).map((s: { id: string }) => s.id)];
  }

  return scope;
}

async function resolveAccess(userId: string): Promise<{
  accessRole: string | null;
  features: string[];
}> {
  return withReadConnection(async (connection) => {
    // One round trip rather than two. Every connection this function holds is
    // one the rest of the project cannot have, so the cheapest query is the one
    // that is not sent.
    const result = await connection.queryObject<{
      access_role: string | null;
      feature_keys: string[] | null;
    }>({
      text: `select
               (select access_role from data_center.module_access where user_id = $1) as access_role,
               (select coalesce(array_agg(feature_key), '{}')
                  from data_center.feature_grants where user_id = $1) as feature_keys`,
      args: [userId],
    });
    const accessRole = result.rows[0]?.access_role ?? null;
    const grants = { rows: (result.rows[0]?.feature_keys ?? []).map((feature_key) => ({ feature_key })) };

    // Union of what the level implies and what was granted individually.
    const features = new Set<string>(accessRole ? ROLE_FEATURES[accessRole] ?? [] : []);
    for (const row of grants.rows) features.add(row.feature_key);

    return { accessRole, features: [...features] };
  });
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

    let body: { action?: string; [key: string]: unknown } = {};
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

      case "records":
      case "call_queue": {
        const table = body.action === "call_queue" ? "call_center" : "records";
        // Table 1 and Table 2 are separate grants: seeing sold stove records
        // does not imply seeing what the call centre wrote about the people who
        // bought them.
        const needed = table === "call_center" ? "call_records.view" : "records.view";

        const superAdmin = isSuperAdmin(profile.role);
        const resolved = superAdmin
          ? { accessRole: null, features: [] as string[] }
          : await resolveAccess(userId);

        // Two gates, both server-side. Entry to the module at all, then the
        // feature itself. The UI checks the same things, but only so it can
        // avoid offering an action that would be refused here.
        if (!superAdmin && resolved.accessRole === null) {
          return json({ error: "No Data Center access", code: "no_access" }, 403, cors);
        }
        if (!superAdmin && !resolved.features.includes(needed)) {
          return json({ error: "Not permitted", code: "no_feature" }, 403, cors);
        }

        const scope = await resolveScope(
          supabase,
          userId,
          profile.role,
          profile.organization_id ?? null,
        );

        let built;
        try {
          built = buildRecordsQuery(
            {
              table,
              cursor: (body.cursor ?? null) as never,
              limit: body.limit as number | undefined,
              direction: body.direction as "asc" | "desc" | undefined,
              filters: (body.filters ?? {}) as never,
            },
            scope,
          );
        } catch (err) {
          if (err instanceof BadRequest) {
            return json({ error: err.message, code: "bad_request" }, 400, cors);
          }
          throw err;
        }

        return await withReadConnection(async (connection) => {
          // Two statements, deliberately. See the note at the top of
          // records-query.ts: as one query the call queue took 25.8 seconds at
          // 500,000 rows, and split it takes about 40 milliseconds.
          const picked = await connection.queryObject<{ id: string; sales_date: string | null }>({
            text: built.pick.text,
            args: built.pick.args,
          });
          const page = toPage(picked.rows, built.pageSize);

          let rows: Record<string, unknown>[] = [];
          if (page.ids.length > 0) {
            const hydrate = built.hydrate(page.ids);
            const result = await connection.queryObject<Record<string, unknown>>({
              text: hydrate.text,
              args: hydrate.args,
            });
            rows = result.rows;
          }

          return json(
            {
              data: {
                rows,
                nextCursor: page.nextCursor,
                hasMore: page.hasMore,
                pageSize: built.pageSize,
                // What the caller is looking at, so the table can say so rather
                // than leaving a partner wondering why the count seems low.
                scope: built.scopeDescription,
              },
            },
            200,
            cors,
          );
        });
      }

      /**
       * The dashboard.
       *
       * Reads data_center.v_current_metrics and nothing else. There is no
       * count(*), no sum() and no group by anywhere in this branch, which is
       * the rule the whole compute/read split exists to keep. Measured at
       * 500,000 sales this returns in 2.3 ms, and it would return in 2.3 ms at
       * five million, because it never touches sales.
       */
      case "dashboard": {
        const superAdmin = isSuperAdmin(profile.role);
        const resolved = superAdmin
          ? { accessRole: null, features: [] as string[] }
          : await resolveAccess(userId);

        if (!superAdmin && resolved.accessRole === null) {
          return json({ error: "No Data Center access", code: "no_access" }, 403, cors);
        }
        if (!superAdmin && !resolved.features.includes("dashboard.view")) {
          return json({ error: "Not permitted", code: "no_feature" }, 403, cors);
        }

        return await withReadConnection(async (connection) => {
          const metrics = await connection.queryObject({
            text: `select metric_key, dimension, value_num, value_text,
                          run_finished_at
                   from data_center.v_current_metrics
                   order by metric_key, value_num desc nulls last`,
          });
          const staleAfter = await connection.queryObject<{ hours: number }>({
            text: `select coalesce(value::text::int, 24) as hours
                   from data_center.workflow_config where key = 'metrics.stale_after_hours'`,
          });
          const lastRun = await connection.queryObject<{
            finished_at: string | null; status: string; duration_ms: number | null;
          }>({
            text: `select finished_at, status, duration_ms from data_center.metric_runs
                   order by started_at desc limit 1`,
          });

          const finishedAt = metrics.rows[0]
            ? (metrics.rows[0] as { run_finished_at: string }).run_finished_at
            : null;
          const hours = staleAfter.rows[0]?.hours ?? 24;
          // Said plainly rather than left to the reader. Numbers with no date
          // on them get treated as current, and these might not be.
          const isStale = finishedAt
            ? (Date.now() - new Date(finishedAt).getTime()) > hours * 3_600_000
            : true;

          return json(
            {
              data: {
                metrics: metrics.rows,
                computedAt: finishedAt,
                isStale,
                staleAfterHours: hours,
                lastRun: lastRun.rows[0] ?? null,
              },
            },
            200,
            cors,
          );
        });
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
