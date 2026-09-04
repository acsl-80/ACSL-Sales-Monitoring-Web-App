// Data Center: corrections, from send-back to closed.
//
// A correction is an episode in data_center.corrections: open (waiting on
// Sales), fixed (awaiting the call centre's review), resolved. The SQL that
// moves it lives in _shared/data-center-corrections-sql.ts, shared with the
// `correction` action on data-center-write, so an episode opens and closes the
// same way whichever door it came through.
//
// Actions:
//
//   list          the episodes the caller may see, by state, with counts.
//   detail        one sale's episodes, the field catalogue, the reason map,
//                 and what the caller may do next.
//   work_waiting  the banner's counts, personal and (for routers) global.
//   route_preview who a send-back for this sale would reach, and which fields
//                 a reason points at. For the send-back panel.
//   open          send a record back to Sales.          call_records.edit
//   withdraw      take it back before Sales touched it.  call_records.edit
//   claim         put my name on an open episode.        corrections.fix + route
//   fix           Sales says it is fixed.                corrections.fix + route
//   review        recall, no_recall or reopen.           call_records.edit
//
// "Route" means the episode is routed to the caller (the rep's account or
// their delegate), or the caller sees everything: a super admin, a holder of
// corrections.route, or an enabled standing recipient.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { withConnection, withReadConnection, type PoolClient } from "../_shared/data-center-db.ts";
import { featuresFor } from "../_shared/data-center-roles.ts";
import { SALE_FIELDS } from "../_shared/sale-fields.ts";
import {
  CorrectionError,
  claimCorrection,
  fieldsForReason,
  fixCorrection,
  newestEpisode,
  openCorrection,
  requireUuid,
  reviewCorrection,
  routeFor,
  withdrawCorrection,
} from "../_shared/data-center-corrections-sql.ts";

const DEFAULT_ORIGINS = [
  "https://sales.atmosfair.com.ng",
  "http://localhost:5173",
  "http://localhost:3000",
  "http://127.0.0.1:5173",
];
const ORIGIN_SUFFIXES = [".vercel.app"];

/** The host roles update-sale accepts. Mirrors ALLOWED in update-sale/index.ts. */
const HOST_ROLES_THAT_EDIT_A_SALE = new Set([
  "super_admin", "acsl_agent_manager", "acsl_agent", "partner", "partner_agent", "admin",
]);

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

const STATES = new Set(["open", "fixed", "resolved", "all"]);

