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
// corrections.route, an enabled standing recipient, or somebody who acts for
// Sales (corrections.act_for_sales, by person or by level; D67).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { withConnection, withReadConnection, type PoolClient } from "../_shared/data-center-db.ts";
import { ACT_FOR_SALES_LEVELS_SQL, ROLE_FEATURES, actsForSales, featuresFor } from "../_shared/data-center-roles.ts";
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
      const r = await conn.queryObject<{
        access_role: string | null; keys: string[]; standing: boolean; levels_on: string[];
      }>({
        text: `select m.access_role,
                      ${ACT_FOR_SALES_LEVELS_SQL} as levels_on,
                      coalesce((select array_agg(g.feature_key) from data_center.feature_grants g
                                 where g.user_id = $1), '{}') as keys,
                      exists (select 1 from data_center.send_back_recipients r
                               where r.user_id = $1 and r.is_enabled) as standing
                 from (select $1::uuid as user_id) u
                 left join data_center.module_access m on m.user_id = u.user_id`,
        args: [userId],
      });
      const row = r.rows[0];
      const role = row?.access_role ?? null;
      const features = role ? featuresFor(role, row.keys) : [];
      return {
        role,
        features,
        standing: Boolean(row?.standing),
        // Only with a way into the module: a grant row outlives a revoked level.
        actsForSales: role !== null && actsForSales(role, features, row?.levels_on ?? []),
      };
    });
    if (!superAdmin && access.role === null && !access.standing) {
      return json({ error: "No Data Center access", code: "no_access" }, 403, cors);
    }
    const can = (key: string) => superAdmin || access.features.includes(key);
    // Acting for Sales is a standing recipient's power given by grant (D67).
    const actsForSalesHere = superAdmin || access.actsForSales;
    const canFix = can("corrections.fix") || access.standing || actsForSalesHere;
    const canReview = can("call_records.edit");
    const seesEverything = superAdmin || access.standing || can("corrections.route") || actsForSalesHere;

    const requireAny = (...keys: string[]) =>
      keys.some((k) => can(k)) ||
        (keys.includes("corrections.fix") && (access.standing || actsForSalesHere))
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
      phone?: string | null;
      rep?: string | null;
      partner?: string | null;
      reason?: string | null;
      q?: string | null;
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

    /**
     * Who reviews a fix (D68): every active account whose level or grant
     * carries call_records.edit, which is the key the review action asks for.
     * Nobody is routed a review; the first of them to open it decides. Super
     * admins can review too and are left out of the names, which are for the
     * person sending a fix to know whose list it lands on.
     */
    const reviewersOf = async (conn: PoolClient) => {
      const levels = Object.entries(ROLE_FEATURES)
        .filter(([, keys]) => keys.includes("call_records.edit"))
        .map(([level]) => level);
      const r = await conn.queryObject<{ full_name: string | null }>({
        text: `select p.full_name
                 from data_center.module_access m
                 join public.profiles p on p.id = m.user_id
                where coalesce(p.status, 'active') = 'active'
                  and p.role <> 'super_admin'
                  and (m.access_role = any($1::text[])
                       or exists (select 1 from data_center.feature_grants g
                                   where g.user_id = m.user_id and g.feature_key = 'call_records.edit'))
                order by p.full_name`,
        args: [levels],
      });
      const names = r.rows.map((row) => row.full_name).filter((n): n is string => Boolean(n));
      return { count: names.length, names };
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

        /*
         * Narrowing, in SQL (D67). The rep is the folded ERP name, the same key
         * routing uses; the partner is the name on the record; the reason is
         * the option id; `q` matches the serial, the transaction id, the
         * customer's name and the phone the sale carries.
         */
        const text = (v: unknown, max: number) => {
          const t = typeof v === "string" ? v.trim() : "";
          return t ? t.slice(0, max) : null;
        };
        const repKey = text(body.rep, 120)?.toLowerCase() ?? null;
        const partner = text(body.partner, 200);
        const reasonId = text(body.reason, 40);
        if (reasonId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(reasonId)) {
          return json({ error: "reason must be an option id", code: "bad_input" }, 400, cors);
        }
        const q = text(body.q, 80);

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

          const args: unknown[] = [userId];
          const p = (v: unknown) => {
            args.push(v);
            return `$${args.length}`;
          };
          const narrow: string[] = [];
          if (repKey) narrow.push(`lower(trim(coalesce(c.sales_rep, ''))) = ${p(repKey)}`);
          if (partner) narrow.push(`c.partner_name = ${p(partner)}`);
          if (reasonId) narrow.push(`c.reason_id = ${p(reasonId)}::uuid`);
          if (q) {
            // The searched text is literal: its own % and _ match themselves.
            const like = p(`%${q.replace(/[\\%_]/g, (m) => "\\" + m)}%`);
            narrow.push(`(c.stove_serial_no ilike ${like} or c.transaction_id ilike ${like}
                          or c.end_user_name ilike ${like} or c.phone ilike ${like})`);
          }
          const narrowed = narrow.length ? narrow.join(" and ") : "true";

          const rows = await conn.queryObject({
            text: `select ${ROW_COLUMNS},
                          (c.current_rep_user_id = $1) as is_mine
                     from data_center.v_corrections c
                    where ${stateWhere} and ${visible} and ${narrowed} and c.is_archived is not true
                    order by ${order}, c.sale_id
                    limit ${limit}`,
            args,
          });
          /*
           * What the filters can offer: every rep, partner and reason in this
           * tab and this view, with how many each holds, ignoring the filters
           * themselves so a choice never empties its own list. One pass.
           */
          const facetRows = await conn.queryObject<{
            sales_rep: string | null; partner_name: string | null;
            reason_id: string | null; reason_label: string | null; n: number;
          }>({
            text: `select c.sales_rep, c.partner_name, c.reason_id::text, c.reason_label, count(*)::int as n
                     from data_center.v_corrections c
                    where ${stateWhere} and ${visible} and c.is_archived is not true
                    group by 1, 2, 3, 4`,
            args: mine ? [userId] : [],
          });
          const facet = (key: (r: typeof facetRows.rows[number]) => [string, string] | null) => {
            const m = new Map<string, { key: string; label: string; n: number }>();
            for (const r of facetRows.rows) {
              const k = key(r);
              if (!k) continue;
              const cur = m.get(k[0]) ?? { key: k[0], label: k[1], n: 0 };
              cur.n += r.n;
              m.set(k[0], cur);
            }
            return [...m.values()].sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
          };
          const facets = {
            reps: facet((r) => r.sales_rep?.trim()
              ? [r.sales_rep.trim().toLowerCase(), r.sales_rep.trim()] : null),
            partners: facet((r) => r.partner_name ? [r.partner_name, r.partner_name] : null),
            reasons: facet((r) => r.reason_id ? [r.reason_id, r.reason_label ?? "No reason given"] : null),
          };
          // The parameter is bound only when the predicate names it: a bound
          // value the statement never reads is a protocol error, not a no-op.
          /*
           * The tabs' counts, plus the card above them (D68): how many Sales
           * corrected, and how the closed ones closed. One pass with FILTER.
           */
          const counts = await conn.queryObject<{
            open: number; fixed: number; resolved: number;
            corrected: number; resolved_after_fix: number; withdrawn: number;
          }>({
            text: `select count(*) filter (where c.state = 'open')::int as open,
                          count(*) filter (where c.state = 'fixed')::int as fixed,
                          count(*) filter (where c.state = 'resolved')::int as resolved,
                          count(*) filter (where c.fixed_at is not null)::int as corrected,
                          count(*) filter (where c.state = 'resolved' and c.fixed_at is not null)::int as resolved_after_fix,
                          count(*) filter (where c.state = 'resolved' and c.review_outcome = 'withdrawn')::int as withdrawn
                     from data_center.v_corrections c
                    where ${visible} and c.is_archived is not true`,
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
          const c0 = counts.rows[0];
          const tally = { open: c0?.open ?? 0, fixed: c0?.fixed ?? 0, resolved: c0?.resolved ?? 0 };
          const outcomes = {
            corrected: c0?.corrected ?? 0,
            resolvedAfterFix: c0?.resolved_after_fix ?? 0,
            withdrawn: c0?.withdrawn ?? 0,
          };
          return json({
            data: {
              rows: rows.rows,
              counts: tally,
              outcomes,
              facets,
              tab,
              mine,
              seesEverything,
              actsForSales: actsForSalesHere,
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
          /*
           * The record as the workspace shows it: Table 2's row for the sale,
           * the transfer it came in on, and the last few calls. Served here
           * rather than through stove_detail because that needs records.view,
           * which a sales rep does not hold: the rep sees the one record that
           * came back to them, and nothing else in the register.
           */
          const record = await conn.queryObject({
            text: `select v.sale_id::text, v.transaction_id, v.sales_date::text, v.stove_serial_no,
                          v.end_user_name, v.aka, v.primary_phone, v.alternative_phone,
                          v.buyer_name, v.buyer_phone, v.partner_name, v.retailer_branch,
                          v.user_state, v.user_lga, v.user_residential_address,
                          v.amount, v.total_paid, v.payment_status, v.is_installment,
                          v.sale_status, v.platform, v.created_at::text, v.organization_id::text,
                          v.sales_model, v.sale_agent_name, v.previous_stove_type, v.previous_stove_other,
                          v.pot_quantity, v.heat_retention_device, v.factory, v.stove_stock_status,
                          v.verification_outcome, v.corrected_phone, v.corrected_alt_phone,
                          v.corrected_end_user_name, v.corrected_address, v.corrected_state, v.corrected_lga,
                          v.ward, v.landmark, v.stated_serial, v.other_comments,
                          v.call_outcome, v.call_agent, v.attempt_count, v.last_attempt_at::text,
                          v.correction_state, v.serial_matches, v.phone_was_corrected
                     from data_center.v_call_center v
                    where v.sale_id = $1`,
            args: [saleId],
          });
          const transfer = await conn.queryObject({
            text: `select f.transaction_id, f.partner_name, f.sales_rep, f.transfer_date::text,
                          f.sales_date, f.issued_count, f.digitalised_count, f.verified_count,
                          f.transfer_state, f.transfer_branch
                     from public.sales s
                     join data_center.v_transfer_stoves b on b.stove_id = upper(trim(s.stove_serial_no))
                     join data_center.transfer_funnel f on f.transfer_id = b.transfer_id
                    where s.id = $1
                    limit 1`,
            args: [saleId],
          });
          const attempts = await conn.queryObject({
            text: `select a.attempt_no, a.attempted_at::text, a.note,
                          o.label as outcome, p.full_name as agent
                     from data_center.call_attempts a
                     left join data_center.option_values o on o.id = a.outcome_id
                     left join public.profiles p on p.id = a.agent_id
                    where a.sale_id = $1
                    order by a.attempt_no desc
                    limit 5`,
            args: [saleId],
          });
          /*
           * What the sales app logged on the sale while the newest episode was
           * open. Its trigger tracks a handful of columns and only under a
           * signed-in session, so an empty list is not proof that nothing
           * changed; the episode's own before and after is the diff that
           * counts. This is the supplement, for an edit made somewhere else.
           */
          const history = await conn.queryObject({
            text: `select h.performed_at::text, h.action_type, h.action_description, h.field_changes,
                          p.full_name as performed_by_name
                     from public.sales_history h
                     left join public.profiles p on p.id = h.performed_by
                     join lateral (select c.opened_at, c.reviewed_at
                                     from data_center.corrections c
                                    where c.sale_id = $1
                                    order by c.seq desc limit 1) e on true
                    where h.sale_id = $1
                      and coalesce(h.performed_at, h.created_at) >= e.opened_at
                      and coalesce(h.performed_at, h.created_at) <= coalesce(e.reviewed_at, now())
                    order by coalesce(h.performed_at, h.created_at) desc, h.id desc
                    limit 20`,
            args: [saleId],
          });
          // The number the call centre heard against the one Sales saved.
          const phoneCheck = await conn.queryObject({
            text: `select cr.corrected_phone as heard, s.phone as saved,
                          case when cr.corrected_phone is null then null
                               else data_center.phone_digits_match(cr.corrected_phone, s.phone)
                          end as matches
                     from public.sales s
                     left join data_center.call_records cr on cr.sale_id = s.id
                    where s.id = $1`,
            args: [saleId],
          });
          const reviewers = await reviewersOf(conn);
          const newest = episodes.rows[0] as { state?: string; current_rep_user_id?: string | null } | undefined;
          const routedToMe = Boolean(newest && newest.current_rep_user_id === userId);
          return json({
            data: {
              saleId,
              episodes: episodes.rows,
              sale: sale.rows[0]?.snapshot ?? null,
              record: record.rows[0] ?? null,
              transfer: transfer.rows[0] ?? null,
              attempts: attempts.rows,
              history: history.rows,
              phoneCheck: phoneCheck.rows[0] ?? null,
              catalogue: SALE_FIELDS,
              reasonFields: reasonMap.rows[0]?.value ?? {},
              reviewers,
              can: {
                fix: canFix && newest?.state === "open" && (routedToMe || seesEverything),
                claim: canFix && newest?.state === "open" && (routedToMe || seesEverything),
                review: canReview && newest?.state === "fixed",
                withdraw: canReview && newest?.state !== undefined && newest?.state !== "resolved",
                open: canReview && (!newest || newest.state === "resolved"),
                editSale: canEditSale,
                actForSales: actsForSalesHere,
                /** Routed to the caller's own account, so nobody is acted for. */
                mine: routedToMe,
              },
            },
          }, 200, cors);
        });
      }

      case "work_waiting": {
        const refused = requireAny("corrections.fix", "call_records.view");
        if (refused) return refused;
        return await withReadConnection(async (conn) => {
          const r = await conn.queryObject<{
            mine_open: number; mine_fixed: number; review: number; open_all: number;
            fixed_all: number; unconfirmed: number; unrouted: number;
          }>({
            /*
             * One pass over the corrections, not six over a view (D58).
             *
             * This counted 113 rows and took twelve seconds. It asked
             * `v_corrections` six separate times, twice for the identical
             * count, and that view resolves each correction's transfer through
             * a lateral over `v_transfer_stoves`, which expands every
             * transfer's `stove_ids` JSON into one row per stove: 23,069 rows
             * across 794 transfers, re-expanded once per correction.
             *
             * Measured on production: 12,038 ms as it was, 3,898 ms as it is.
             * It was 65% of the entire database's time, because the control
             * centre polls it every sixty seconds for every manager with the
             * page open, and each run held one of sixty connections for eight
             * seconds while it worked.
             *
             * One change, not two. The six scans become one pass with FILTER,
             * and the rep still comes from `v_corrections`, which is the
             * module's one definition of whose correction this is.
             *
             * The faster route was measured and rejected here on purpose.
             * Reaching the transfer through the sale's own stock row takes
             * this query to 19.5 ms rather than 3,898, and it named the same
             * rep for all 113 corrections on production. It was not taken,
             * because `v_corrections` and `routeFor` both resolve that rep by
             * matching the serial against every transfer's expanded stove
             * list, and a third derivation of the same fact is how the badge
             * and the list come to disagree about who a correction belongs
             * to. This module has already paid for that once: the hardening
             * migration of 2026-09-05 exists because a serial in two
             * transfers doubled an episode. Making the shared definition
             * itself cheaper is worth doing and is its own slice, because ten
             * or more surfaces read that view and they all have to move
             * together.
             *
             * Every number this returns is the same number it returned
             * before. That is the whole contract, and the spec asserts it
             * against the old shape on data that exercises each count.
             */
            text: `with base as (
                     select c.state, c.assigned_to, c.fixed_by,
                            c.current_rep_user_id, c.sales_rep
                       from data_center.v_corrections c
                      where c.is_archived is not true
                        and c.state in ('open', 'fixed')
                   )
                   select
                     count(*) filter (where b.state = 'open'
                       and (b.current_rep_user_id = $1 or b.assigned_to = $1))::int as mine_open,
                     count(*) filter (where b.state = 'fixed' and b.fixed_by = $1)::int as mine_fixed,
                     count(*) filter (where b.state = 'fixed')::int as review,
                     count(*) filter (where b.state = 'open')::int as open_all,
                     count(*) filter (where b.state = 'fixed')::int as fixed_all,
                     count(distinct coalesce(b.sales_rep, '')) filter (where b.state = 'open'
                       and b.current_rep_user_id is null and b.sales_rep is not null)::int as unrouted,
                     (select count(*)::int from data_center.call_records cr
                       join public.sales s2 on s2.id = cr.sale_id
                       where cr.serial_unconfirmed_at is not null and s2.is_archived is not true) as unconfirmed
                     from base b`,
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
              actsForSales: actsForSalesHere,
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
          // The newest episode with its names and labels, so the panel inside
          // the call editor can show who has it and what Sales said without a
          // second read.
          const current = await conn.queryObject({
            text: `select ${ROW_COLUMNS}
                     from data_center.v_corrections c
                    where c.sale_id = $1 and c.is_archived is not true
                    order by c.seq desc
                    limit 1`,
            args: [saleId],
          });
          return json({ data: { route, fields, current: current.rows[0] ?? null } }, 200, cors);
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
        const phone = body.phone === "use_saved" || body.phone === "keep_corrected" ? body.phone : null;
        const episode = await transact((conn) =>
          reviewCorrection(conn, {
            saleId,
            actorId: userId,
            outcome: outcome as "recall" | "no_recall" | "reopen",
            note: body.note ? String(body.note) : null,
            phone,
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
