// Data Center: access administration.
//
// Grants and revokes module access (viewer / editor), searches profiles to
// grant against, and serves the change log. Callable only by a super admin or
// a holder of the grants.manage feature; everyone else gets a 403 no matter
// what the UI showed them.
//
// Every write runs inside a transaction that first sets
// set_config('data_center.actor', <caller>, true), which is how the audit
// trigger knows WHO made the change on a service-role connection where
// auth.uid() means nothing. That is the mechanism behind "changes from
// editors will be tracked" — the trigger writes the log, application code
// never does.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { withConnection, withReadConnection } from "../_shared/data-center-db.ts";
import { ROLE_FEATURES } from "../_shared/data-center-roles.ts";

const DEFAULT_ORIGINS = [
  "https://sales.atmosfair.com.ng",
  "http://localhost:5173",
  "http://localhost:3000",
  "http://127.0.0.1:5173",
];
const ORIGIN_SUFFIXES = [".vercel.app"];

function originAllowed(origin: string): boolean {
  if (!origin) return true; // non-browser caller, authenticated by bearer token
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

function isSuperAdmin(role: string | null): boolean {
  return role === "super_admin";
}


/**
 * Read from the shared role table rather than restated here. The three-level UI
 * shipped against a two-entry list, so granting "call agent" came back 400 with
 * a message naming only viewer and editor. One definition means the next level
 * added is accepted the day it exists.
 */
const VALID_ROLES = new Set(Object.keys(ROLE_FEATURES));

/**
 * Which part of the module a tracked table belongs to.
 *
 * Kept as SQL so the filter runs in the database, and kept in one place so the
 * UI's chips and the query agree by construction. A table added to the audit
 * triggers without a home here lands in "other", which is visible rather than
 * silently dropped.
 */
const CHANGE_CATEGORY_SQL = `case cl.table_name
  when 'call_records'        then 'call_records'
  when 'call_attempts'       then 'calls'
  when 'record_consignments' then 'documents'
  when 'import_batches'      then 'imports'
  when 'assignment_batches'  then 'assignment'
  when 'module_access'       then 'access'
  when 'feature_grants'      then 'access'
  when 'call_agent_profiles' then 'access'
  when 'workflow_config'     then 'configuration'
  when 'option_lists'        then 'configuration'
  when 'option_values'       then 'configuration'
  when 'field_defs'          then 'configuration'
  else 'other'
end`;

const CHANGE_CATEGORIES = new Set([
  "call_records", "calls", "documents", "imports",
  "assignment", "access", "configuration", "other",
]);

serve(async (req) => {
  const cors = resolveCors(req);

  const requestOrigin = req.headers.get("Origin") ?? "";
  if (!originAllowed(requestOrigin)) {
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
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );
    const { data: auth, error: authError } = await supabase.auth.getUser(
      authHeader.slice("Bearer ".length),
    );
    if (authError || !auth?.user) {
      return json({ error: "Unauthorized", code: "invalid_token" }, 401, cors);
    }
    const callerId = auth.user.id;

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", callerId)
      .single();
    if (!profile) {
      return json({ error: "No profile for this user", code: "no_profile" }, 403, cors);
    }

    // Authority check, server-side, before anything else. The UI hiding the
    // access section is presentation; this is the permission.
    let allowed = isSuperAdmin(profile.role);
    if (!allowed) {
      allowed = await withReadConnection(async (conn) => {
        const g = await conn.queryObject<{ n: number }>({
          text: `select count(*)::int n from data_center.feature_grants
                 where user_id = $1 and feature_key = 'grants.manage'`,
          args: [callerId],
        });
        return (g.rows[0]?.n ?? 0) > 0;
      });
    }
    if (!allowed) {
      return json({ error: "Not permitted to manage access", code: "forbidden" }, 403, cors);
    }

    let body: {
      action?: string;
      userId?: string;
      accessRole?: string;
      query?: string;
      limit?: number;
    } = {};
    try {
      body = await req.json();
    } catch {
      return json({ error: "Body must be JSON", code: "bad_body" }, 400, cors);
    }

    return await withConnection(async (conn) => {
      switch (body.action) {
        case "access_list": {
          const rows = await conn.queryObject({
            text: `select ma.user_id, ma.access_role, ma.granted_at,
                          p.full_name, p.email, p.role as app_role,
                          gb.full_name as granted_by_name
                   from data_center.module_access ma
                   join public.profiles p on p.id = ma.user_id
                   left join public.profiles gb on gb.id = ma.granted_by
                   order by ma.granted_at desc`,
          });
          return json({ data: rows.rows }, 200, cors);
        }

        case "user_search": {
          const q = (body.query ?? "").trim();
          if (q.length < 2) return json({ data: [] }, 200, cors);
          const rows = await conn.queryObject({
            text: `select p.id, p.full_name, p.email, p.role,
                          ma.access_role as current_access
                   from public.profiles p
                   left join data_center.module_access ma on ma.user_id = p.id
                   where p.email ilike '%' || $1 || '%'
                      or p.full_name ilike '%' || $1 || '%'
                      or p.username ilike '%' || $1 || '%'
                   order by p.full_name nulls last
                   limit 20`,
            args: [q],
          });
          return json({ data: rows.rows }, 200, cors);
        }

        case "access_grant":
        case "access_update": {
          if (!body.userId || !VALID_ROLES.has(body.accessRole ?? "")) {
            return json(
              {
                error: `userId and accessRole (${[...VALID_ROLES].join(", ")}) are required`,
                code: "bad_input",
              },
              400,
              cors,
            );
          }
          await conn.queryObject("begin");
          try {
            await conn.queryObject({
              text: "select set_config('data_center.actor', $1, true)",
              args: [callerId],
            });
            await conn.queryObject({
              text: `insert into data_center.module_access (user_id, access_role, granted_by)
                     values ($1, $2, $3)
                     on conflict (user_id) do update
                       set access_role = excluded.access_role,
                           updated_by = $3, updated_at = now()`,
              args: [body.userId, body.accessRole, callerId],
            });
            await conn.queryObject("commit");
          } catch (e) {
            await conn.queryObject("rollback");
            throw e;
          }
          return json({ data: { userId: body.userId, accessRole: body.accessRole } }, 200, cors);
        }

        case "access_revoke": {
          if (!body.userId) {
            return json({ error: "userId is required", code: "bad_input" }, 400, cors);
          }
          await conn.queryObject("begin");
          try {
            await conn.queryObject({
              text: "select set_config('data_center.actor', $1, true)",
              args: [callerId],
            });
            await conn.queryObject({
              text: "delete from data_center.module_access where user_id = $1",
              args: [body.userId],
            });
            await conn.queryObject("commit");
          } catch (e) {
            await conn.queryObject("rollback");
            throw e;
          }
          return json({ data: { userId: body.userId, revoked: true } }, 200, cors);
        }

        case "change_log": {
          const limit = Math.min(Math.max(body.limit ?? 25, 1), 200);
          const category = typeof body.category === "string" && body.category !== "all"
            ? body.category
            : null;
          if (category && !CHANGE_CATEGORIES.has(category)) {
            return json({ error: `Unknown category: ${category}`, code: "bad_input" }, 400, cors);
          }
          const rows = await conn.queryObject({
            // id cast to text: it is a bigint, which arrives as a JS BigInt
            // and JSON.stringify throws on those.
            //
            // The category is derived here rather than in the UI so there is
            // one definition of which table belongs to which part of the
            // module, and so the filter can run in the database instead of
            // fetching everything and hiding most of it.
            //
            // changed_fields is the difference between the two snapshots the
            // trigger already stores. Without it an update reads as "something
            // changed", which is what made this log unusable.
            text: `with tagged as (
                     select cl.id::text as id, cl.table_name, cl.record_pk, cl.action,
                            cl.changed_at, p.full_name as changed_by_name,
                            ${CHANGE_CATEGORY_SQL} as category,
                            case
                              when cl.action = 'UPDATE' then (
                                select coalesce(array_agg(k order by k), '{}')
                                from jsonb_object_keys(coalesce(cl.new_values, '{}'::jsonb)) k
                                where coalesce(cl.new_values -> k, 'null'::jsonb)
                                      is distinct from coalesce(cl.old_values -> k, 'null'::jsonb)
                                  and k not in ('updated_at', 'updated_by', 'created_at', 'created_by')
                              )
                              else '{}'::text[]
                            end as changed_fields
                     from data_center.change_log cl
                     left join public.profiles p on p.id = cl.changed_by
                   )
                   select * from tagged
                   where $2::text is null or category = $2::text
                   order by changed_at desc
                   limit $1`,
            args: [limit, category],
          });
          return json({ data: rows.rows }, 200, cors);
        }

        default:
          return json(
            { error: `Unknown action: ${body.action ?? "(none)"}`, code: "unknown_action" },
            400,
            cors,
          );
      }
    });
  } catch (err) {
    console.error("[data-center-admin]", err);
    return json({ error: "Data Center request failed", code: "internal" }, 500, cors);
  }
});
