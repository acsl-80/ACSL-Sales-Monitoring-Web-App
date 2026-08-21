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
import { BadRequest, buildRecordsQuery, toPage } from "./records-query.ts";
import { buildScopeSql, buildTransferScopeSql, type ScopeInput } from "./scope.ts";

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
            stale_after_hours: number;
            last_run: unknown | null;
            computed_at: string | null;
          }>({
            text: `select
                     (select coalesce(jsonb_agg(t order by t.metric_key, t.value_num desc nulls last), '[]'::jsonb)
                        from (select metric_key, dimension, value_num, value_text, run_finished_at
                                from data_center.v_current_metrics) t) as metrics,
                     (select coalesce(value::text::int, 24) from data_center.workflow_config
                       where key = 'metrics.stale_after_hours') as stale_after_hours,
                     (select to_jsonb(r) from (
                        select finished_at, status, duration_ms
                        from data_center.metric_runs order by started_at desc limit 1) r) as last_run,
                     (select max(run_finished_at) from data_center.v_current_metrics) as computed_at`,
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
       * The reconciliation funnel: what was sold to a partner against what has
       * come back.
       *
       * Reads `transfer_funnel`, which a compute run maintains. It does not
       * read the view of the same name: that one aggregates over public.sales,
       * and this module does not do that in a request. See the note at the top
       * of 20260821010000_data_center_transfers.sql for what it cost to learn
       * that the hard way.
       */
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
          const rows = await connection.queryObject({
            text: `select f.transfer_id::text, f.transaction_id, f.organization_id::text,
                          f.partner_name, f.partner_id, f.transfer_state, f.transfer_branch,
                          f.sales_rep, f.sales_date, f.transfer_date,
                          f.issued_count, f.received_count, f.received_is_logged,
                          f.digitalised_count, f.verified_count, f.unverified_count,
                          f.unreachable_count, f.unresolved_count, f.outstanding_count,
                          f.computed_at
                   from data_center.transfer_funnel f
                   where ${where.join(" and ")}
                   order by f.outstanding_count desc, f.sales_date desc nulls last
                   limit ${limit}`,
            args,
          });
          const stamp = await connection.queryObject<{ computed_at: string | null }>({
            text: "select max(computed_at) as computed_at from data_center.transfer_funnel",
          });
          return json(
            {
              data: {
                rows: rows.rows,
                scope: scope.description,
                computedAt: stamp.rows[0]?.computed_at ?? null,
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
                     left join data_center.v_call_center c on c.sale_id = sb.sale_id
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
                     left join data_center.v_call_center c on c.sale_id = sb.sale_id
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

          return json({ data: { stove, attempts: attempts.rows } }, 200, cors);
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
