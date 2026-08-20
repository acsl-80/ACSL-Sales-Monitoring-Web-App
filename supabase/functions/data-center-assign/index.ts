// Data Center: handing out call centre work.
//
// The engine itself is data_center.assign_batches(), in SQL, holding an
// advisory lock. This function is its doorway and nothing more: it decides who
// may pull the lever, not how the machine works, for the same reason the
// metrics live in compute_metrics() rather than in TypeScript. "Who got what
// and why" must have one answer, in one file, and that file is the migration.
//
// Four actions:
//
//   run          assign work now. Admin only: it changes who is working what.
//   reclaim      take back quiet batches. Admin only, and `run` does it first
//                anyway, so this exists for the "someone left today" case.
//   status       the queue at a glance: callable per partner, open batches.
//   my_batches   an agent's own work list. The one action agents call.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { withConnection, withReadConnection } from "../_shared/data-center-db.ts";
import { featuresFor } from "../_shared/data-center-roles.ts";

const DEFAULT_ORIGINS = [
  "https://sales.atmosfair.com.ng",
  "http://localhost:5173",
  "http://localhost:3000",
  "http://127.0.0.1:5173",
];
const ORIGIN_SUFFIXES = [".vercel.app"];

function originAllowed(origin: string): boolean {
  if (!origin) return true;
  const configured = (Deno.env.get("DATA_CENTER_ALLOWED_ORIGINS") ?? "")
    .split(",").map((o) => o.trim()).filter(Boolean);
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
      .from("profiles").select("role").eq("id", userId).single();
    if (!profile) {
      return json({ error: "No profile for this user", code: "no_profile" }, 403, cors);
    }
    const superAdmin = profile.role === "super_admin";

    // Entry and features, resolved the same way as every other endpoint.
    const access = superAdmin ? null : await withReadConnection(async (conn) => {
      const r = await conn.queryObject<{ access_role: string; keys: string[] }>({
        text: `select m.access_role,
                      coalesce(array_agg(g.feature_key) filter (where g.feature_key is not null), '{}') as keys
                 from data_center.module_access m
                 left join data_center.feature_grants g on g.user_id = m.user_id
                where m.user_id = $1
                group by m.access_role`,
        args: [userId],
      });
      const row = r.rows[0];
      return row
        ? { role: row.access_role, features: featuresFor(row.access_role, row.keys) }
        : null;
    });
    if (!superAdmin && access === null) {
      return json({ error: "No Data Center access", code: "no_access" }, 403, cors);
    }
    const can = (key: string) => superAdmin || (access?.features ?? []).includes(key);

    let body: {
      action?: string;
      agentId?: string;
      organizationId?: string;
      size?: number;
      batchId?: string;
      saleId?: string;
      reason?: string;
    } = {};
    try {
      body = await req.json();
    } catch {
      return json({ error: "Body must be JSON", code: "bad_body" }, 400, cors);
    }

    switch (body.action) {
      /**
       * Assign work now. Reclaims first, because there is no point handing out
       * new batches while someone who left last week still holds forty records.
       *
       * Admin only. It changes who is working what, which is a management act,
       * and the eventual schedule will call it with an admin's authority too.
       */
      case "run": {
        if (!superAdmin) {
          return json({ error: "Only a super admin assigns work", code: "no_feature" }, 403, cors);
        }
        return await withConnection(async (conn) => {
          const reclaimed = await conn.queryObject<{ n: number }>({
            text: "select data_center.reclaim_stale_batches() as n",
          });
          const assigned = await conn.queryObject<{
            batch_id: string; agent_id: string; organization_id: string; size: number;
          }>({
            text: `select batch_id::text, agent_id::text, organization_id::text, size
                   from data_center.assign_batches()`,
          });
          return json(
            {
              data: {
                reclaimed: Number(reclaimed.rows[0]?.n ?? 0),
                batches: assigned.rows,
              },
            },
            200,
            cors,
          );
        });
      }

      /** Take back quiet batches without assigning anything new. */
      case "reclaim": {
        if (!superAdmin) {
          return json({ error: "Only a super admin reclaims work", code: "no_feature" }, 403, cors);
        }
        return await withConnection(async (conn) => {
          const r = await conn.queryObject<{ n: number }>({
            text: "select data_center.reclaim_stale_batches() as n",
          });
          return json({ data: { reclaimed: Number(r.rows[0]?.n ?? 0) } }, 200, cors);
        });
      }

      /**
       * The queue at a glance. Two small reads: how much is callable per
       * partner, and who holds what. Both indexed; neither touches sales
       * beyond the callable view's own filters.
       */
      case "status": {
        if (!can("dashboard.view")) {
          return json({ error: "This needs the dashboard.view permission", code: "no_feature" }, 403, cors);
        }
        return await withReadConnection(async (conn) => {
          const pool = await conn.queryObject({
            text: `select r.organization_id::text, r.partner_name, count(*)::int as callable
                     from data_center.v_callable_records r
                    group by 1, 2
                    order by callable desc
                    limit 50`,
          });
          const open = await conn.queryObject({
            text: `select b.id::text as batch_id, b.organization_id::text, o.partner_name,
                          b.assigned_to::text as agent_id, p.full_name as agent_name,
                          b.assigned_at, b.size, b.last_activity_at,
                          (select count(*)::int from data_center.assignment_items i
                            where i.batch_id = b.id and i.is_active) as remaining
                     from data_center.assignment_batches b
                     join public.organizations o on o.id = b.organization_id
                     left join public.profiles p on p.id = b.assigned_to
                    where b.state = 'open'
                    order by b.assigned_at desc
                    limit 100`,
          });
          return json({ data: { pool: pool.rows, open: open.rows } }, 200, cors);
        });
      }

      /**
       * An agent's own work. Scoped to the caller unconditionally: there is no
       * userId parameter, because "whose batches" is answered by the token.
       */
      case "my_batches": {
        if (!can("call_records.edit")) {
          return json({ error: "This needs the call_records.edit permission", code: "no_feature" }, 403, cors);
        }
        return await withReadConnection(async (conn) => {
          const r = await conn.queryObject({
            text: `select l.batch_id::text, l.partner_name, l.assigned_at, l.batch_size,
                          l.sale_id::text, l.position, l.stove_serial_no, l.sales_date,
                          l.verification_outcome, l.attempt_count, l.last_attempt_at
                     from data_center.v_assignment_log l
                    where l.agent_id = $1 and l.batch_state = 'open' and l.is_active
                    order by l.assigned_at desc, l.position
                    limit 200`,
            args: [userId],
          });
          return json({ data: { items: r.rows } }, 200, cors);
        });
      }

      /**
       * The console's own read: every call agent with what they are holding,
       * and every partner with what is still waiting. Two questions that are
       * always asked together, because assigning is choosing one of each.
       */
      case "agents": {
        if (!superAdmin) {
          return json({ error: "Only a super admin assigns work", code: "no_feature" }, 403, cors);
        }
        return await withReadConnection(async (conn) => {
          const agents = await conn.queryObject({
            text: `select m.user_id::text as agent_id,
                          p.full_name, p.email, p.role as app_role,
                          m.access_role,
                          coalesce(cap.is_enabled, true) as is_enabled,
                          cap.max_open_batches,
                          (select count(*)::int from data_center.assignment_batches b
                            where b.assigned_to = m.user_id and b.state = 'open') as open_batches,
                          (select count(*)::int from data_center.assignment_batches b
                             join data_center.assignment_items i on i.batch_id = b.id
                            where b.assigned_to = m.user_id and b.state = 'open' and i.is_active
                          ) as records_held,
                          (select max(b.last_activity_at) from data_center.assignment_batches b
                            where b.assigned_to = m.user_id and b.state = 'open') as last_activity_at
                     from data_center.module_access m
                     join public.profiles p on p.id = m.user_id
                     left join data_center.call_agent_profiles cap on cap.user_id = m.user_id
                    where m.access_role in ('call_agent', 'editor')
                    order by p.full_name nulls last`,
          });
          const pool = await conn.queryObject({
            text: `select r.organization_id::text, r.partner_name, count(*)::int as callable,
                          min(r.sales_date) as oldest
                     from data_center.v_callable_records r
                    group by 1, 2
                    order by callable desc, r.partner_name`,
          });
          const defaults = await conn.queryObject<{ batch_size: number }>({
            text: `select coalesce((select (value #>> '{}')::int
                                      from data_center.workflow_config
                                     where key = 'assignment.batch_size'), 20) as batch_size`,
          });
          return json(
            {
              data: {
                agents: agents.rows,
                pool: pool.rows,
                batchSize: Number(defaults.rows[0]?.batch_size ?? 20),
              },
            },
            200,
            cors,
          );
        });
      }

      /**
       * One agent, opened up: the batches they hold, and the records in each.
       *
       * One read rather than a read per batch. An agent holds tens of records,
       * not thousands, so the whole tree fits in one response and the drill
       * from partner to serial costs nothing once it is open.
       */
      case "agent_detail": {
        if (!superAdmin) {
          return json({ error: "Only a super admin assigns work", code: "no_feature" }, 403, cors);
        }
        if (!body.agentId) {
          return json({ error: "agentId is required", code: "bad_input" }, 400, cors);
        }
        return await withReadConnection(async (conn) => {
          const r = await conn.queryObject({
            text: `select l.batch_id::text, l.organization_id::text, l.partner_name,
                          l.assigned_at, l.batch_size, l.last_activity_at,
                          l.sale_id::text, l.position, l.stove_serial_no, l.sales_date,
                          l.number_on_record, l.verification_outcome, l.call_outcome,
                          l.attempt_count
                     from data_center.v_assignment_log l
                    where l.agent_id = $1 and l.batch_state = 'open' and l.is_active
                    order by l.assigned_at desc, l.position
                    limit 1000`,
            args: [body.agentId],
          });
          return json({ data: { items: r.rows } }, 200, cors);
        });
      }

      /**
       * Hand one partner's records to one agent, on a supervisor's say-so.
       *
       * The size cap and the "is this person an agent" check live in the SQL
       * function, not here, so the rule holds for anything that ever calls it.
       */
      case "assign_manual": {
        if (!superAdmin) {
          return json({ error: "Only a super admin assigns work", code: "no_feature" }, 403, cors);
        }
        if (!body.agentId || !body.organizationId) {
          return json(
            { error: "agentId and organizationId are required", code: "bad_input" },
            400,
            cors,
          );
        }
        return await withConnection(async (conn) => {
          const r = await conn.queryObject<{ batch_id: string | null; size: number }>({
            text: `select batch_id::text, size
                     from data_center.assign_batch_manual($1, $2, $3, $4)`,
            args: [body.agentId, body.organizationId, body.size ?? null, userId],
          });
          const row = r.rows[0];
          return json(
            { data: { batchId: row?.batch_id ?? null, size: Number(row?.size ?? 0) } },
            200,
            cors,
          );
        });
      }

      /** Take a whole batch back into the pool. */
      case "unassign_batch": {
        if (!superAdmin) {
          return json({ error: "Only a super admin assigns work", code: "no_feature" }, 403, cors);
        }
        if (!body.batchId) {
          return json({ error: "batchId is required", code: "bad_input" }, 400, cors);
        }
        return await withConnection(async (conn) => {
          const r = await conn.queryObject<{ released: number }>({
            text: "select data_center.unassign_batch($1, $2, $3) as released",
            args: [body.batchId, body.reason ?? "unassigned by an administrator", userId],
          });
          return json({ data: { released: Number(r.rows[0]?.released ?? 0) } }, 200, cors);
        });
      }

      /** Take one record back, because the complaint is usually about one. */
      case "unassign_item": {
        if (!superAdmin) {
          return json({ error: "Only a super admin assigns work", code: "no_feature" }, 403, cors);
        }
        if (!body.saleId) {
          return json({ error: "saleId is required", code: "bad_input" }, 400, cors);
        }
        return await withConnection(async (conn) => {
          const r = await conn.queryObject<{ batch: string }>({
            text: "select data_center.unassign_item($1, $2)::text as batch",
            args: [body.saleId, userId],
          });
          return json({ data: { batchId: r.rows[0]?.batch ?? null } }, 200, cors);
        });
      }

      default:
        return json({ error: `Unknown action "${body.action}"`, code: "bad_action" }, 400, cors);
    }
  } catch (err) {
    console.error("[data-center-assign] failed", err);
    return json({ error: "Something went wrong on our side", code: "internal" }, 500, cors);
  }
});
