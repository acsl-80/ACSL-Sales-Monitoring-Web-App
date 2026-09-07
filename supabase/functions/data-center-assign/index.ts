// Data Center: handing out call centre work.
//
// The engine itself is data_center.assign_batches(), in SQL, holding an
// advisory lock. This function is its doorway and nothing more: it decides who
// may pull the lever, not how the machine works, for the same reason the
// metrics live in compute_metrics() rather than in TypeScript. "Who got what
// and why" must have one answer, in one file, and that file is the migration.
//
// The actions:
//
//   run          assign work now. Admin only: it changes who is working what.
//   reclaim      take back quiet batches. Admin only, and `run` does it first
//                anyway, so this exists for the "someone left today" case.
//   status       the queue at a glance: callable per partner, open batches.
//   my_batches   an agent's own work list. The one action agents call.
//   agents, agent_detail, agent_profile_set, assign_manual, reassign,
//   unassign_batch, unassign_item: the manual door (agents.ts and below).
//   board, agent_day, assign_preview (board.ts) and pool_partners, activity
//   (feed.ts): the Phase 26 reads behind the shift board and My calls.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { withConnection, withReadConnection } from "../_shared/data-center-db.ts";
import { featuresFor } from "../_shared/data-center-roles.ts";
import { handleAgents } from "./agents.ts";
import { handleBoard } from "./board.ts";
import { handleFeed } from "./feed.ts";

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

/**
 * A refusal raised by a SQL function, told to the caller as what it is.
 * The manual door raises check_violation with a hint naming the rule
 * (paused, over_capacity); the lock raises lock_not_available. Neither is
 * a 500, and the console needs the code to offer the right next step.
 */
