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
import { featuresFor } from "../_shared/data-center-roles.ts";
import {
  BadRequest,
  buildRecordsQuery,
  type CompletenessContext,
  SHEET_PAGE_SIZE,
  toPage,
  COUNT_CEILING,
} from "./records-query.ts";
import { buildScopeSql, buildTransferScopeSql, type ScopeInput } from "./scope.ts";

/**
 * One stove's audit history, as SQL three places agree on.
 *
 * The stove page shows the newest few and the "show more" endpoint pages the
 * rest. Written twice they would drift: a change the page counted as
 * meaningful and the pager did not would make the total say 128 while the list
 * could only ever reach 126, and nobody would be able to say which was lying.
 */
const CHANGES_SELECT = `select cl.id::text as id, cl.table_name, cl.action,
                               cl.changed_at,
                               /*
                                * The same value again, as text, and it is the
                                * one the cursor is built from.
                                *
                                * The Postgres driver hands timestamptz back as
                                * a JavaScript Date, and a Date holds
                                * milliseconds while the column holds
                                * microseconds. Round-tripped through JS,
                                * 05:00:19.435587 becomes 05:00:19.435 - which
                                * is EARLIER than the row it names. The next
                                * page then asks for rows strictly older than
                                * that, and every row inside the same
                                * millisecond is excluded, id tiebreaker and
                                * all.
                                *
                                * Not theoretical: measured on this database at
                                * one such boundary, a full-precision cursor
                                * reaches 17 rows and the truncated one reaches
                                * 2. Those clusters are what a batch commit
                                * writes - now() is transaction start time, so
                                * every audit row in one transaction shares a
                                * timestamp exactly.
                                *
                                * records-query.ts already carries this lesson
                                * for sales_date, in almost these words.
                                */
                               cl.changed_at::text as cursor_at,
                               p.full_name as changed_by_name,
                               p.email as changed_by_email,
                               case when cl.action = 'UPDATE' then (
                                 select coalesce(array_agg(k order by k), '{}')
                                   from jsonb_object_keys(coalesce(cl.new_values, '{}'::jsonb)) k
                                  where coalesce(cl.new_values -> k, 'null'::jsonb)
                                        is distinct from coalesce(cl.old_values -> k, 'null'::jsonb)
                                    and k not in ('updated_at','updated_by','created_at','created_by')
                               ) else '{}'::text[] end as changed_fields
                          from data_center.change_log cl
                          left join public.profiles p on p.id = cl.changed_by`;

/** $1 is the sale, $2 the assignment batch. Either may be an empty string. */
const CHANGES_WHERE = `((cl.table_name = 'call_records' and cl.record_pk = $1)
                     or (cl.table_name = 'assignment_batches' and cl.record_pk = $2))`;

/*
 * An update that changed nothing is not history.
 *
 * Two triggers touch a batch's updated_at whenever a call is logged against
 * it, and each of those writes an audit row whose only difference is a
 * timestamp the diff already excludes. Left in, they outnumber the real edits
 * and bury them - and they would inflate the total the page prints beside the
 * list it can actually show.
 */
const CHANGES_MEANINGFUL = `(cl.action <> 'UPDATE' or exists (
                              select 1 from jsonb_object_keys(
                                       coalesce(cl.new_values, '{}'::jsonb)) k
                               where coalesce(cl.new_values -> k, 'null'::jsonb)
                                     is distinct from coalesce(cl.old_values -> k, 'null'::jsonb)
                                 and k not in ('updated_at','updated_by','created_at','created_by')
                            ))`;

/** How many edits the stove page shows before somebody asks for more. */
const STOVE_CHANGES_FIRST_PAGE = 5;