/** The columns every list and detail row carries, from v_corrections. */
const ROW_COLUMNS = `
  c.id::text, c.sale_id::text, c.seq, c.state,
  c.reason_id::text, c.reason_value, c.reason_label, c.disputed_fields, c.note,
  c.opened_at::text, c.opened_by::text, c.opened_by_name,
  c.routed_rep_key, c.routed_rep_user_id::text, c.sales_rep,
  c.current_rep_user_id::text, c.rep_account_name, c.rep_marked_no_account, c.via_delegate,
  c.assigned_to::text, c.assigned_to_name, c.claimed_at::text,
  c.fixed_at::text, c.fixed_by::text, c.fixed_by_name, c.fix_note, c.fixed_on_behalf,
  c.reviewed_at::text, c.reviewed_by::text, c.reviewed_by_name, c.review_note, c.review_outcome,
  c.attempts_at_close, c.reopened_from::text,
  c.stove_serial_no, c.transaction_id, c.organization_id::text, c.partner_name,
  c.transfer_reference, c.end_user_name, c.phone, c.sales_date::text,
  c.verification_outcome, c.attempt_count, c.serial_unconfirmed_at::text`;

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
    const canEditSale = HOST_ROLES_THAT_EDIT_A_SALE.has(String(profile.role));

    // Entry, features and standing, resolved once per request.
    const access = await withReadConnection(async (conn) => {
      const r = await conn.queryObject<{ access_role: string | null; keys: string[]; standing: boolean }>({
        text: `select m.access_role,
                      coalesce((select array_agg(g.feature_key) from data_center.feature_grants g
                                 where g.user_id = $1), '{}') as keys,
                      exists (select 1 from data_center.send_back_recipients r
                               where r.user_id = $1 and r.is_enabled) as standing
                 from (select $1::uuid as user_id) u
                 left join data_center.module_access m on m.user_id = u.user_id`,
        args: [userId],
      });
      const row = r.rows[0];
      return {
        role: row?.access_role ?? null,
        features: row?.access_role ? featuresFor(row.access_role, row.keys) : [],
        standing: Boolean(row?.standing),
      };
    });
    if (!superAdmin && access.role === null && !access.standing) {
      return json({ error: "No Data Center access", code: "no_access" }, 403, cors);
    }
    const can = (key: string) => superAdmin || access.features.includes(key);
    const canFix = can("corrections.fix") || access.standing;
    const canReview = can("call_records.edit");
    const seesEverything = superAdmin || access.standing || can("corrections.route");

    const requireAny = (...keys: string[]) =>
      keys.some((k) => can(k)) || (keys.includes("corrections.fix") && access.standing)
        ? null
        : json({ error: "Not permitted", code: "no_feature" }, 403, cors);

    let body: {
      action?: string;
      saleId?: string;
      tab?: string;
      mine?: boolean;
      limit?: number;
      reasonId?: string | null;
      fields?: unknown;
      note?: string | null;
      outcome?: string;
    } = {};
    try {
      body = await req.json();
    } catch {
      return json({ error: "Body must be JSON", code: "bad_body" }, 400, cors);
    }

    /** Routed to me, or I see everything. Evaluated on the newest episode. */
    const mayTouch = async (conn: PoolClient, saleId: string) => {
      if (seesEverything) return true;
      const r = await conn.queryObject<{ ok: boolean }>({
        text: `select (c.current_rep_user_id = $2 or c.assigned_to = $2 or c.fixed_by = $2) as ok
                 from data_center.v_corrections c
                where c.sale_id = $1
                order by c.seq desc
                limit 1`,
        args: [saleId, userId],
      });
      return Boolean(r.rows[0]?.ok);
    };

    /** One transaction with the actor stamped, so the audit trigger knows who. */
    const transact = async <T>(work: (conn: PoolClient) => Promise<T>): Promise<T> =>
      await withConnection(async (conn) => {
        await conn.queryObject("begin");
        try {
          await conn.queryObject({
            text: "select set_config('data_center.actor', $1, true)",
            args: [userId],
          });
          const out = await work(conn);
          await conn.queryObject("commit");
          return out;
        } catch (err) {
          await conn.queryObject("rollback");
          throw err;
        }
      });

    switch (body.action) {
      case "list": {
        const refused = requireAny("corrections.fix", "call_records.edit");
        if (refused) return refused;
        const tab = STATES.has(String(body.tab)) ? String(body.tab) : "open";
        const mine = body.mine === true || !seesEverything;
        const limit = Math.min(Math.max(Number(body.limit) || 200, 1), 500);

        return await withReadConnection(async (conn) => {
          const visible = mine
            ? `(c.current_rep_user_id = $1 or c.assigned_to = $1 or c.fixed_by = $1)`
            : `true`;
          const stateWhere = tab === "all" ? "true" : `c.state = '${tab}'`;
          const order = tab === "fixed"
            ? "c.fixed_at desc"
            : tab === "resolved"
            ? "c.reviewed_at desc"
            : "c.opened_at desc";

          const rows = await conn.queryObject({
            text: `select ${ROW_COLUMNS},
                          (c.current_rep_user_id = $1) as is_mine
                     from data_center.v_corrections c
                    where ${stateWhere} and ${visible} and c.is_archived is not true
                    order by ${order}
                    limit ${limit}`,
            args: [userId],
          });
          // The parameter is bound only when the predicate names it: a bound
          // value the statement never reads is a protocol error, not a no-op.
          const counts = await conn.queryObject<{ state: string; n: number }>({
            text: `select c.state, count(*)::int as n
                     from data_center.v_corrections c
                    where ${visible} and c.is_archived is not true
                    group by c.state`,
            args: mine ? [userId] : [],
          });
          const unrouted = seesEverything
            ? await conn.queryObject({
              text: `select coalesce(c.sales_rep, '(no rep on the transfer)') as sales_rep,
                            count(*)::int as waiting
                       from data_center.v_corrections c
                      where c.state = 'open' and c.current_rep_user_id is null
                      group by 1 order by 2 desc limit 50`,
            })
            : { rows: [] };
          const tally: Record<string, number> = { open: 0, fixed: 0, resolved: 0 };
          for (const row of counts.rows) tally[row.state] = row.n;
          return json({
            data: {
              rows: rows.rows,
              counts: tally,
              tab,
              mine,
              seesEverything,
              canReview,
              canFix,
              canEditSale,
              unrouted: unrouted.rows,
            },
          }, 200, cors);
        });
      }

      case "detail": {
        const refused = requireAny("corrections.fix", "call_records.edit");
        if (refused) return refused;
        const saleId = requireUuid(body.saleId, "saleId");
        return await withReadConnection(async (conn) => {
          if (!(await mayTouch(conn, saleId)) && !canReview) {
            return json({ error: "Not routed to you", code: "not_routed" }, 403, cors);
          }
          const episodes = await conn.queryObject({
            text: `select ${ROW_COLUMNS}, c.before, c.after
                     from data_center.v_corrections c
                    where c.sale_id = $1
                    order by c.seq desc`,
            args: [saleId],
          });
          const reasonMap = await conn.queryObject<{ value: unknown }>({
            text: `select value from data_center.workflow_config where key = 'corrections.reason_fields'`,
          });
          const sale = await conn.queryObject<{ snapshot: unknown }>({
            text: `select data_center.sale_snapshot($1) as snapshot`,
            args: [saleId],
          });
          const newest = episodes.rows[0] as { state?: string; current_rep_user_id?: string | null } | undefined;
          const routedToMe = Boolean(newest && newest.current_rep_user_id === userId);
          return json({
            data: {
              saleId,
              episodes: episodes.rows,
              sale: sale.rows[0]?.snapshot ?? null,
              catalogue: SALE_FIELDS,
              reasonFields: reasonMap.rows[0]?.value ?? {},
              can: {
                fix: canFix && newest?.state === "open" && (routedToMe || seesEverything),
                claim: canFix && newest?.state === "open" && (routedToMe || seesEverything),
                review: canReview && newest?.state === "fixed",
                withdraw: canReview && newest?.state !== undefined && newest?.state !== "resolved",
                open: canReview && (!newest || newest.state === "resolved"),
                editSale: canEditSale,
              },
            },
          }, 200, cors);
        });
      }

      case "work_waiting": {
        return await withReadConnection(async (conn) => {
          const r = await conn.queryObject<{
            mine_open: number; mine_fixed: number; review: number; open_all: number;
            fixed_all: number; unconfirmed: number; unrouted: number;
          }>({
            text: `select
                     (select count(*)::int from data_center.v_corrections c
                       where c.state = 'open' and c.is_archived is not true
                         and (c.current_rep_user_id = $1 or c.assigned_to = $1)) as mine_open,
                     (select count(*)::int from data_center.v_corrections c
                       where c.state = 'fixed' and c.fixed_by = $1) as mine_fixed,
                     (select count(*)::int from data_center.v_corrections c
                       where c.state = 'fixed' and c.is_archived is not true) as review,
                     (select count(*)::int from data_center.v_corrections c
                       where c.state = 'open' and c.is_archived is not true) as open_all,
                     (select count(*)::int from data_center.v_corrections c
                       where c.state = 'fixed' and c.is_archived is not true) as fixed_all,
                     (select count(*)::int from data_center.call_records cr
                       join public.sales s on s.id = cr.sale_id
                       where cr.serial_unconfirmed_at is not null and s.is_archived is not true) as unconfirmed,
                     (select count(distinct coalesce(c.sales_rep, ''))::int from data_center.v_corrections c
                       where c.state = 'open' and c.current_rep_user_id is null) as unrouted`,
            args: [userId],
          });
          const row = r.rows[0];
          return json({
            data: {
              mineOpen: row.mine_open,
              mineFixed: row.mine_fixed,
              review: canReview ? row.review : null,
              openAll: seesEverything ? row.open_all : null,
              fixedAll: seesEverything ? row.fixed_all : null,
              unconfirmed: can("call_records.view") ? row.unconfirmed : null,
              unroutedReps: seesEverything ? row.unrouted : null,
              canFix,
              canReview,
              seesEverything,
            },
          }, 200, cors);
        });
      }

      case "route_preview": {
        const refused = requireAny("call_records.edit");
        if (refused) return refused;
        const saleId = requireUuid(body.saleId, "saleId");
        return await withReadConnection(async (conn) => {
          const route = await routeFor(conn, saleId);
          const fields = await fieldsForReason(conn, body.reasonId ? String(body.reasonId) : null);
          const current = await newestEpisode(conn, saleId);
          return json({ data: { route, fields, current } }, 200, cors);
        });
      }

      case "open": {
        const refused = requireAny("call_records.edit");
        if (refused) return refused;
        const saleId = requireUuid(body.saleId, "saleId");
        const episode = await transact((conn) =>
          openCorrection(conn, {
            saleId,
            actorId: userId,
            reasonId: body.reasonId ? String(body.reasonId) : null,
            fields: body.fields,
            note: body.note ? String(body.note) : null,
          })
        );
        return json({ data: { episode } }, 200, cors);
      }

      case "withdraw": {
        const refused = requireAny("call_records.edit");
        if (refused) return refused;
        const saleId = requireUuid(body.saleId, "saleId");
        const episode = await transact((conn) =>
          withdrawCorrection(conn, { saleId, actorId: userId, note: body.note ? String(body.note) : null })
        );
        return json({ data: { episode } }, 200, cors);
      }

      case "claim": {
        const refused = requireAny("corrections.fix");
        if (refused) return refused;
        const saleId = requireUuid(body.saleId, "saleId");
        const episode = await transact(async (conn) => {
          if (!(await mayTouch(conn, saleId))) {
            throw new CorrectionError("This record is not routed to you.", 403, "not_routed");
          }
          return await claimCorrection(conn, saleId, userId);
        });
        return json({ data: { episode } }, 200, cors);
      }

      case "fix": {
        const refused = requireAny("corrections.fix");
        if (refused) return refused;
        const saleId = requireUuid(body.saleId, "saleId");
        const episode = await transact(async (conn) => {
          if (!(await mayTouch(conn, saleId))) {
            throw new CorrectionError("This record is not routed to you.", 403, "not_routed");
          }
          // Fixing for a rep who has no account of their own is said on the record.
          const route = await routeFor(conn, saleId);
          const onBehalf = route.rep_user_id && route.rep_user_id === userId
            ? null
            : route.sales_rep ?? null;
          return await fixCorrection(conn, {
            saleId,
            actorId: userId,
            note: body.note ? String(body.note) : null,
            onBehalf,
          });
        });
        return json({ data: { episode } }, 200, cors);
      }

      case "review": {
        const refused = requireAny("call_records.edit");
        if (refused) return refused;
        const saleId = requireUuid(body.saleId, "saleId");
        const outcome = String(body.outcome ?? "");
        if (!["recall", "no_recall", "reopen"].includes(outcome)) {
          return json({ error: "outcome must be recall, no_recall or reopen", code: "bad_input" }, 400, cors);
        }
        const episode = await transact((conn) =>
          reviewCorrection(conn, {
            saleId,
            actorId: userId,
            outcome: outcome as "recall" | "no_recall" | "reopen",
            note: body.note ? String(body.note) : null,
          })
        );
        return json({ data: { episode } }, 200, cors);
      }

      default:
        return json({ error: `Unknown action: ${body.action}`, code: "bad_action" }, 400, cors);
    }
  } catch (err) {
    if (err instanceof CorrectionError) {
      return json({ error: err.message, code: err.code }, err.status, cors);
    }
    console.error("data-center-corrections failed", err);
    return json({ error: "Something went wrong", code: "internal" }, 500, cors);
  }
});