function pgRefusal(err: unknown): { error: string; code: string } | null {
  const f = (err as { fields?: { code?: string; message?: string; hint?: string } })?.fields;
  if (!f?.code) return null;
  if (f.code === "23514") {
    const code = f.hint === "over_capacity"
      ? "over_capacity"
      : f.hint === "paused"
      ? "paused"
      : f.hint === "bad_order"
      ? "bad_order"
      : "refused";
    return { error: f.message ?? "Refused", code };
  }
  if (f.code === "55P03") return { error: f.message ?? "Work is being handed out right now", code: "busy" };
  return null;
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

    /**
     * Handing work out is a permission, not a job title.
     *
     * It was super-admin-only, which put "reassign Hanifa's queue, she is on
     * leave" on the same shoulder as running the company's user accounts. A
     * data manager holds `assignment.manage` and a super admin still passes by
     * short-circuit, so nothing that worked before stops working.
     */
    const requireAssignment = () =>
      can("assignment.manage")
        ? null
        : json(
          {
            error:
              "This needs the assignment.manage permission. A super admin can add it " +
              "from Settings, or grant the data manager level.",
            code: "no_feature",
          },
          403,
          cors,
        );

    let body: {
      action?: string;
      agentId?: string;
      organizationId?: string;
      size?: number;
      batchId?: string;
      saleId?: string;
      reason?: string;
      /** Why a supervisor is handing out more than the agent's capacity. */
      overrideReason?: string | null;
      isEnabled?: boolean | null;
      maxOpenBatches?: number | null;
      note?: string | null;
      /** Hand-out order tokens for a manual batch; the picker refuses any it does not know. */
      order?: unknown;
      // Phase 26 reads: the board's day and range, the feed's filters and paging.
      day?: string | null;
      range?: string | null;
      page?: number | null;
      pageSize?: number | null;
      q?: string | null;
      state?: string | null;
      nobodyOn?: boolean | null;
      sort?: string | null;
      from?: string | null;
      to?: string | null;
      kind?: string | null;
      outcome?: string | null;
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
        {
          const denied = requireAssignment();
          if (denied) return denied;
        }
        try {
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
        } catch (err) {
          // A hand-out order the picker does not know is a refusal that names
          // the setting, not a failure.
          const refusal = pgRefusal(err);
          if (refusal) return json(refusal, 409, cors);
          throw err;
        }
      }

      /** Take back quiet batches without assigning anything new. */
      case "reclaim": {
        {
          const denied = requireAssignment();
          if (denied) return denied;
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
            /**
             * Enough to make the call, not just to count it.
             *
             * This returned positions and serials, which is a queue an agent
             * cannot work: no name to greet, no number to dial, and no sign of
             * the one record that needs ringing before all the others - a
             * buyer whose stove ID another caller took.
             *
             * The name and number come resolved, so a correction typed on an
             * earlier call is what the next agent reads rather than the value
             * off the receipt.
             */
            text: `select l.batch_id::text, l.partner_name, l.assigned_at, l.batch_size,
                          l.batch_state, b.completed_at,
                          l.sale_id::text, l.position, l.stove_serial_no, l.sales_date,
                          l.verification_outcome, l.attempt_count, l.last_attempt_at,
                          v.resolved_end_user_name as end_user_name,
                          v.resolved_phone as phone,
                          v.resolved_alt_phone as alternative_phone,
                          v.resolved_state as user_state,
                          v.resolved_lga as user_lga,
                          v.correction_state,
                          /*
                           * When the call centre last closed a fix on this
                           * record with "ring again". Newer than the last
                           * attempt means Sales fixed it and nobody has rung
                           * since: the first thing on the list.
                           */
                          (select max(x.reviewed_at) from data_center.corrections x
                            where x.sale_id = l.sale_id and x.review_outcome = 'recall') as recall_closed_at,
                          cr.serial_unconfirmed_at,
                          /*
                           * Whether somebody stopped part way through this one.
                           *
                           * The agent's first question at the start of a shift
                           * is what to ring next, and a form they already got
                           * four answers into outranks a stove nobody has
                           * touched: the buyer has already given their time
                           * once. So it comes back with the queue rather than
                           * being a second request the dashboard makes.
                           */
                          (d.sale_id is not null) as has_draft,
                          d.saved_at as draft_saved_at,
                          dp.full_name as draft_saved_by_name,
                          (d.saved_by = $1) as draft_is_mine
                     from data_center.v_assignment_log l
                     join data_center.assignment_batches b on b.id = l.batch_id
                     left join data_center.v_call_center_resolved v on v.sale_id = l.sale_id
                     left join data_center.call_records cr on cr.sale_id = l.sale_id
                     left join data_center.call_drafts d on d.sale_id = l.sale_id
                     left join public.profiles dp on dp.id = d.saved_by
                    /*
                     * Open work, and work finished in the last week. A batch
                     * now closes itself when its last record is concluded, so
                     * "finished" is a real state an agent can see rather than
                     * a list that never shrinks.
                     */
                    where l.agent_id = $1 and l.is_active
                      and (l.batch_state = 'open'
                           or (l.batch_state = 'completed'
                               and b.completed_at > now() - interval '7 days'))
                    order by (l.batch_state = 'open') desc, l.assigned_at desc, l.position
                    limit 200`,
            args: [userId],
          });
          const cfg = await conn.queryObject<{ n: number }>({
            text: `select coalesce((select (value #>> '{}')::int from data_center.workflow_config
                                     where key = 'call_centre.refresh_seconds'), 60) as n`,
          });
          return json({ data: { items: r.rows, refreshSeconds: Number(cfg.rows[0]?.n ?? 60) } }, 200, cors);
        });
      }

      /**
       * The agents: who may take work, what they hold, and their profile
       * (taking work or paused, capacity, a note). In agents.ts; the gate
       * is decided here.
       */
      case "agents":
      case "agent_detail":
      case "agent_profile_set": {
        {
          const denied = requireAssignment();
          if (denied) return denied;
        }
        return await handleAgents({ action: body.action, body, userId, cors, json });
      }
      // Phase 26: the shift board, the agent's day and the hand-out preview.
      // The gate lives inside: an agent may read their own day; the rest is
      // assignment.manage.
      case "board":
      case "agent_day":
      case "assign_preview": {
        return await handleBoard({
          action: body.action,
          body: body as Parameters<typeof handleBoard>[0]["body"],
          userId,
          canManage: can("assignment.manage"),
          cors,
          json,
        });
      }
      // Phase 26: the pool by partner and the activity feed. An agent without
      // the manage permission reads only their own activity.
      case "pool_partners":
      case "activity": {
        return await handleFeed({
          action: body.action,
          body: body as Parameters<typeof handleFeed>[0]["body"],
          userId,
          canManage: can("assignment.manage"),
          cors,
          json,
        });
      }

      /**
       * Hand one partner's records to one agent, on a supervisor's say-so.
       *
       * The size cap and the "is this person an agent" check live in the SQL
       * function, not here, so the rule holds for anything that ever calls it.
       */
      case "assign_manual": {
        {
          const denied = requireAssignment();
          if (denied) return denied;
        }
        if (!body.agentId || !body.organizationId) {
          return json(
            { error: "agentId and organizationId are required", code: "bad_input" },
            400,
            cors,
          );
        }
        try {
          return await withConnection(async (conn) => {
            const r = await conn.queryObject<{ batch_id: string | null; size: number }>({
              text: `select batch_id::text, size
                       from data_center.assign_batch_manual($1, $2, $3, $4, $5, $6)`,
              args: [
                body.agentId,
                body.organizationId,
                body.size ?? null,
                userId,
                body.overrideReason ?? null,
                Array.isArray(body.order) && body.order.length > 0 ? body.order.map(String) : null,
              ],
            });
            const row = r.rows[0];
            return json(
              { data: { batchId: row?.batch_id ?? null, size: Number(row?.size ?? 0) } },
              200,
              cors,
            );
          });
        } catch (err) {
          // A paused agent or one at capacity is a refusal, not a failure.
          const refusal = pgRefusal(err);
          if (refusal) return json(refusal, 409, cors);
          throw err;
        }
      }

      /**
       * Move work from one agent to another, without it touching the pool.
       *
       * Unassign-then-assign looks equivalent and is not: between the two the
       * records are back in the pool, where the engine's next run can hand
       * them to somebody else entirely. A supervisor moving one agent's queue
       * to a colleague who is covering for them means those records, to that
       * person.
       *
       * It takes either a whole batch or a list of records, because the
       * complaint arrives both ways: "cover for her today" and "this one is
       * her cousin, give it to somebody else".
       *
       * The receiving agent's batch is per partner, which is the assignment
       * engine's own invariant - an agent's queue never mixes partners, so a
       * move has to land in a batch of the right partner or make one.
       */
      case "reassign": {
        {
          const denied = requireAssignment();
          if (denied) return denied;
        }
        const toAgent = String(body.toAgentId ?? "");
        const batchId = body.batchId ? String(body.batchId) : null;
        const saleIds = Array.isArray(body.saleIds) ? body.saleIds.map(String) : [];
        if (!toAgent) {
          return json({ error: "toAgentId is required", code: "bad_input" }, 400, cors);
        }
        if (!batchId && saleIds.length === 0) {
          return json(
            { error: "Give a batchId or a list of saleIds", code: "bad_input" },
            400,
            cors,
          );
        }

        return await withConnection(async (conn) => {
          await conn.queryObject("begin");
          try {
            await conn.queryObject({
              text: "select set_config('data_center.actor', $1, true)",
              args: [userId],
            });

            // The same lock the engine takes. Moving work and handing work out
            // are the same act from the queue's point of view, and running
            // both at once is how one record ends up in two places.
            const got = await conn.queryObject<{ locked: boolean }>(
              "select pg_try_advisory_xact_lock(8150621) as locked",
            );
            if (!got.rows[0]?.locked) {
              await conn.queryObject("rollback");
              return json(
                {
                  error: "The assignment engine is running. Try again in a moment.",
                  code: "busy",
                },
                409,
                cors,
              );
            }

            // Everything being moved, with the partner it belongs to, because
            // that decides which batch it can land in.
            const moving = await conn.queryObject<
              { item_id: string; sale_id: string; organization_id: string; batch_id: string }
            >({
              text: `select ai.id::text as item_id, ai.sale_id::text,
                            ab.organization_id::text, ab.id::text as batch_id
                       from data_center.assignment_items ai
                       join data_center.assignment_batches ab on ab.id = ai.batch_id
                      where ai.is_active and ab.state = 'open'
                        and ($1::uuid is null or ab.id = $1::uuid)
                        and ($2::uuid[] is null or ai.sale_id = any($2::uuid[]))
                      for update`,
              args: [batchId, saleIds.length > 0 ? saleIds : null],
            });

            if (moving.rows.length === 0) {
              await conn.queryObject("rollback");
              return json(
                {
                  error: "Nothing there to move. It may already have been reassigned or completed.",
                  code: "nothing_to_move",
                },
                404,
                cors,
              );
            }

            // The receiving agent must be one who may take work: an agent, not
            // paused, within capacity unless a reason is given (D22). The same
            // SQL rule the manual door applies, read under the same lock.
            let overCapacity = false;
            try {
              const room = await conn.queryObject<{ open_now: number; cap: number }>({
                text: `select a.open_now, a.cap from data_center.assert_agent_can_receive($1, $2) a`,
                args: [toAgent, body.overrideReason ?? null],
              });
              const r0 = room.rows[0];
              overCapacity = Number(r0?.open_now ?? 0) >= Number(r0?.cap ?? 1);
            } catch (err) {
              const refusal = pgRefusal(err);
              if (refusal) {
                await conn.queryObject("rollback");
                return json(refusal, 409, cors);
              }
              throw err;
            }

            // One destination batch per partner, reused across the whole move
            // so a supervisor covering a shift does not leave the receiving
            // agent with a batch of one for every record.
            const byPartner = new Map<string, string[]>();
            for (const item of moving.rows) {
              if (!byPartner.has(item.organization_id)) byPartner.set(item.organization_id, []);
              byPartner.get(item.organization_id)!.push(item.item_id);
            }

            let moved = 0;
            const destinations: string[] = [];
            for (const [org, itemIds] of byPartner) {
              const made = await conn.queryObject<{ id: string }>({
                text: `insert into data_center.assignment_batches
                         (organization_id, assigned_to, size, state, created_by, updated_by, override_reason)
                       values ($1, $2, $3, 'open', $4, $4, $5)
                       returning id::text`,
                args: [org, toAgent, itemIds.length, userId, overCapacity ? (body.overrideReason ?? null) : null],
              });
              const target = made.rows[0].id;
              destinations.push(target);
              const done = await conn.queryObject({
                text: `update data_center.assignment_items
                          set batch_id = $1
                        where id = any($2::uuid[])`,
                args: [target, itemIds],
              });
              moved += Number(done.rowCount ?? itemIds.length);
            }

            /**
             * A batch left with nothing in it is closed, not left open.
             *
             * An empty open batch counts towards its agent's capacity and
             * shows on the console as work they are holding, which is exactly
             * what a reassignment was meant to take off them.
             */
            const emptied = await conn.queryObject<{ id: string }>({
              text: `update data_center.assignment_batches ab
                        set state = 'completed', completed_at = now(),
                            updated_by = $1, updated_at = now()
                      where ab.state = 'open'
                        and not exists (
                          select 1 from data_center.assignment_items ai
                           where ai.batch_id = ab.id and ai.is_active
                        )
                      returning ab.id::text`,
              args: [userId],
            });

            await conn.queryObject("commit");
            return json(
              {
                data: {
                  moved,
                  toAgentId: toAgent,
                  batches: destinations,
                  closedEmpty: emptied.rows.length,
                },
              },
              200,
              cors,
            );
          } catch (err) {
            await conn.queryObject("rollback");
            throw err;
          }
        });
      }

      /** Take a whole batch back into the pool. */
      case "unassign_batch": {
        {
          const denied = requireAssignment();
          if (denied) return denied;
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
        {
          const denied = requireAssignment();
          if (denied) return denied;
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