// Explicit origin allowlist rather than `*`. The rest of this repo uses `*`;
// this module does not, because these responses are gated on a bearer token and
// a permissive origin turns any page the user visits into a caller.
// Override with DATA_CENTER_ALLOWED_ORIGINS (comma separated) if a new host
// appears; Vercel preview URLs are matched by suffix.
/** The id shape every drill parameter has to be before it reaches SQL. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    return {
      accessRole,
      features: featuresFor(accessRole, grants.rows.map((r) => r.feature_key)),
    };
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

        /*
         * The completeness filter is resolved by the database, not by a list
         * held here: missing_predicate validates the name against the rule as
         * configured and returns the predicate, or raises, which is a 400. It is
         * resolved on the same connection that runs the page, because a
         * connection costs more than a statement (see data-center-db.ts).
         */
        const missingField = (body.filters as Record<string, unknown> | undefined)?.missingField;
        if (missingField !== undefined) {
          if (table !== "records") {
            return json({ error: "The completeness filter belongs to the records table", code: "bad_request" }, 400, cors);
          }
          if (typeof missingField !== "string" || missingField.length === 0 || missingField.length > 64) {
            return json({ error: "Unknown completeness field", code: "bad_request" }, 400, cors);
          }
        }

        return await withReadConnection(async (connection) => {
          let completeness: CompletenessContext | null = null;
          if (typeof missingField === "string") {
            try {
              const predicate = await connection.queryObject<{ sql: string }>({
                text: "select data_center.missing_predicate($1, 's') as sql",
                args: [missingField],
              });
              completeness = { missingSql: predicate.rows[0].sql };
            } catch {
              return json({ error: "Unknown completeness field", code: "bad_request" }, 400, cors);
            }
          }

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
              undefined,
              completeness,
            );
          } catch (err) {
            if (err instanceof BadRequest) {
              return json({ error: err.message, code: "bad_request" }, 400, cors);
            }
            throw err;
          }

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

          /*
           * How many match, on the first page of a filter only.
           *
           * "1,247 records" and "100 loaded, more available" are different
           * facts, and only the first one tells somebody whether their filter
           * worked. It is asked once per filter rather than once per page
           * because the answer does not change as you scroll, and a third
           * statement on every page would undo the point of the two-statement
           * split above.
           *
           * Capped at COUNT_CEILING, so an unfiltered table answers "10,000+"
           * in bounded time rather than counting half a million index entries
           * to tell somebody something they cannot use.
           */
          let total: number | null = null;
          let totalIsCapped = false;
          if (!body.cursor) {
            const counted = await connection.queryObject<{ total: number }>({
              text: built.count.text,
              args: built.count.args,
            });
            total = Number(counted.rows[0]?.total ?? 0);
            totalIsCapped = total >= COUNT_CEILING;
          }

          return json(
            {
              data: {
                rows,
                nextCursor: page.nextCursor,
                hasMore: page.hasMore,
                pageSize: built.pageSize,
                /** Null on continuation pages: it was answered on page one. */
                total,
                /** True means "at least this many", not "exactly". */
                totalIsCapped,
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

        /*
         * Bounds are months, not dates. Validated here rather than trusted,
         * because they are compared as text against a jsonb field and
         * "2026-08" sorting correctly is the whole mechanism. Same rule as the
         * analysis action, deliberately: two surfaces that accept a period
         * should not disagree about what one looks like.
         */
        const DASH_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
        const periodFrom = typeof body.from === "string" && body.from ? body.from : null;
        const periodTo = typeof body.to === "string" && body.to ? body.to : null;
        if ((periodFrom && !DASH_MONTH.test(periodFrom)) || (periodTo && !DASH_MONTH.test(periodTo))) {
          return json(
            { error: "from and to must look like 2026-08", code: "bad_period" },
            400,
            cors,
          );
        }
        if (periodFrom && periodTo && periodFrom > periodTo) {
          return json({ error: "from is after to", code: "bad_period" }, 400, cors);
        }

        return await withReadConnection(async (connection) => {
          // One statement, not three.
          //
          // Measured against the preview branch, a round trip from an edge
          // function to Postgres costs far more than the query does: a
          // one-query action answers in about 650 ms and a three-query action
          // in about 3 seconds, on data small enough that every query is
          // sub-millisecond. Since Phase 4 stopped pooling connections between
          // requests (which was taking the database down), the number of
          // statements per request is the thing worth minimising.
          const result = await connection.queryObject<{
            metrics: unknown[] | null;
            periodic_keys: unknown[] | null;
            stale_after_hours: number;
            last_run: unknown | null;
            computed_at: string | null;
          }>({
            text: `with cur as (
                     /*
                      * The Analysis area writes its own families into the same
                      * run, also at month grain, which is tens of thousands of
                      * rows. This page renders none of them, so without that
                      * filter the Dashboard silently pays for a payload it
                      * never reads. The e2e spec asserts no 'analysis.' key
                      * reaches here, because the day somebody adds a family and
                      * forgets is the day this gets slow for no visible reason.
                      */
                     select metric_key, dimension, value_num, value_text, run_finished_at
                       from data_center.v_current_metrics
                      where metric_key not like 'analysis.%'
                   ),
                   periodised as (
                     /*
                      * Which families can answer for a period at all.
                      *
                      * Read off the data rather than kept as a list here, so a
                      * family that gains or loses a period in compute_metrics
                      * cannot leave this function describing the old shape.
                      * Two averages and the three import counters carry none on
                      * purpose: a sum of monthly averages is not an average,
                      * and an import batch spans many consignments.
                      */
                     select distinct metric_key from cur
                      where dimension ->> 'period' is not null
                   )
                   select
                     /*
                      * Stored at month grain, so a range is a sum of months and
                      * the period key is stripped from the dimension
                      * afterwards. That leaves exactly the shape the page
                      * already renders, so asking for no period returns what it
                      * always returned.
                      *
                      * Three cases, and the middle one is the fix. A family
                      * that HAS periods narrows to the range. A family that has
                      * NONE passes through whole, because it is an all-time
                      * figure and dropping it would tell the reader zero when
                      * the truth is that the number does not vary by month.
                      * Before this, selecting a period emptied Sold, Verified,
                      * all four bar charts and five support cards.
                      *
                      * A row with no period inside a family that has them is a
                      * shipment whose sold-to-partner date is unusable. It
                      * belongs in the all-time view and in no particular month,
                      * so a range drops it.
                      */
                     (select coalesce(jsonb_agg(t order by t.metric_key, t.value_num desc nulls last), '[]'::jsonb)
                        from (select metric_key,
                                     (dimension - 'period') as dimension,
                                     sum(value_num) as value_num,
                                     min(value_text) as value_text,
                                     max(run_finished_at) as run_finished_at
                                from cur
                               where ($1::text is null and $2::text is null)
                                  or metric_key not in (select metric_key from periodised)
                                  or (dimension ->> 'period' is not null
                                      and ($1::text is null or dimension ->> 'period' >= $1)
                                      and ($2::text is null or dimension ->> 'period' <= $2))
                               group by 1, 2) t) as metrics,
                     /*
                      * Told to the client rather than inferred there, so the
                      * page can mark one card "all time" while its neighbours
                      * say "in the period shown", without keeping a second copy
                      * of this list in the UI to drift out of date.
                      */
                     (select coalesce(jsonb_agg(metric_key order by metric_key), '[]'::jsonb)
                        from periodised) as periodic_keys,
                     (select coalesce(value::text::int, 24) from data_center.workflow_config
                       where key = 'metrics.stale_after_hours') as stale_after_hours,
                     (select to_jsonb(r) from (
                        select finished_at, status, duration_ms
                        from data_center.metric_runs order by started_at desc limit 1) r) as last_run,
                     -- Per family, not per run: a pool-only run carries the other
                     -- families forward with the moment they were computed, so
                     -- "computed at" and staleness read the sales families' own
                     -- timestamp rather than the newest run's.
                     (select max(computed_at) from data_center.v_current_metrics
                       where metric_key not like 'pool.%') as computed_at,
                     (select max(computed_at) from data_center.v_current_metrics
                       where metric_key like 'pool.%') as pool_computed_at`,
            args: [periodFrom, periodTo],
          });

          const row = result.rows[0];
          const metrics = (row?.metrics ?? []) as Record<string, unknown>[];
          const finishedAt = row?.computed_at ?? null;
          const hours = Number(row?.stale_after_hours ?? 24);

          // Said plainly rather than left to the reader. Numbers with no date
          // on them get treated as current, and these might not be.
          const isStale = finishedAt
            ? (Date.now() - new Date(finishedAt).getTime()) > hours * 3_600_000
            : true;

          return json(
            {
              data: {
                metrics,
                periodicKeys: (row?.periodic_keys ?? []) as string[],
                computedAt: finishedAt,
                poolComputedAt: row?.pool_computed_at ?? null,
                isStale,
                staleAfterHours: hours,
                lastRun: row?.last_run ?? null,
              },
            },
            200,
            cors,
          );
        });
      }

      /**
       * The reconciliation funnel: what was sold to a partner against what has
       * come back.
       *
       * Reads `transfer_funnel`, which a compute run maintains. It does not
       * read the view of the same name: that one aggregates over public.sales,
       * and this module does not do that in a request. See the note at the top
       * of 20260821010000_data_center_transfers.sql for what it cost to learn
       * that the hard way.
       */
      /**
       * The Analysis area: cross-tabs, buckets and gate chains.
       *
       * WHY THIS AGGREGATES, WHEN THE READ PATH IS NOT ALLOWED TO
       *
       * The rule is that `count`/`sum`/`group by` over **public.sales** belongs
       * in compute. This sums `metric_snapshots`, which compute already wrote -
       * thousands of rows, indexed on (run_id, metric_key, period). Summing
       * precomputed months is the entire reason for storing months.
       *
       * WHY MONTHS AT ALL
       *
       * Every analysis metric is filed under a month, so a quarter, a half, a
       * year, a rolling window and one year against another are all the same
       * query with different bounds. Precomputing each named period instead
       * would multiply both the rows and the passes over sales by the number
       * of periods offered, and still could not answer a range nobody thought
       * to list.
       *
       * Two shapes come back because two things are being drawn:
       *
       *   totals   the range collapsed, `period` stripped from the dimension.
       *            What the cross-tabs and the funnel render.
       *   series   per month, with the first axis collapsed away. What the
       *            trend lines render. Small on purpose: keeping partner AND
       *            month AND bucket would be the full cross product, which is
       *            tens of thousands of rows for a chart with twelve points.
       *
       * The band definitions travel with the data so the client colours a bar
       * from `severity` in workflow_config rather than from a hex it holds. A
       * threshold re-graded in Settings has to move the chart, or it is not
       * configuration.
       */
      case "analysis": {
        const superAdmin = isSuperAdmin(profile.role);
        const resolved = superAdmin
          ? { accessRole: null, features: [] as string[] }
          : await resolveAccess(userId);

        if (!superAdmin && resolved.accessRole === null) {
          return json({ error: "No Data Center access", code: "no_access" }, 403, cors);
        }
        if (!superAdmin && !resolved.features.includes("analysis.view")) {
          return json({ error: "Not permitted", code: "no_feature" }, 403, cors);
        }

        // Bounds are months, not dates. Validated here rather than trusted,
        // because they are interpolated as text comparisons against a jsonb
        // field and "2026-08" sorting correctly is the whole mechanism.
        const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
        const from = typeof body.from === "string" && body.from ? body.from : null;
        const to = typeof body.to === "string" && body.to ? body.to : null;
        if ((from && !MONTH.test(from)) || (to && !MONTH.test(to))) {
          return json(
            { error: "from and to must look like 2026-08", code: "bad_period" },
            400,
            cors,
          );
        }
        if (from && to && from > to) {
          return json({ error: "from is after to", code: "bad_period" }, 400, cors);
        }

        return await withReadConnection(async (connection) => {
          const result = await connection.queryObject<{
            totals: unknown[] | null;
            series: unknown[] | null;
            months: unknown[] | null;
            stock_bands: unknown[] | null;
            velocity_bands: unknown[] | null;
            stale_after_hours: number;
            last_run: unknown | null;
            computed_at: string | null;
          }>({
            text: `select
                     (select coalesce(jsonb_agg(t), '[]'::jsonb) from (
                        select metric_key,
                               (dimension - 'period') as dimension,
                               sum(value_num) as value_num
                          from data_center.v_current_metrics
                         where metric_key like 'analysis.%'
                           and ($1::text is null or dimension ->> 'period' >= $1)
                           and ($2::text is null or dimension ->> 'period' <= $2)
                         group by 1, 2) t) as totals,
                     (select coalesce(jsonb_agg(t), '[]'::jsonb) from (
                        select metric_key,
                               dimension ->> 'by'          as by,
                               dimension ->> 'by2'         as by2,
                               dimension ->> 'key2'        as key2,
                               dimension ->> 'label2'      as label2,
                               (dimension ->> 'ord2')::int as ord2,
                               dimension ->> 'period'      as period,
                               sum(value_num) as value_num
                          from data_center.v_current_metrics
                         where metric_key like 'analysis.%'
                           and ($1::text is null or dimension ->> 'period' >= $1)
                           and ($2::text is null or dimension ->> 'period' <= $2)
                         group by 1, 2, 3, 4, 5, 6, 7) t) as series,
                     (select coalesce(jsonb_agg(z.m order by z.m), '[]'::jsonb) from (
                        select distinct dimension ->> 'period' as m
                          from data_center.v_current_metrics
                         where metric_key like 'analysis.%'
                           and dimension ->> 'period' is not null) z) as months,
                     (select coalesce(jsonb_agg(to_jsonb(b) order by b.ord), '[]'::jsonb)
                        from data_center.age_bands('analysis.stock_age_buckets') b) as stock_bands,
                     (select coalesce(jsonb_agg(b2.j order by b2.ord), '[]'::jsonb) from (
                        select to_jsonb(b) as j, b.ord
                          from data_center.age_bands('analysis.velocity_buckets') b) b2) as velocity_bands,
                     (select coalesce(value::text::int, 24) from data_center.workflow_config
                       where key = 'metrics.stale_after_hours') as stale_after_hours,
                     (select to_jsonb(r) from (
                        select finished_at, status, duration_ms
                          from data_center.metric_runs order by started_at desc limit 1) r) as last_run,
                     -- Per family, not per run: a pool-only run carries the other
                     -- families forward with the moment they were computed, so
                     -- "computed at" and staleness read the sales families' own
                     -- timestamp rather than the newest run's.
                     (select max(computed_at) from data_center.v_current_metrics
                       where metric_key not like 'pool.%') as computed_at`,
            args: [from, to],
          });

          const row = result.rows[0];
          const finishedAt = row?.computed_at ?? null;
          const hours = Number(row?.stale_after_hours ?? 24);

          // Analysis keeps the Dashboard's freshness contract rather than
          // inventing a second one. Nothing here is live; it is as of the last
          // computation, and the page says so above the first chart.
          const isStale = finishedAt
            ? Date.now() - new Date(finishedAt).getTime() > hours * 3_600_000
            : true;

          return json(
            {
              data: {
                totals: row?.totals ?? [],
                series: row?.series ?? [],
                months: row?.months ?? [],
                stockBands: row?.stock_bands ?? [],
                velocityBands: row?.velocity_bands ?? [],
                from,
                to,
                computedAt: finishedAt,
                isStale,
                staleAfterHours: hours,
                lastRun: row?.last_run ?? null,
              },
            },
            200,
            cors,
          );
        });
      }

      /**
       * Unsold stock sitting at a partner: the records behind the ageing chart.
       *
       * WHY THIS IS A NEW ACTION AND NOT A FILTER
       *
       * `records` and `call_queue` are built on `v_sold_stoves`, which begins
       * `from public.sales`. A stove that has not been sold has no row there
       * and never will, so no filter added to `RecordsFilters` could ever
       * reach this population. It is a different set, not a narrower one.
       *
       * WHY THE BAND FILTER READS THE CONFIG
       *
       * `ageBucket` is resolved against `data_center.age_bands`, the same
       * function `compute_analysis` bucketed with. So the drill cannot mean
       * something different from the bar that was clicked, and re-grading a
       * band in Settings moves the chart and this list together. Repeating the
       * numbers here would be two definitions of "critical" that agree until
       * somebody edits one.
       *
       * Keyset on (transfer_sales_date, stove_id). The date is a `date`, so
       * the microsecond truncation that bites timestamptz cursors does not
       * apply - but if this is ever re-cut on transfer_date, it does.
       */
      case "stock": {
        const superAdmin = isSuperAdmin(profile.role);
        const resolved = superAdmin
          ? { accessRole: null, features: [] as string[] }
          : await resolveAccess(userId);

        if (!superAdmin && resolved.accessRole === null) {
          return json({ error: "No Data Center access", code: "no_access" }, 403, cors);
        }
        if (!superAdmin && !resolved.features.includes("records.view")) {
          return json({ error: "Not permitted", code: "no_feature" }, 403, cors);
        }

        const scopeInput = await resolveScope(
          supabase,
          userId,
          profile.role,
          profile.organization_id ?? null,
        );
        const filters = (body.filters ?? {}) as {
          organizationId?: string;
          ageBucket?: string;
          state?: string;
          search?: string;
        };

        const scope = buildTransferScopeSql(
          { ...scopeInput, requestedOrgId: filters.organizationId ?? null },
          1,
          "b",
        );
        const args: unknown[] = [...scope.args];
        const p = (v: unknown) => {
          args.push(v);
          return `$${args.length}`;
        };

        // The age expression appears in the select, the band filter and the
        // sort, so it is written once here rather than three times.
        const TZ =
          `(select coalesce(value #>> '{}', 'Africa/Lagos') from data_center.workflow_config where key = 'analysis.timezone')`;
        const TRANSFERRED = `coalesce(b.transfer_sales_date, (h.transfer_date at time zone ${TZ})::date)`;
        const DAYS = `greatest(current_date - ${TRANSFERRED}, 0)`;

        const where: string[] = [
          scope.sql,
          "b.is_archived is not true",
          "b.status <> 'sold'",
          "b.sale_id is null",
          `${TRANSFERRED} is not null`,
        ];

        if (filters.ageBucket) {
          where.push(`exists (
            select 1 from data_center.age_bands('analysis.stock_age_buckets') k
             where k.code = ${p(String(filters.ageBucket))}
               and ${DAYS} >= k.min_days
               and (k.max_days is null or ${DAYS} <= k.max_days))`);
        }
        if (filters.state) {
          where.push(`coalesce(h.state, o.state) = ${p(String(filters.state))}`);
        }
        if (filters.search) {
          const term = `%${String(filters.search).trim().toUpperCase()}%`;
          where.push(`(upper(b.stove_id) like ${p(term)} or upper(coalesce(b.sales_reference, '')) like ${p(term)})`);
        }

        // Keyset, never OFFSET. The tiebreaker is the stove id, which is
        // unique, so a page boundary inside one day's transfers is stable.
        const cursor = (body.cursor ?? null) as
          | { transferredOn: string | null; stoveId: string }
          | null;
        if (cursor?.stoveId) {
          where.push(
            `(${TRANSFERRED}, b.stove_id) < (${p(cursor.transferredOn)}::date, ${p(cursor.stoveId)})`,
          );
        }

        const requested = Number(body.limit ?? 50);
        const pageSize = Math.min(
          200,
          Math.max(1, Number.isFinite(requested) ? requested : 50),
        );

        return await withReadConnection(async (connection) => {
          const result = await connection.queryObject<Record<string, unknown>>({
            text: `select b.stove_id,
                          b.organization_id::text as organization_id,
                          coalesce(o.partner_name, 'Unknown') as partner_name,
                          b.sales_reference as transaction_id,
                          b.factory,
                          b.status,
                          coalesce(h.state, o.state) as state,
                          ${TRANSFERRED}::text as transferred_on,
                          ${DAYS} as days
                     from public.stove_ids_base b
                     left join public.stove_transfer_history h on h.transaction_id = b.sales_reference
                     left join public.organizations o on o.id = b.organization_id
                    where ${where.join(" and ")}
                    order by ${TRANSFERRED} desc, b.stove_id desc
                    limit ${pageSize + 1}`,
            args,
          });

          const rows = result.rows.slice(0, pageSize);
          const hasMore = result.rows.length > pageSize;
          const last = rows[rows.length - 1];

          return json(
            {
              data: {
                rows,
                hasMore,
                pageSize,
                nextCursor: hasMore && last
                  ? {
                      transferredOn: (last.transferred_on as string) ?? null,
                      stoveId: last.stove_id as string,
                    }
                  : null,
                scope: scope.description,
              },
            },
            200,
            cors,
          );
        });
      }

      case "transfer_funnel": {
        const superAdmin = isSuperAdmin(profile.role);
        const resolved = superAdmin
          ? { accessRole: null, features: [] as string[] }
          : await resolveAccess(userId);

        if (!superAdmin && resolved.accessRole === null) {
          return json({ error: "No Data Center access", code: "no_access" }, 403, cors);
        }
        if (!superAdmin && !resolved.features.includes("records.view")) {
          return json({ error: "Not permitted", code: "no_feature" }, 403, cors);
        }

        const scopeInput = await resolveScope(
          supabase,
          userId,
          profile.role,
          profile.organization_id ?? null,
        );
        const filters = (body.filters ?? {}) as {
          organizationId?: string;
          transferState?: string;
          salesRep?: string;
          outstandingOnly?: boolean;
          search?: string;
          dateFrom?: string;
          dateTo?: string;
        };

        const scope = buildTransferScopeSql(
          { ...scopeInput, requestedOrgId: filters.organizationId ?? null },
          1,
          "f",
        );
        const args: unknown[] = [...scope.args];
        const where: string[] = [scope.sql];
        const p = (v: unknown) => {
          args.push(v);
          return `$${args.length}`;
        };

        if (filters.transferState) where.push(`f.transfer_state = ${p(filters.transferState)}`);
        /**
         * The period, on the date the consignment went out.
         *
         * `sales_date` on this view is text rather than a date - it comes
         * through the ERP sync that way - so every comparison is guarded by
         * the shape test first. Casting an unguarded text column to date is
         * how one malformed row from an upstream system takes the whole page
         * down with an error nobody can act on.
         */
        const ISO = /^\d{4}-\d{2}-\d{2}$/;
        if (filters.dateFrom && ISO.test(filters.dateFrom)) {
          where.push(
            `(f.sales_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' and left(f.sales_date, 10)::date >= ${p(filters.dateFrom)}::date)`,
          );
        }
        if (filters.dateTo && ISO.test(filters.dateTo)) {
          where.push(
            `(f.sales_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' and left(f.sales_date, 10)::date <= ${p(filters.dateTo)}::date)`,
          );
        }
        if (filters.salesRep) where.push(`f.sales_rep = ${p(filters.salesRep)}`);
        // The queue that matters, and the reason for the partial index.
        if (filters.outstandingOnly) where.push("f.outstanding_count > 0");
        if (filters.search) {
          const term = String(filters.search).trim().slice(0, 100);
          if (term) {
            const like = p(`%${term}%`);
            where.push(
              `(f.partner_name ilike ${like} or f.transaction_id ilike ${like} or f.sales_rep ilike ${like})`,
            );
          }
        }

        const limit = Math.min(Math.max(Number(body.limit) || 100, 1), 500);

        return await withReadConnection(async (connection) => {
          /*
           * The page AND the totals for everything the filters matched.
           *
           * This used to return rows only, and Partner Records summed the
           * column across whatever it had been given. With `limit: 300` against
           * 483 matching transfers, the figure labelled "Issued" was the top
           * 300 by outstanding count: 14,224 where the real answer was 14,465.
           * A hundred and ninety-five consignments missing from a total, with
           * nothing on the page able to say so, because nothing in this
           * response carried a count.
           *
           * Totalling in SQL over the same predicate is the only version that
           * cannot drift from the rows beneath it. Returning `matched` as well
           * lets the page say "showing 300 of 483" rather than leaving the
           * reader to assume it has everything.
           *
           * One statement rather than the previous two: the totals ride along
           * with the page and the timestamp, so this is a round trip cheaper
           * than what it replaces.
           */
          const result = await connection.queryObject<{
            rows: unknown[] | null;
            totals: Record<string, number> | null;
            computed_at: string | null;
          }>({
            text: `select
                     (select coalesce(jsonb_agg(t), '[]'::jsonb) from (
                        select f.transfer_id::text, f.transaction_id, f.organization_id::text,
                               f.partner_name, f.partner_id, f.transfer_state, f.transfer_branch,
                               f.sales_rep, f.sales_date, f.transfer_date,
                               f.issued_count, f.received_count, f.received_is_logged,
                               f.digitalised_count, f.verified_count, f.unverified_count,
                               f.unreachable_count, f.unresolved_count, f.outstanding_count,
                               f.computed_at
                          from data_center.transfer_funnel f
                         where ${where.join(" and ")}
                         order by f.outstanding_count desc, f.sales_date desc nulls last
                         limit ${limit}) t) as rows,
                     (select jsonb_build_object(
                        'transfers',   count(*),
                        'issued',      coalesce(sum(f.issued_count), 0),
                        'received',    coalesce(sum(f.received_count), 0),
                        'digitalised', coalesce(sum(f.digitalised_count), 0),
                        'verified',    coalesce(sum(f.verified_count), 0),
                        'outstanding', coalesce(sum(f.outstanding_count), 0))
                        from data_center.transfer_funnel f
                       where ${where.join(" and ")}) as totals,
                     (select max(computed_at) from data_center.transfer_funnel) as computed_at`,
            args,
          });

          const row = result.rows[0];
          const rows = (row?.rows ?? []) as Record<string, unknown>[];
          const totals = (row?.totals ?? {}) as Record<string, number>;

          return json(
            {
              data: {
                rows,
                // Every matching transfer, not just the ones on this page.
                totals,
                matched: Number(totals.transfers ?? 0),
                shown: rows.length,
                limit,
                scope: scope.description,
                computedAt: row?.computed_at ?? null,
              },
            },
            200,
            cors,
          );
        });
      }

      /**
       * Who was given what, and what came of it.
       *
       * Reads v_assignment_log, which joins batches to items to the latest
       * attempt. Keyset paginated on (assigned_at, batch_id, position): the
       * log grows forever, and OFFSET over forever is the exact pathology
       * Table 1 was built to avoid.
       *
       * Scoped like the call queue: this is about sales records and the people
       * calling them, so records.view is the gate and organization scope
       * applies. An agent may additionally always see their own batches
       * through data-center-assign's my_batches, which needs no extra grant.
       */
      /**
       * One partner, opened up.
       *
       * The header, every batch that partner was sent, and each rep's totals.
       * Three reads rather than one, because they answer three questions and a
       * single join would multiply the batch rows by the rep rows.
       *
       * Scoped exactly like the funnel it drills into, so a partner user
       * cannot open a partner that is not theirs by putting an id in the body.
       */
      /**
       * The sheet the digitisers actually work from.
       *
       * One row per stove the ERP transferred, already carrying the two things
       * that cannot be typed from a receipt: the stove ID and the transfer
       * reference. The digitiser fills in the buyer and the sale beside each
       * one and uploads it back, and because the serial is already correct the
       * import can resolve the partner itself rather than asking.
       *
       * It replaces the previous arrangement, which was a blank template and a
       * hope: every serial was typed by hand from a printed sheet, and a
       * mistyped serial is the one error the import cannot recover from,
       * because it looks exactly like a stove that is not ours.
       *
       * Sold stoves are included but flagged. Leaving them out silently would
       * hide the reason a sheet is short; saying so lets the digitiser skip
       * them deliberately.
       */
      /**
       * The whole call sheet in ONE query, rather than four hundred.
       *
       * The download paged `call_queue` up to 400 times. It asked for 500 a
       * page against a clamp of 200, so its stated ceiling of 200,000 was
       * really 80,000, and every page cost two and a half times the round
       * trips it meant to. At this module's measured cost - a request that
       * runs one statement answers in about 650 ms, and the cost is the
       * connection, not the query - that is minutes of wall clock for a file.
       *
       * `src/app/data-center/CLAUDE.md` already rules that work slower than
       * about a second belongs in a batched job, and `digitisation_sheet` has
       * answered the receipt sheet in one query since it was written. This is
       * that, for the other sheet, with the one flaw of the original fixed:
       * it says when it hit its ceiling instead of truncating in silence.
       */
      case "call_sheet_rows": {
        const superAdmin = isSuperAdmin(profile.role);
        const resolved = superAdmin
          ? { accessRole: null, features: [] as string[] }
          : await resolveAccess(userId);
        if (!superAdmin && resolved.accessRole === null) {
          return json({ error: "No Data Center access", code: "no_access" }, 403, cors);
        }
        // The sheet's own grant, not the queue's. Being able to read call
        // records is not the same as being able to pull the backlog out as a
        // file, which is the whole reason call_import.use exists separately.
        if (!superAdmin && !resolved.features.includes("call_import.use")) {
          return json({ error: "Not permitted", code: "no_feature" }, 403, cors);
        }

        const sb = body as { organizationId?: string; uncalledOnly?: boolean };
        const orgId = String(sb.organizationId ?? "");
        if (orgId && !UUID_RE.test(orgId)) {
          return json({ error: "That is not a partner id", code: "bad_input" }, 400, cors);
        }

        const sheetScope = await resolveScope(
          supabase,
          userId,
          profile.role,
          profile.organization_id ?? null,
        );

        let sheetQuery;
        try {
          sheetQuery = buildRecordsQuery(
            {
              table: "call_center",
              cursor: null as never,
              limit: SHEET_PAGE_SIZE,
              direction: "desc",
              filters: {
                ...(sb.uncalledOnly ? { hasCallRecord: false } : {}),
                ...(orgId ? { organizationId: orgId } : {}),
              } as never,
            },
            sheetScope,
            SHEET_PAGE_SIZE,
          );
        } catch (err) {
          if (err instanceof BadRequest) {
            return json({ error: err.message, code: "bad_request" }, 400, cors);
          }
          throw err;
        }

        return await withReadConnection(async (connection) => {
          // The same two-statement split the queue uses, for the same reason:
          // as one query the call queue took 25.8 seconds at 500,000 rows.
          const picked = await connection.queryObject<{ id: string; sales_date: string | null }>({
            text: sheetQuery.pick.text,
            args: sheetQuery.pick.args,
          });
          const page = toPage(picked.rows, sheetQuery.pageSize);

          let rows: Record<string, unknown>[] = [];
          if (page.ids.length > 0) {
            const hydrate = sheetQuery.hydrate(page.ids);
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
                cap: SHEET_PAGE_SIZE,
                /*
                 * Said, never silent. `digitisation_sheet` truncates at 20,000
                 * with nothing on screen to show for it, and for a backlog
                 * file that is the worst kind of wrong: the rows it quietly
                 * omits are exactly the ones nobody then chases.
                 */
                truncated: page.hasMore,
                scope: sheetQuery.scopeDescription,
              },
            },
            200,
            cors,
          );
        });
      }

      case "digitisation_sheet": {
        const superAdmin = isSuperAdmin(profile.role);
        const resolved = superAdmin
          ? { accessRole: null, features: [] as string[] }
          : await resolveAccess(userId);
        if (!superAdmin && resolved.accessRole === null) {
          return json({ error: "No Data Center access", code: "no_access" }, 403, cors);
        }
        if (!superAdmin && !resolved.features.includes("records.view")) {
          return json({ error: "Not permitted", code: "no_feature" }, 403, cors);
        }

        const b = body as { organizationId?: string; month?: string; transferId?: string };
        /*
         * A partner is now optional.
         *
         * One partner is still the common case and still what the Partner
         * Records button asks for. Left out, the sheet covers every partner
         * this caller holds, because the import no longer needs a file to
         * belong to one: each row's partner is resolved from its stove ID, so
         * a sheet spanning partners lands correctly and a person working a
         * stack of receipts from several partners no longer downloads several
         * files and reconciles them by hand.
         *
         * An id that is present but malformed is still refused. Only its
         * absence means "everything".
         */
        const organizationId = String(b.organizationId ?? "");
        if (organizationId && !UUID_RE.test(organizationId)) {
          return json(
            { error: "That is not a partner id", code: "bad_input" },
            400,
            cors,
          );
        }
        // YYYY-MM, or nothing for every month.
        const month = typeof b.month === "string" && /^\d{4}-\d{2}$/.test(b.month)
          ? b.month
          : null;

        const scopeInput = await resolveScope(
          supabase,
          userId,
          profile.role,
          profile.organization_id ?? null,
        );
        const scope = buildTransferScopeSql(
          { ...scopeInput, requestedOrgId: organizationId || null },
          1,
          "f",
        );
        const args: unknown[] = [...scope.args];
        const where = [scope.sql];
        const p = (v: unknown) => {
          args.push(v);
          return `$${args.length}`;
        };
        if (month) where.push(`left(f.sales_date, 7) = ${p(month)}`);
        if (b.transferId && UUID_RE.test(b.transferId)) {
          where.push(`f.transfer_id = ${p(b.transferId)}`);
        }

        return await withReadConnection(async (connection) => {
          const rows = await connection.queryObject({
            /*
             * partner_id travels with the name because the name does not
             * identify the partner. Four organizations are called LAPO and four
             * Solar Sister, two of those both "Main Branch" in different
             * states. On a sheet covering several partners, a person checking
             * their own work needs to be able to tell which is which.
             *
             * None of these columns is read back on upload. The stove ID
             * decides the partner; these are for the eye.
             */
            text: `select ts.stove_id, f.transaction_id, f.partner_name,
                          o.partner_id,
                          f.sales_rep, f.sales_date, f.transfer_state, f.transfer_branch,
                          sb.status as stock_status,
                          (sb.sale_id is not null) as already_recorded
                     from data_center.transfer_funnel f
                     join data_center.v_transfer_stoves ts on ts.transfer_id = f.transfer_id
                     left join public.stove_ids_base sb on sb.stove_id = ts.stove_id
                     left join public.organizations o on o.id = f.organization_id
                    where ${where.join(" and ")}
                    order by f.sales_date desc nulls last, f.transaction_id, ts.stove_id
                    limit 20000`,
            args,
          });

          // The months on offer, so the picker lists what exists rather than a
          // calendar of mostly-empty options.
          const months = await connection.queryObject({
            text: `select left(f.sales_date, 7) as month, count(*)::int as transfers
                     from data_center.transfer_funnel f
                    where ${scope.sql}
                      and f.sales_date ~ '^[0-9]{4}-[0-9]{2}'
                    group by 1 order by 1 desc`,
            args: [...scope.args],
          });

          /**
           * The sheet's shape, from config rather than from the component.
           *
           * The columns, which are required, and where each dropdown's choices
           * come from all live in workflow_config, so changing the sheet is
           * data entry. Sending the spec with the rows means the file the
           * digitiser gets and the form the app shows cannot drift: both read
           * this.
           */
          const spec = await connection.queryObject<{ columns: unknown; format: unknown }>({
            text: `select
                     (select value from data_center.workflow_config
                       where key = 'digitisation.sheet_columns') as columns,
                     (select value from data_center.workflow_config
                       where key = 'digitisation.sheet_format')  as format`,
          });

          return json(
            {
              data: {
                rows: rows.rows,
                months: months.rows,
                columns: spec.rows[0]?.columns ?? [],
                format: spec.rows[0]?.format ?? "xlsx",
              },
            },
            200,
            cors,
          );
        });
      }

      case "partner_detail": {
        const superAdmin = isSuperAdmin(profile.role);
        const resolved = superAdmin
          ? { accessRole: null, features: [] as string[] }
          : await resolveAccess(userId);
        if (!superAdmin && resolved.accessRole === null) {
          return json({ error: "No Data Center access", code: "no_access" }, 403, cors);
        }
        if (!superAdmin && !resolved.features.includes("records.view")) {
          return json({ error: "Not permitted", code: "no_feature" }, 403, cors);
        }
        const organizationId = String((body as { organizationId?: string }).organizationId ?? "");
        if (!UUID_RE.test(organizationId)) {
          return json({ error: "organizationId must be a UUID", code: "bad_input" }, 400, cors);
        }

        const scopeInput = await resolveScope(
          supabase,
          userId,
          profile.role,
          profile.organization_id ?? null,
        );
        const scope = buildTransferScopeSql(
          { ...scopeInput, requestedOrgId: organizationId },
          1,
          "f",
        );

        return await withReadConnection(async (connection) => {
          const batches = await connection.queryObject({
            text: `select f.transfer_id::text, f.transaction_id, f.organization_id::text,
                          f.partner_name, f.partner_id, f.transfer_state, f.transfer_branch,
                          f.sales_rep, f.sales_date, f.transfer_date,
                          f.issued_count, f.received_count, f.digitalised_count,
                          f.verified_count, f.unverified_count, f.unreachable_count,
                          f.unresolved_count, f.outstanding_count
                     from data_center.transfer_funnel f
                    where ${scope.sql}
                    order by f.sales_date desc nulls last, f.transaction_id
                    limit 500`,
            args: [...scope.args],
          });

          // Per rep, for this partner and overall. "How many has this rep got"
          // is asked both ways and answering only one of them invites the
          // reader to assume the other.
          const reps = await connection.queryObject({
            text: `with here as (
                     select f.sales_rep, sum(f.issued_count)::int as stoves_here,
                            count(*)::int as batches_here
                       from data_center.transfer_funnel f
                      where ${scope.sql} and f.sales_rep is not null
                      group by f.sales_rep
                   ), everywhere as (
                     select f.sales_rep, sum(f.issued_count)::int as stoves_total,
                            count(distinct f.organization_id)::int as partners_total
                       from data_center.transfer_funnel f
                      where f.sales_rep in (select sales_rep from here)
                      group by f.sales_rep
                   )
                   select h.sales_rep, h.stoves_here, h.batches_here,
                          e.stoves_total, e.partners_total
                     from here h join everywhere e on e.sales_rep = h.sales_rep
                    order by h.stoves_here desc`,
            args: [...scope.args],
          });

          const header = batches.rows[0] as Record<string, unknown> | undefined;
          return json(
            {
              data: {
                partner: header
                  ? {
                    organization_id: header.organization_id,
                    partner_name: header.partner_name,
                    partner_id: header.partner_id,
                    transfer_state: header.transfer_state,
                    transfer_branch: header.transfer_branch,
                  }
                  : null,
                batches: batches.rows,
                reps: reps.rows,
              },
            },
            200,
            cors,
          );
        });
      }

      /**
       * The stoves in one batch.
       *
       * Every serial the transfer carried, whether it has since been sold, and
       * if sold what has become of it: verified or not, assigned to whom, or
       * assigned to nobody. Unassigned is a state worth seeing, which is why it
       * is a left join and not a filter.
       */
      case "batch_stoves": {
        const superAdmin = isSuperAdmin(profile.role);
        const resolved = superAdmin
          ? { accessRole: null, features: [] as string[] }
          : await resolveAccess(userId);
        if (!superAdmin && resolved.accessRole === null) {
          return json({ error: "No Data Center access", code: "no_access" }, 403, cors);
        }
        if (!superAdmin && !resolved.features.includes("records.view")) {
          return json({ error: "Not permitted", code: "no_feature" }, 403, cors);
        }
        const transferId = String((body as { transferId?: string }).transferId ?? "");
        if (!UUID_RE.test(transferId)) {
          return json({ error: "transferId must be a UUID", code: "bad_input" }, 400, cors);
        }

        const scopeInput = await resolveScope(
          supabase,
          userId,
          profile.role,
          profile.organization_id ?? null,
        );
        const scope = buildTransferScopeSql({ ...scopeInput, requestedOrgId: null }, 2, "f");

        return await withReadConnection(async (connection) => {
          const rows = await connection.queryObject({
            text: `select b.stove_id, b.transaction_id,
                          sb.status as stock_status, sb.sale_id::text,
                          c.sales_date, c.end_user_name,
                          coalesce(c.corrected_phone, c.primary_phone) as phone,
                          c.user_state, c.verification_outcome, c.attempt_count,
                          ba.assigned_to::text as agent_id,
                          ap.full_name as agent_name,
                          ba.state as batch_state
                     from data_center.v_transfer_stoves b
                     join data_center.transfer_funnel f on f.transfer_id = b.transfer_id
                     left join public.stove_ids_base sb on sb.stove_id = b.stove_id
                     left join data_center.v_call_center_resolved c on c.sale_id = sb.sale_id
                     left join data_center.assignment_items ai
                            on ai.sale_id = sb.sale_id and ai.is_active
                     left join data_center.assignment_batches ba on ba.id = ai.batch_id
                     left join public.profiles ap on ap.id = ba.assigned_to
                    where b.transfer_id = $1 and ${scope.sql}
                    order by b.stove_id
                    limit 2000`,
            args: [transferId, ...scope.args],
          });
          return json({ data: { stoves: rows.rows } }, 200, cors);
        });
      }

      /**
       * A partner's stoves, rather than one consignment's.
       *
       * The bench could only ever be entered through a consignment: partner,
       * then transfer batch, then type. That is the right default and it is not
       * the only way people work. A receipt turns up whose batch nobody
       * recorded, or somebody wants to work a partner in date order, and
       * neither has a way in.
       *
       * Same select as `batch_stoves`, deliberately, so the rail and the table
       * beside it render this without knowing which action produced it. What
       * differs is the key: an organization instead of a transfer, with an
       * optional month and an optional match on the stove ID.
       *
       * SEARCH IS HERE AND NOT IN THE BROWSER. The rail filters the list it was
       * handed, which is exactly right for a consignment of forty and useless
       * across a partner holding thousands: the stove on the receipt in your
       * hand is usually not on the page in front of you. A filter that silently
       * only searches what is loaded is worse than no filter, because it
       * answers "not found" for a stove that is there.
       */
      case "partner_stoves": {
        const superAdmin = isSuperAdmin(profile.role);
        const resolved = superAdmin
          ? { accessRole: null, features: [] as string[] }
          : await resolveAccess(userId);
        if (!superAdmin && resolved.accessRole === null) {
          return json({ error: "No Data Center access", code: "no_access" }, 403, cors);
        }
        if (!superAdmin && !resolved.features.includes("records.view")) {
          return json({ error: "Not permitted", code: "no_feature" }, 403, cors);
        }

        const b = body as {
          organizationId?: string;
          period?: string | null;
          search?: string | null;
          cursor?: string | null;
          limit?: number;
          recorded?: string | null;
          transactionId?: string | null;
        };

        const organizationId = String(b.organizationId ?? "");
        if (!UUID_RE.test(organizationId)) {
          return json({ error: "organizationId must be a UUID", code: "bad_input" }, 400, cors);
        }

        // The same month shape every other Data Centre surface accepts, so a
        // period means one thing across the module.
        const period = typeof b.period === "string" && b.period ? b.period : null;
        if (period && !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
          return json({ error: "period must look like 2026-08", code: "bad_period" }, 400, cors);
        }

        // One consignment out of everything the partner holds. An exact match
        // on the reference, not a pattern: the value comes from a picker that
        // was itself filled from partner_detail, so anything else is noise.
        const transactionId =
          typeof b.transactionId === "string" && b.transactionId.trim()
            ? b.transactionId.trim().slice(0, 60)
            : null;

        const raw = String(b.search ?? "").trim().slice(0, 60);
        // Escaped, so a serial containing % or _ searches for itself rather
        // than for everything. Matched anywhere in the ID, because nobody reads
        // a serial out from the front.
        const like = raw ? `%${raw.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : "";

        const cursor = typeof b.cursor === "string" && b.cursor ? b.cursor : null;
        const limit = Math.min(Math.max(Number(b.limit) || 200, 1), 500);

        /*
         * "Still to type" has to be decided here, not on the page.
         *
         * The bench filtered the loaded rows, which was true while a whole
         * consignment fitted on screen and became a lie the moment a partner's
         * three thousand stoves arrived a page at a time: the chip said "Still
         * to type (37)" meaning 37 on this page, and paging past them showed
         * more of what it had just said there were none of.
         *
         * A recorded stove is one with a sale against it. That is the same
         * definition the list already draws its "Already recorded" mark from,
         * moved to where it can be counted honestly.
         */
        const recorded = b.recorded === "yes" ? "yes" : b.recorded === "no" ? "no" : null;
        const recordedSql =
          recorded === "yes"
            ? " and sb.sale_id is not null"
            : recorded === "no"
            ? " and sb.sale_id is null"
            : "";

        const scopeInput = await resolveScope(
          supabase,
          userId,
          profile.role,
          profile.organization_id ?? null,
        );
        /*
         * requestedOrgId does two jobs: it narrows to this partner and it
         * refuses outright when the partner is not one this caller covers. The
         * id arrives from the client, so it is checked rather than trusted.
         */
        const scope = buildTransferScopeSql(
          { ...scopeInput, requestedOrgId: organizationId },
          6,
          "f",
        );

        return await withReadConnection(async (connection) => {
          // One more than asked for, so "is there another page" is answered by
          // the same query rather than by a second count over the same rows.
          const rows = await connection.queryObject({
            text: `select b.stove_id, b.transaction_id,
                          b.transfer_id::text as transfer_id,
                          f.sales_date as consignment_sales_date,
                          sb.status as stock_status, sb.sale_id::text,
                          c.sales_date, c.end_user_name,
                          coalesce(c.corrected_phone, c.primary_phone) as phone,
                          c.user_state, c.verification_outcome, c.attempt_count,
                          ba.assigned_to::text as agent_id,
                          ap.full_name as agent_name,
                          ba.state as batch_state
                     from data_center.v_transfer_stoves b
                     join data_center.transfer_funnel f on f.transfer_id = b.transfer_id
                     left join public.stove_ids_base sb on sb.stove_id = b.stove_id
                     left join data_center.v_call_center_resolved c on c.sale_id = sb.sale_id
                     left join data_center.assignment_items ai
                            on ai.sale_id = sb.sale_id and ai.is_active
                     left join data_center.assignment_batches ba on ba.id = ai.batch_id
                     left join public.profiles ap on ap.id = ba.assigned_to
                    where ${scope.sql}
                      and ($1::text is null
                           or (f.sales_date ~ '^[0-9]{4}-[0-9]{2}'
                               and left(f.sales_date, 7) = $1))
                      and ($2::text = '' or b.stove_id like $2)
                      and ($3::text is null or b.stove_id > $3)
                      and ($5::text is null or b.transaction_id = $5)${recordedSql}
                    order by b.stove_id
                    limit $4`,
            args: [period, like, cursor, limit + 1, transactionId, ...scope.args],
          });

          /*
           * How many there are, not how many are loaded.
           *
           * The bench used to load two hundred and offer "Load more", so the
           * only number on screen was the number fetched so far. A typist
           * reading it concluded a partner held 200 stoves when it held
           * thousands. Page controls need a real denominator, and the module's
           * own rule - proved by its records table - is that the count answers
           * the filter rather than the page.
           *
           * Same predicates as the page query minus the cursor and minus the
           * recorded filter - the one scan answers all three of the bench's
           * chips at once with FILTER clauses, because a chip that only knows
           * its own count when it is selected pins the other two to a guess.
           * The bench showed "done 0" forever for exactly that reason: the todo
           * page was all the server was ever asked about.
           */
          const countScope = buildTransferScopeSql(
            { ...scopeInput, requestedOrgId: organizationId },
            4,
            "f",
          );
          const counted = await connection.queryObject<{
            total: number;
            todo: number;
            done: number;
          }>({
            text: `select count(*)::int as total,
                          count(*) filter (where sb.sale_id is null)::int as todo,
                          count(*) filter (where sb.sale_id is not null)::int as done
                     from data_center.v_transfer_stoves b
                     join data_center.transfer_funnel f on f.transfer_id = b.transfer_id
                     left join public.stove_ids_base sb on sb.stove_id = b.stove_id
                    where ${countScope.sql}
                      and ($1::text is null
                           or (f.sales_date ~ '^[0-9]{4}-[0-9]{2}'
                               and left(f.sales_date, 7) = $1))
                      and ($2::text = '' or b.stove_id like $2)
                      and ($3::text is null or b.transaction_id = $3)`,
            args: [period, like, transactionId, ...countScope.args],
          });

          const all = rows.rows as { stove_id: string }[];
          const hasMore = all.length > limit;
          const stoves = hasMore ? all.slice(0, limit) : all;
          const t = counted.rows[0] ?? { total: 0, todo: 0, done: 0 };
          return json(
            {
              data: {
                stoves,
                hasMore,
                // The denominator for the CURRENT filter, which is what the
                // page controls divide by. The three totals ride beside it so
                // every chip can be honest whichever one is selected.
                total: recorded === "yes" ? t.done : recorded === "no" ? t.todo : t.total,
                totals: { all: t.total, todo: t.todo, done: t.done },
                nextCursor: hasMore ? stoves[stoves.length - 1].stove_id : null,
                scope: scope.description,
              },
            },
            200,
            cors,
          );
        });
      }

      /**
       * One stove, everything known about it.
       *
       * The end of the drill: the transfer it arrived on, the sale if it was
       * sold, the buyer, the verification, who is holding it and every call
       * anyone made. Assembled here rather than by the client making five
       * requests and stitching them, which is five chances to show a half
       * answer while the rest is still in flight.
       */
      case "stove_detail": {
        const superAdmin = isSuperAdmin(profile.role);
        const resolved = superAdmin
          ? { accessRole: null, features: [] as string[] }
          : await resolveAccess(userId);
        if (!superAdmin && resolved.accessRole === null) {
          return json({ error: "No Data Center access", code: "no_access" }, 403, cors);
        }
        if (!superAdmin && !resolved.features.includes("records.view")) {
          return json({ error: "Not permitted", code: "no_feature" }, 403, cors);
        }
        const stoveId = String((body as { stoveId?: string }).stoveId ?? "").trim().slice(0, 120);
        if (!stoveId) {
          return json({ error: "stoveId is required", code: "bad_input" }, 400, cors);
        }

        const scopeInput = await resolveScope(
          supabase,
          userId,
          profile.role,
          profile.organization_id ?? null,
        );
        const scope = buildTransferScopeSql({ ...scopeInput, requestedOrgId: null }, 2, "f");

        return await withReadConnection(async (connection) => {
          const found = await connection.queryObject({
            text: `select sb.stove_id, sb.status as stock_status, sb.factory,
                          sb.sales_reference, sb.transfer_sales_date,
                          sb.sale_id::text,
                          f.transfer_id::text, f.transaction_id, f.partner_name,
                          f.partner_id, f.sales_rep, f.transfer_state, f.transfer_branch,
                          f.organization_id::text,
                          c.sales_date, c.end_user_name, c.aka,
                          coalesce(c.corrected_phone, c.primary_phone) as phone,
                          c.alternative_phone, c.user_state, c.user_lga,
                          c.user_residential_address, c.amount, c.total_paid,
                          c.payment_status, c.sale_status, c.platform,
                          c.sale_agent_name, c.sales_model,
                          c.verification_outcome, c.call_outcome, c.attempt_count,
                          c.last_attempt_at, c.correction_state, c.correction_reason,
                          ba.id::text as batch_id, ba.state as batch_state,
                          ba.assigned_at, ba.assigned_to::text as agent_id,
                          ap.full_name as agent_name, ap.email as agent_email
                     from public.stove_ids_base sb
                     left join data_center.v_transfer_stoves b on b.stove_id = sb.stove_id
                     left join data_center.transfer_funnel f on f.transfer_id = b.transfer_id
                     left join data_center.v_call_center_resolved c on c.sale_id = sb.sale_id
                     left join data_center.assignment_items ai
                            on ai.sale_id = sb.sale_id and ai.is_active
                     left join data_center.assignment_batches ba on ba.id = ai.batch_id
                     left join public.profiles ap on ap.id = ba.assigned_to
                    where sb.stove_id = $1 and (f.transfer_id is null or ${scope.sql})
                    limit 1`,
            args: [stoveId, ...scope.args],
          });
          const stove = found.rows[0] as Record<string, unknown> | undefined;
          if (!stove) {
            return json({ error: "No such stove", code: "not_found" }, 404, cors);
          }

          // The calls, if it ever became a sale somebody rang about.
          const attempts = stove.sale_id
            ? await connection.queryObject({
              text: `select a.attempt_no, a.attempted_at, a.note,
                            o.label as outcome, ab.label as answered_by,
                            p.full_name as logged_by
                       from data_center.call_attempts a
                       left join data_center.option_values o on o.id = a.outcome_id
                       left join data_center.option_values ab on ab.id = a.answered_by_id
                       left join public.profiles p on p.id = a.created_by
                      where a.sale_id = $1
                      order by a.attempt_no`,
              args: [stove.sale_id],
            })
            : { rows: [] };

          /**
           * Everything else that touched this stove, gathered in one place.
           *
           * The stove ID is the anchor the whole module hangs off: the ERP
           * issued it, a transfer sent it to a partner, a receipt turned it
           * into a sale, an import or a digitiser typed that receipt up, a
           * call agent rang the buyer, and somebody may have sent it back to
           * Sales to be corrected. Each of those lives in a different table,
           * and until now answering "what happened to this stove" meant
           * opening five surfaces and joining them by eye.
           *
           * They are read together because none of them depends on another,
           * only on the sale_id and stove_id already resolved above, so the
           * page costs one round trip rather than six.
           */
          const saleId = stove.sale_id as string | null;
          const transferId = stove.transfer_id as string | null;
          const transactionId = stove.transaction_id as string | null;
          const batchId = (stove.batch_id as string | null) ?? "";

          const [
            sale, enrichment, provenance, changes, changeCount, consignment,
            phoneTwins, siblings, payments, pastSales,
          ] = await Promise.all([
              // The sale exactly as the sales app holds it, every field the
              // Sell Stove form collects. Anything less and this page would be
              // a summary of the record rather than the record.
              saleId
                ? connection.queryObject({
                  text: `select s.transaction_id, s.sales_date, s.contact_person,
                                s.contact_phone, s.end_user_name, s.aka, s.phone,
                                s.other_phone, s.state_backup, s.lga_backup,
                                s.partner_name, s.amount, s.total_paid,
                                s.payment_status, s.is_installment, s.retailer_branch,
                                s.pot_quantity, s.heat_retention_device,
                                s.previous_stove_type, s.previous_stove_other,
                                s.meals_per_day, s.cooking_fuel_source,
                                s.cooking_location, s.terms_accepted, s.status,
                                s.platform, s.is_archived,
                                s.agent_approved, s.agent_approved_at,
                                s.cancelled_at, s.cancel_reason,
                                s.created_at, s.updated_at, s.signature,
                                ad.full_address, ad.street, ad.city,
                                ad.state as address_state, ad.country,
                                ad.latitude, ad.longitude,
                                pm.name as payment_model, pm.duration_months,
                                cb.full_name as created_by_name,
                                cb.email as created_by_email,
                                ub.full_name as updated_by_name,
                                apb.full_name as approved_by_name,
                                sob.full_name as sold_on_behalf_of_name,
                                cnb.full_name as cancelled_by_name,
                                si.url as stove_image_url,
                                ag.url as agreement_image_url,
                                o.partner_id as org_partner_id,
                                o.branch as org_branch,
                                o.contact_person as org_contact,
                                o.contact_phone as org_phone,
                                o.state as org_state
                           from public.sales s
                           left join public.addresses ad on ad.id = s.address_id
                           left join public.payment_models pm on pm.id = s.payment_model_id
                           left join public.profiles cb on cb.id = s.created_by
                           left join public.profiles ub on ub.id = s.updated_by
                           left join public.profiles apb on apb.id = s.agent_approved_by
                           left join public.profiles sob on sob.id = s.sold_on_behalf_of
                           left join public.profiles cnb on cnb.id = s.cancelled_by
                           left join public.uploads si on si.id = s.stove_image_id
                           left join public.uploads ag on ag.id = s.agreement_image_id
                           left join public.organizations o on o.id = s.organization_id
                          where s.id = $1`,
                  args: [saleId],
                })
                : { rows: [] },

              // What the call centre added on top, with the dropdown values
              // resolved to the labels a person chose rather than their ids.
              saleId
                ? connection.queryObject({
                  text: `select cr.verification_outcome, cr.corrected_phone,
                                cr.corrected_alt_phone, cr.corrected_end_user_name,
                                cr.corrected_address, cr.corrected_state,
                                cr.corrected_lga, cr.ward, cr.landmark,
                                cr.stated_serial, cr.answers, cr.other_comments,
                                cr.attempt_count, cr.last_attempt_at, cr.version,
                                cr.created_at, cr.updated_at,
                                cr.correction_requested_at, cr.correction_note,
                                cr.correction_resolved_at,
                                co.label as call_outcome,
                                cro.label as correction_reason,
                                ag.full_name as call_agent_name,
                                ag.email as call_agent_email,
                                crb.full_name as created_by_name,
                                urb.full_name as updated_by_name,
                                rqb.full_name as correction_requested_by_name,
                                rsb.full_name as correction_resolved_by_name
                           from data_center.call_records cr
                           left join data_center.option_values co on co.id = cr.call_outcome_id
                           left join data_center.option_values cro on cro.id = cr.correction_reason_id
                           left join public.profiles ag on ag.id = cr.call_agent_id
                           left join public.profiles crb on crb.id = cr.created_by
                           left join public.profiles urb on urb.id = cr.updated_by
                           left join public.profiles rqb on rqb.id = cr.correction_requested_by
                           left join public.profiles rsb on rsb.id = cr.correction_resolved_by
                          where cr.sale_id = $1`,
                  args: [saleId],
                })
                : { rows: [] },

              /**
               * How the record got in.
               *
               * Matched on the serial as well as the sale, because a row that
               * was rejected never got a sale_id and those are exactly the
               * ones somebody is trying to account for.
               */
              connection.queryObject({
                text: `select ir.row_number, ir.status, ir.rejection_reason,
                              ir.exception_reason, ir.rejection_hint,
                              ir.confirmed_at, ir.last_edited_at,
                              (ir.draft_values is not null) as had_draft,
                              b.id::text as batch_id, b.source, b.filename,
                              b.state as batch_state, b.uploaded_at, b.committed_at,
                              eb.full_name as edited_by_name,
                              cfb.full_name as confirmed_by_name,
                              ub.full_name as uploaded_by_name,
                              cmb.full_name as committed_by_name
                         from data_center.import_rows ir
                         join data_center.import_batches b on b.id = ir.batch_id
                         left join public.profiles eb on eb.id = ir.last_edited_by
                         left join public.profiles cfb on cfb.id = ir.confirmed_by
                         left join public.profiles ub on ub.id = b.uploaded_by
                         left join public.profiles cmb on cmb.id = b.committed_by
                        where ($1::uuid is not null and ir.sale_id = $1::uuid)
                           or ir.stove_serial_no = $2
                        order by b.uploaded_at desc
                        limit 20`,
                args: [saleId, stoveId],
              }),

              /**
               * Every edit anybody made, as fields rather than snapshots.
               *
               * The trigger stores the whole row before and after; a page that
               * printed both would be unreadable. changed_fields is the
               * difference, computed the same way the Settings log computes
               * it, so the two read alike.
               */
              connection.queryObject({
                text: `${CHANGES_SELECT}
                        where ${CHANGES_WHERE}
                          and ${CHANGES_MEANINGFUL}
                        order by cl.changed_at desc, cl.id desc
                        limit ${STOVE_CHANGES_FIRST_PAGE + 1}`,
                args: [saleId ?? "", batchId],
              }),

              /*
               * How many edits there are altogether, so the page can say
               * "5 of 128" instead of "5" and leave the reader to guess
               * whether that is all of them.
               *
               * A separate statement rather than count(*) over (), which would
               * make Postgres materialise every matching row to number five of
               * them. Filtered on record_pk, which change_log_record_idx leads
               * with, so it stays an index-only count at any table size.
               */
              connection.queryObject({
                text: `select count(*)::int as total
                         from data_center.change_log cl
                        where ${CHANGES_WHERE}
                          and ${CHANGES_MEANINGFUL}`,
                args: [saleId ?? "", batchId],
              }),

              // Whether the paper for this transfer ever came back at all.
              transactionId
                ? connection.queryObject({
                  text: `select rc.received_count, rc.received_at, rc.note, rc.source,
                                p.full_name as logged_by
                           from data_center.record_consignments rc
                           left join public.profiles p on p.id = rc.created_by
                          where rc.transaction_id = $1
                          order by rc.received_at desc
                          limit 5`,
                  args: [transactionId],
                })
                : { rows: [] },

              /**
               * Anybody else holding this phone number.
               *
               * The rule is one stove to one phone, and create-sale already
               * refuses a second sale on a number whose last ten digits are
               * already live - so in a healthy register this comes back empty
               * every time. It is asked anyway, because the one place a
               * violation would be noticed is the record that names the buyer,
               * the serial and the number together, and a rule nobody can
               * observe is a rule nobody trusts.
               *
               * The tail is compared exactly as create-sale compares it, which
               * is also the expression idx_sales_phone_tail is built on, so
               * this is an index lookup rather than a scan of every sale.
               */
              saleId
                ? connection.queryObject({
                  text: `with me as (
                           select id,
                                  right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10) as tail
                             from public.sales where id = $1
                         )
                         select s2.stove_serial_no, s2.transaction_id,
                                s2.end_user_name, s2.sales_date, s2.phone,
                                sb2.stove_id
                           from public.sales s2
                           join me on s2.id <> me.id
                           left join public.stove_ids_base sb2 on sb2.sale_id = s2.id
                          where s2.is_archived is not true
                            and length(me.tail) = 10
                            and right(regexp_replace(coalesce(s2.phone, ''), '[^0-9]', '', 'g'), 10)
                                = me.tail
                          limit 5`,
                  args: [saleId],
                })
                : { rows: [] },

              // How many stoves rode along on the same transfer, and how many
              // of those have become sales. Cast to int: count() is a bigint
              // and JSON.stringify throws on those.
              transferId
                ? connection.queryObject({
                  text: `select count(*)::int as total,
                                count(sb.sale_id)::int as sold
                           from data_center.v_transfer_stoves ts
                           join public.stove_ids_base sb on sb.stove_id = ts.stove_id
                          where ts.transfer_id = $1`,
                  args: [transferId],
                })
                : { rows: [] },

              /*
               * The instalments themselves, not just the running total.
               *
               * `sales.total_paid` and `sales.payment_status` were already on
               * this page, which is a summary of a thing the page never
               * showed: 32 of the 45 rows in production are instalment sales
               * and `public.installment_payments` had never been opened by
               * anything in this module.
               *
               * It matters because the two already disagree. Measured on
               * production: 29 sales where the payments sum to `total_paid`,
               * two flagged instalment and partially paid with no payment rows
               * at all, one carrying payments while not flagged instalment,
               * and one where the sum simply differs. Four in thirty-three.
               *
               * So the rows come back and the page reconciles them out loud
               * rather than printing a list beside a total and leaving the
               * reader to notice. Read-only, like everything else here: the
               * sales app owns this table and this module owns no copy of it.
               */
              saleId
                ? connection.queryObject({
                  text: `select ip.id::text as id, ip.amount, ip.payment_method,
                                ip.payment_date, ip.notes, ip.created_at,
                                coalesce(up.url, ip.proof_image_url) as proof_url,
                                rb.full_name as recorded_by_name
                           from public.installment_payments ip
                           left join public.profiles rb on rb.id = ip.recorded_by
                           left join public.uploads up on up.id = ip.proof_image_id
                          where ip.sale_id = $1
                          order by ip.payment_date desc nulls last,
                                   ip.created_at desc`,
                  args: [saleId],
                })
                : { rows: [] },

              /*
               * Sales this stove used to have, which is nearly always a
               * cancellation.
               *
               * Everything else on this page hangs off `stove_ids_base.sale_id`,
               * and cancelling a sale RELEASES the stove: the sale keeps its
               * serial, the stock row drops the link and goes back to
               * available. Measured on production, zero stock rows point at a
               * cancelled sale. So a stove that was sold and then cancelled
               * read here as never sold, and the whole episode - who bought it,
               * for how much, who cancelled it and why - was invisible from the
               * one page whose promise is everything that ever happened to this
               * stove.
               *
               * Found by serial rather than by the link, because the link is
               * exactly what cancelling removes. Production has 28 cancelled
               * sales across 25 serials, so a stove can carry more than one and
               * this is a list rather than a row.
               */
              connection.queryObject({
                text: `select s.id::text as id, s.transaction_id, s.sales_date,
                              s.end_user_name, s.phone, s.amount, s.total_paid,
                              s.payment_status, s.is_archived,
                              s.cancelled_at, s.cancel_reason,
                              cnb.full_name as cancelled_by_name,
                              cb.full_name  as created_by_name
                         from public.sales s
                         left join public.profiles cnb on cnb.id = s.cancelled_by
                         left join public.profiles cb  on cb.id  = s.created_by
                        where upper(btrim(s.stove_serial_no)) = upper(btrim($1))
                          and ($2::uuid is null or s.id <> $2::uuid)
                        order by s.sales_date desc nulls last, s.created_at desc
                        limit 20`,
                args: [stoveId, saleId],
              }),
            ]);

          return json(
            {
              data: {
                stove,
                attempts: attempts.rows,
                payments: payments.rows,
                pastSales: pastSales.rows,
                sale: sale.rows[0] ?? null,
                enrichment: enrichment.rows[0] ?? null,
                provenance: provenance.rows,
                /*
                 * The newest five, not all of them. One more than five was
                 * asked for so `changesHasMore` is an answer rather than an
                 * inference from the count, which lags behind an edit made in
                 * another tab.
                 */
                changes: changes.rows.slice(0, STOVE_CHANGES_FIRST_PAGE),
                changesHasMore: changes.rows.length > STOVE_CHANGES_FIRST_PAGE,
                changesTotal:
                  Number((changeCount.rows[0] as { total?: number } | undefined)?.total ?? 0),
                consignment: consignment.rows,
                phoneTwins: phoneTwins.rows,
                siblings: siblings.rows[0] ?? null,
              },
            },
            200,
            cors,
          );
        });
      }

      /**
       * One box, two anchors.
       *
       * A stove ID is the identifier everything else hangs off, so it resolves
       * straight to the record. A transaction reference names a whole transfer,
       * so it resolves to the batch and the stoves on it, which is what
       * somebody holding a receipt with only the reference on it actually has.
       *
       * A prefix returns candidates rather than nothing, because half a serial
       * read off a smudged label is the common case and refusing it sends the
       * person back to the paper.
       */
      /**
       * The earliest date anything in the module knows about.
       *
       * The period control offers whole years, and offering years the register
       * does not hold reads as "no sales that year" rather than "we were not
       * trading". One cheap read, cached by the caller for the session, rather
       * than a guessed start year baked into the front end.
       */
      /**
       * The lists behind the Stove Records filter panel.
       *
       * A filter is only usable if you can see what there is to filter by.
       * Typing a partner's name from memory is how somebody searches for
       * "Gombe Enterprises" and finds nothing, because the record says "Gombe
       * Enterprise Ltd".
       *
       * WHERE EACH LIST COMES FROM, AND WHY NEVER FROM public.sales
       *
       * Every list is read from a small table. `select distinct state_backup
       * from sales` is a sequential scan of half a million rows to return
       * thirty-seven strings, and it would run every time the panel opened.
       *
       *   partners     data_center.transfer_funnel, one row per transfer
       *   reps         transfer_funnel again, which is indexed on sales_rep
       *   states/LGAs  public.nigeria_states / nigeria_lgas, reference data
       *   models       public.payment_models, a handful of rows
       *   agents       public.profiles, narrowed to who can record a sale
       *
       * The consequence worth naming: partners and reps here are the ones who
       * have had a TRANSFER, not the ones who have had a sale. That is the
       * wider set and the more useful one - a partner holding stoves with no
       * sales recorded yet is exactly who somebody goes looking for.
       *
       * Scoped like every other read. A partner user sees their own partner in
       * the list and nobody else's, because the predicate that limits the rows
       * limits the choices too.
       */
      case "record_facets": {
        const superAdmin = isSuperAdmin(profile.role);
        const resolved = superAdmin
          ? { accessRole: null, features: [] as string[] }
          : await resolveAccess(userId);
        if (!superAdmin && resolved.accessRole === null) {
          return json({ error: "No Data Center access", code: "no_access" }, 403, cors);
        }
        if (!superAdmin && !resolved.features.includes("records.view")) {
          return json({ error: "Not permitted", code: "no_feature" }, 403, cors);
        }

        const scopeInput = await resolveScope(
          supabase,
          userId,
          profile.role,
          profile.organization_id ?? null,
        );
        const scope = buildTransferScopeSql({ ...scopeInput, requestedOrgId: null }, 1, "f");

        return await withReadConnection(async (connection) => {
          const [partners, reps, states, lgas, models, agents] = await Promise.all([
            connection.queryObject({
              /*
                * Branch and state come too, because the name does not identify
                * the partner. Four organizations are called LAPO, four Solar
                * Sister, and two Solar Sister rows are both "Main Branch" in
                * different states. A picker built on names alone offers the
                * same word several times and cannot say which is which.
                */
              text: `select f.organization_id::text as id,
                            max(f.partner_name) as name,
                            max(o.partner_id) as partner_id,
                            max(o.branch) as branch,
                            max(o.state) as state,
                            count(*)::int as transfers
                       from data_center.transfer_funnel f
                       left join public.organizations o on o.id = f.organization_id
                      where f.organization_id is not null and ${scope.sql}
                      group by f.organization_id
                      order by max(f.partner_name), max(o.branch)
                      limit 500`,
              args: scope.args,
            }),
            connection.queryObject({
              text: `select f.sales_rep as name, count(*)::int as transfers
                       from data_center.transfer_funnel f
                      where f.sales_rep is not null and f.sales_rep <> ''
                        and ${scope.sql}
                      group by f.sales_rep
                      order by f.sales_rep
                      limit 500`,
              args: scope.args,
            }),
            // Reference data, so the list holds every state whether or not
            // anybody has sold there. Choosing an empty one is a real answer.
            connection.queryObject({
              text: `select name from public.nigeria_states order by name`,
            }),
            connection.queryObject({
              text: `select state_name, name from public.nigeria_lgas
                      order by state_name, name`,
            }),
            connection.queryObject({
              text: `select id::text as id, name from public.payment_models
                      order by name limit 100`,
            }),
            /*
             * Everybody with a name, not a guess at who sells - and only the
             * people this caller is already entitled to see.
             *
             * TWO THINGS WENT WRONG HERE, IN ORDER
             *
             * First it filtered on a hand-written list of roles, and the list
             * was wrong: the profile that had recorded every sale on the
             * preview was a `partner_agent`, which was not on it, so the one
             * person who had sold anything was the one person "Sold by" would
             * not offer. Two of the roles named did not exist at all.
             *
             * Dropping the role filter fixed that and introduced a quieter
             * problem: every other list in this response is scoped, and this
             * one was not - so a partner login would have been handed the
             * names of every ACSL member of staff to populate a dropdown.
             * That is not a permissions hole, since nothing else opens from a
             * name, but a filter list is a poor reason to disclose a staff
             * directory.
             *
             * So: scoped to the caller's own organization unless they are
             * entitled to more. The honest alternative - only profiles that
             * have actually recorded a sale - is `select distinct created_by
             * from sales`, a scan of half a million rows to build a dropdown.
             * Between a list slightly too long and one silently missing the
             * person you are looking for, too long is the one somebody can
             * work with: picking a name that has sold nothing answers "none",
             * which is true.
             */
            connection.queryObject({
              text: `select p.id::text as id, p.full_name as name
                       from public.profiles p
                      where p.full_name is not null and p.full_name <> ''
                        and ($1::boolean
                             or p.organization_id is not distinct from $2::uuid)
                      order by p.full_name
                      limit 1000`,
              args: [
                // Anyone whose reach is wider than a single partner sees the
                // whole list, which is the same test the rows themselves use.
                superAdmin || scopeInput.role !== "partner",
                profile.organization_id ?? null,
              ],
            }),
          ]);

          /*
           * The parts of the completeness rule, for the Missing facet. Read
           * from the rule itself, so a field added in Settings is offered here
           * without a release; evidence is offered only while a rule asks for it.
           * Read by shape rather than by building the predicate, so a bad
           * evidence row in config costs the Missing list and not every list.
           */
          const rule = await connection.queryObject<{ fields: string[] | null; has_evidence: boolean }>({
            text: `select (select array(select jsonb_array_elements_text(value))
                             from data_center.workflow_config
                            where key = 'completeness_required_fields') as fields,
                          coalesce((select jsonb_typeof(value) = 'array' and jsonb_array_length(value) > 0
                                      from data_center.workflow_config
                                     where key = 'completeness_evidence_any_of'), false) as has_evidence`,
          });
          const missingFields = [
            ...(rule.rows[0]?.fields ?? []),
            ...(rule.rows[0]?.has_evidence ? ["evidence"] : []),
          ];

          // The LGAs arrive flat and are grouped here rather than in
          // thirty-seven round trips: the panel needs "the LGAs of whichever
          // state is chosen", which is a lookup, not a query.
          const byState: Record<string, string[]> = {};
          for (const row of lgas.rows as { state_name: string; name: string }[]) {
            (byState[row.state_name] ??= []).push(row.name);
          }

          return json(
            {
              data: {
                partners: partners.rows,
                salesReps: reps.rows,
                states: (states.rows as { name: string }[]).map((r) => r.name),
                lgasByState: byState,
                salesModels: models.rows,
                salesAgents: agents.rows,
                missingFields,
                scope: scope.description,
              },
            },
            200,
            cors,
          );
        });
      }

      /**
       * One stove's edit history, a page at a time.
       *
       * The stove page used to render every change it was handed, and it was
       * handed fifty. A record worked hard - re-called, corrected, sent back
       * to Sales and returned - carries more than fifty, and the page then
       * ended in a wall of them with the sale itself scrolled far above.
       *
       * So the page shows the newest five and asks for the rest only when
       * somebody wants them. Keyset paged on (changed_at, id) like every other
       * list in this module. `id` is the tiebreaker rather than decoration: a
       * batch commit writes several audit rows inside one transaction, and
       * those share a timestamp down to the microsecond.
       */
      case "stove_changes": {
        const superAdmin = isSuperAdmin(profile.role);
        const resolved = superAdmin
          ? { accessRole: null, features: [] as string[] }
          : await resolveAccess(userId);
        if (!superAdmin && resolved.accessRole === null) {
          return json({ error: "No Data Center access", code: "no_access" }, 403, cors);
        }
        if (!superAdmin && !resolved.features.includes("records.view")) {
          return json({ error: "Not permitted", code: "no_feature" }, 403, cors);
        }

        const b = body as {
          saleId?: string;
          batchId?: string;
          limit?: number;
          cursor?: { changedAt?: string; id?: string } | null;
        };
        const saleId = typeof b.saleId === "string" && UUID_RE.test(b.saleId) ? b.saleId : "";
        const batchId = typeof b.batchId === "string" && UUID_RE.test(b.batchId) ? b.batchId : "";
        if (!saleId && !batchId) {
          return json(
            { error: "Say which record's history to read", code: "bad_input" },
            400,
            cors,
          );
        }
        const limit = Math.min(Math.max(Number(b.limit) || 10, 1), 100);

        const args: unknown[] = [saleId, batchId];
        let cursorSql = "";
        if (b.cursor?.changedAt && b.cursor?.id) {
          /*
           * Validated as a shape, then handed to Postgres as the text it
           * already is. Parsing it into a Date to "check" it would throw away
           * the microseconds that make it a correct cursor, which is the whole
           * failure cursor_at exists to avoid.
           */
          const at = String(b.cursor.changedAt);
          const looksLikeATimestamp =
            /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?([+-]\d{2}(:?\d{2})?|Z)?$/;
          if (!looksLikeATimestamp.test(at) || !/^\d+$/.test(String(b.cursor.id))) {
            return json({ error: "Malformed cursor", code: "bad_input" }, 400, cors);
          }
          // Newest first, so "past the cursor" means strictly older.
          args.push(at, String(b.cursor.id));
          cursorSql = " and (cl.changed_at, cl.id) < ($3::timestamptz, $4::bigint)";
        }

        return await withReadConnection(async (connection) => {
          const page = await connection.queryObject({
            text: `${CHANGES_SELECT}
                    where ${CHANGES_WHERE}${cursorSql}
                      and ${CHANGES_MEANINGFUL}
                    order by cl.changed_at desc, cl.id desc
                    limit ${limit + 1}`,
            args,
          });
          const rows = page.rows as Record<string, unknown>[];
          const hasMore = rows.length > limit;
          const slice = hasMore ? rows.slice(0, limit) : rows;
          const last = slice[slice.length - 1];
          return json(
            {
              data: {
                rows: slice,
                hasMore,
                nextCursor: hasMore && last
                  // Passed through as Postgres wrote it. Never reconstructed
                  // from the Date beside it - see cursor_at above.
                  ? { changedAt: String(last.cursor_at), id: String(last.id) }
                  : null,
              },
            },
            200,
            cors,
          );
        });
      }

      /**
       * The records sent back to Sales, for whoever is asking.
       *
       * WHO SEES WHAT, AND WHY IT IS COMPUTED RATHER THAN STORED
       *
       * Three answers, in order of reach:
       *
       *   a data manager or super admin   everything open
       *   a standing recipient            everything open
       *   a mapped sales rep              the send-backs from their own
       *                                   consignments, and nothing else
       *
       * A standing recipient sees everything on purpose. They are the people
       * named in Settings precisely so that a record whose rep has no account
       * still reaches somebody, and a recipient who could only see the ones
       * nobody else could see would be the last line of defence with a blind
       * spot in the middle of it.
       *
       * Nothing about this routing is stored per record. It is worked out from
       * the recipient list and the rep mapping as they stand right now, so
       * linking a rep to their account this afternoon fixes every send-back
       * already open rather than only the ones raised afterwards.
       */
      case "send_backs": {
        const superAdmin = isSuperAdmin(profile.role);
        const resolved = superAdmin
          ? { accessRole: null, features: [] as string[] }
          : await resolveAccess(userId);
        if (!superAdmin && resolved.accessRole === null) {
          return json({ error: "No Data Center access", code: "no_access" }, 403, cors);
        }
        if (!superAdmin && !resolved.features.includes("corrections.fix")) {
          return json({ error: "Not permitted", code: "no_feature" }, 403, cors);
        }

        const limit = Math.min(
          Math.max(Number((body as { limit?: number }).limit) || 200, 1),
          500,
        );

        return await withReadConnection(async (connection) => {
          const standing = superAdmin
            ? { rows: [{ ok: true }] }
            : await connection.queryObject<{ ok: boolean }>({
              text: `select true as ok
                       from data_center.send_back_recipients
                      where user_id = $1 and is_enabled`,
              args: [userId],
            });

          const seesEverything =
            superAdmin ||
            standing.rows.length > 0 ||
            resolved.features.includes("corrections.route");

          const rows = await connection.queryObject({
            text: `select v.sale_id::text, v.stove_serial_no, v.transaction_id,
                          v.correction_requested_at, v.correction_note,
                          v.correction_reason, v.requested_by_name,
                          v.organization_id::text, v.partner_name,
                          v.transfer_reference, v.sales_rep,
                          v.sales_rep_user_id::text,
                          v.sales_rep_marked_no_account,
                          v.sales_rep_account_name,
                          v.end_user_name, v.phone, v.sales_date::text as sales_date,
                          (v.sales_rep_user_id = $1) as is_my_consignment
                     from data_center.v_send_backs v
                    where $2::boolean or v.sales_rep_user_id = $1
                    order by v.correction_requested_at desc
                    limit ${limit}`,
            args: [userId, seesEverything],
          });

          /*
           * The reps with nobody to send to, named.
           *
           * Only shown to somebody who can do something about it. It is the
           * one number on this screen that is about the system rather than
           * about the records: a send-back sitting against an unmapped rep is
           * reaching the standing recipients and nobody else, which is
           * survivable but not what anyone intended.
           */
          const unrouted = seesEverything
            ? await connection.queryObject({
              text: `select coalesce(v.sales_rep, '(no rep on the transfer)') as sales_rep,
                            count(*)::int as waiting
                       from data_center.v_send_backs v
                      where v.sales_rep_user_id is null
                      group by 1 order by 2 desc limit 50`,
            })
            : { rows: [] };

          return json(
            {
              data: {
                rows: rows.rows,
                // What the banner counts. Deliberately the number of records
                // rather than the number of partners or reps: it is the size
                // of the pile, which is the thing somebody acts on.
                waiting: rows.rows.length,
                seesEverything,
                unrouted: unrouted.rows,
              },
            },
            200,
            cors,
          );
        });
      }

      case "period_bounds": {
        const superAdmin = isSuperAdmin(profile.role);
        const resolved = superAdmin
          ? { accessRole: null, features: [] as string[] }
          : await resolveAccess(userId);
        if (!superAdmin && resolved.accessRole === null) {
          return json({ error: "No Data Center access", code: "no_access" }, 403, cors);
        }

        return await withReadConnection(async (connection) => {
          const found = await connection.queryObject({
            // min() on an indexed column is an index scan, not a table scan;
            // idx_sales_sales_date_id serves it either way round.
            text: `select
                     (select min(sales_date)::text from public.sales
                       where is_archived is not true) as earliest_sale,
                     (select min(left(f.sales_date, 10)) from data_center.transfer_funnel f
                       where f.sales_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}') as earliest_transfer`,
          });
          const row = (found.rows[0] ?? {}) as {
            earliest_sale: string | null;
            earliest_transfer: string | null;
          };
          // The earlier of the two, because one control covers both kinds of
          // surface and a year is offered if either has anything in it.
          const candidates = [row.earliest_sale, row.earliest_transfer].filter(
            (v): v is string => Boolean(v),
          );
          return json(
            {
              data: {
                earliest: candidates.length > 0 ? candidates.sort()[0] : null,
                earliestSale: row.earliest_sale,
                earliestTransfer: row.earliest_transfer,
              },
            },
            200,
            cors,
          );
        });
      }

      /**
       * Every phone number carrying more than one stove, with the detail.
       *
       * A number appearing twice is usually a typo and occasionally a family,
       * and the only way to tell is to look at both records side by side -
       * same surname, same address, sequential serials off one consignment
       * reads as a household; two different names in two states reads as a
       * digit typed wrong. So this returns the records, not a count.
       *
       * Grouped in SQL rather than in the browser, because the group is the
       * unit a person reads and stitching it client-side would page through
       * the middle of one.
       */
      case "shared_phones": {
        const superAdmin = isSuperAdmin(profile.role);
        const resolved = superAdmin
          ? { accessRole: null, features: [] as string[] }
          : await resolveAccess(userId);
        if (!superAdmin && resolved.accessRole === null) {
          return json({ error: "No Data Center access", code: "no_access" }, 403, cors);
        }
        if (!superAdmin && !resolved.features.includes("records.view")) {
          return json({ error: "Not permitted", code: "no_feature" }, 403, cors);
        }

        const b = body as { search?: string; confirmedOnly?: boolean; limit?: number };
        const limit = Math.min(Math.max(Number(b.limit) || 100, 1), 500);
        const term = String(b.search ?? "").trim().slice(0, 100);

        return await withReadConnection(async (connection) => {
          const rows = await connection.queryObject({
            text: `with grouped as (
                     select sp.phone_tail,
                            count(*)::int as stove_count,
                            bool_or(sp.confirmed) as any_confirmed,
                            min(sp.created_at) as first_seen,
                            max(sp.updated_at) as last_touched,
                            json_agg(json_build_object(
                              'sale_id', sp.sale_id::text,
                              'stove_id', sp.stove_id,
                              'phone_as_written', sp.phone_as_written,
                              'source', sp.source,
                              'confirmed', sp.confirmed,
                              'note', sp.note,
                              'buyer', s.end_user_name,
                              'address', s.state_backup,
                              'lga', s.lga_backup,
                              'partner', s.partner_name,
                              'sales_date', s.sales_date,
                              'recorded_by', p.full_name,
                              'recorded_at', sp.created_at
                            ) order by sp.created_at) as stoves
                       from data_center.shared_phones sp
                       left join public.sales s on s.id = sp.sale_id
                       left join public.profiles p on p.id = sp.created_by
                      group by sp.phone_tail
                     having count(*) > 1
                   )
                   select * from grouped
                    where ($1::text = '' or phone_tail like '%' || $1 || '%'
                           or stoves::text ilike '%' || $1 || '%')
                      and ($2::boolean is not true or any_confirmed)
                    order by last_touched desc
                    limit $3`,
            args: [term, b.confirmedOnly === true, limit],
          });
          return json({ data: { rows: rows.rows } }, 200, cors);
        });
      }

      case "stove_search": {
        const superAdmin = isSuperAdmin(profile.role);
        const resolved = superAdmin
          ? { accessRole: null, features: [] as string[] }
          : await resolveAccess(userId);
        if (!superAdmin && resolved.accessRole === null) {
          return json({ error: "No Data Center access", code: "no_access" }, 403, cors);
        }
        if (!superAdmin && !resolved.features.includes("records.view")) {
          return json({ error: "Not permitted", code: "no_feature" }, 403, cors);
        }

        const raw = String((body as { query?: string }).query ?? "").trim().slice(0, 120);
        if (raw.length < 3) {
          return json(
            { error: "Type at least three characters", code: "bad_input" },
            400,
            cors,
          );
        }

        const scopeInput = await resolveScope(
          supabase,
          userId,
          profile.role,
          profile.organization_id ?? null,
        );
        const scope = buildTransferScopeSql({ ...scopeInput, requestedOrgId: null }, 2, "f");
        // Escaped, so a serial containing % or _ searches for itself rather
        // than for everything.
        const like = `${raw.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;

        return await withReadConnection(async (connection) => {
          // An exact stove ID is the answer, not a candidate.
          const exact = await connection.queryObject({
            text: `select sb.stove_id from public.stove_ids_base sb
                    where upper(sb.stove_id) = upper($1) limit 1`,
            args: [raw],
          });
          if (exact.rows.length > 0) {
            return json(
              {
                data: {
                  kind: "stove",
                  stoveId: (exact.rows[0] as { stove_id: string }).stove_id,
                  stoves: [],
                  transfers: [],
                },
              },
              200,
              cors,
            );
          }

          const [transfers, stoves] = await Promise.all([
            // A transfer reference, under either name it goes by: the funnel
            // calls it transaction_id, the stock table sales_reference.
            connection.queryObject({
              text: `select f.transfer_id::text, f.transaction_id, f.partner_name,
                            f.organization_id::text, f.sales_rep, f.sales_date,
                            f.issued_count, f.digitalised_count, f.verified_count
                       from data_center.transfer_funnel f
                      where upper(f.transaction_id) like upper($1)
                        and ${scope.sql}
                      order by f.sales_date desc nulls last
                      limit 10`,
              args: [like, ...scope.args],
            }),
            // Partial serials. Ordered by the serial itself so a run of them
            // reads in the order they are printed on the labels.
            connection.queryObject({
              text: `select sb.stove_id, sb.status as stock_status,
                            f.partner_name, f.transaction_id,
                            (sb.sale_id is not null) as sold
                       from public.stove_ids_base sb
                       left join data_center.v_transfer_stoves b on b.stove_id = sb.stove_id
                       left join data_center.transfer_funnel f on f.transfer_id = b.transfer_id
                      where upper(sb.stove_id) like upper($1)
                        and (f.transfer_id is null or ${scope.sql})
                      order by sb.stove_id
                      limit 25`,
              args: [like, ...scope.args],
            }),
          ]);

          return json(
            {
              data: {
                kind: transfers.rows.length > 0 || stoves.rows.length > 0 ? "matches" : "none",
                stoveId: null,
                transfers: transfers.rows,
                stoves: stoves.rows,
              },
            },
            200,
            cors,
          );
        });
      }

      case "assignment_log": {
        const superAdmin = isSuperAdmin(profile.role);
        const resolved = superAdmin
          ? { accessRole: null, features: [] as string[] }
          : await resolveAccess(userId);

        if (!superAdmin && resolved.accessRole === null) {
          return json({ error: "No Data Center access", code: "no_access" }, 403, cors);
        }
        if (!superAdmin && !resolved.features.includes("records.view")) {
          return json({ error: "Not permitted", code: "no_feature" }, 403, cors);
        }

        const scopeInput = await resolveScope(
          supabase,
          userId,
          profile.role,
          profile.organization_id ?? null,
        );
        const filters = (body.filters ?? {}) as {
          organizationId?: string;
          agentId?: string;
          batchState?: string;
          outcome?: string;
          dateFrom?: string;
          dateTo?: string;
        };

        const scope = buildScopeSql(
          { ...scopeInput, requestedOrgId: filters.organizationId ?? null },
          1,
          "l",
        );
        const args: unknown[] = [...scope.args];
        const where: string[] = [scope.sql];
        const p = (v: unknown) => {
          args.push(v);
          return `$${args.length}`;
        };

        if (filters.agentId) where.push(`l.agent_id = ${p(filters.agentId)}`);
        if (filters.batchState) where.push(`l.batch_state = ${p(filters.batchState)}`);
        if (filters.outcome) where.push(`l.verification_outcome = ${p(filters.outcome)}`);
        // Filtered on when the batch was assigned, because that is the axis
        // the log is ordered on and the question people ask of it: what went
        // out this week, and what came of it.
        if (filters.dateFrom) where.push(`l.assigned_at >= ${p(filters.dateFrom)}::date`);
        if (filters.dateTo) where.push(`l.assigned_at < (${p(filters.dateTo)}::date + 1)`);

        // Keyset cursor: strictly after the last row of the previous page.
        const cursor = body.cursor as
          | { assignedAt: string; batchId: string; position: number }
          | undefined;
        if (cursor?.assignedAt && cursor?.batchId) {
          where.push(
            `(l.assigned_at, l.batch_id, l.position) < (${p(cursor.assignedAt)}::timestamptz, ${
              p(cursor.batchId)
            }::uuid, ${p(Number(cursor.position) || 0)})`,
          );
        }

        const limit = Math.min(Math.max(Number(body.limit) || 50, 1), 200);

        return await withReadConnection(async (connection) => {
          const rows = await connection.queryObject({
            text: `select l.batch_id::text, l.organization_id::text, l.partner_name,
                          l.agent_id::text, l.agent_name, l.assigned_at, l.batch_state,
                          l.batch_size, l.last_activity_at, l.reclaimed_at, l.reclaim_reason,
                          l.sale_id::text, l.position, l.is_active,
                          l.stove_serial_no, l.sales_date,
                          l.verification_outcome, l.call_outcome, l.attempt_count,
                          l.number_on_record, l.last_attempt_at, l.last_attempt_outcome,
                          l.last_attempt_by
                   from data_center.v_assignment_log l
                   where ${where.join(" and ")}
                   order by l.assigned_at desc, l.batch_id desc, l.position desc
                   limit ${limit + 1}`,
            args,
          });
          const page = rows.rows.slice(0, limit) as Record<string, unknown>[];
          const last = page[page.length - 1];
          return json(
            {
              data: {
                rows: page,
                scope: scope.description,
                nextCursor: rows.rows.length > limit && last
                  ? {
                    assignedAt: last.assigned_at,
                    batchId: last.batch_id,
                    position: last.position,
                  }
                  : null,
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
