import { withReadConnection } from "../_shared/data-center-db.ts";

/**
 * The pool by partner and the activity feed (Phase 26, C1).
 *
 * `pool_partners` every partner with work waiting: waiting, new in the recent
 *                 window, oldest sale, who holds an open batch of it, the
 *                 configured batch size. Filtered, sorted, and paged by
 *                 keyset cursor like every list in the module (never an
 *                 offset), even at 59 rows: the rule holds so it cannot creep.
 * `activity`      one row per thing that happened: a call logged, a batch
 *                 handed out or reclaimed, a record sent back, a fix
 *                 reviewed. Filtered, keyset paged, with an hourly histogram over
 *                 the same window. An agent without assignment.manage reads
 *                 only their own rows.
 */

export type FeedContext = {
  action: string;
  body: {
    q?: string | null;
    state?: string | null;
    nobodyOn?: boolean | null;
    sort?: string | null;
    limit?: number | null;
    /** Keyset cursor from the previous page's `nextCursor`; never an offset. */
    cursor?: string | null;
    from?: string | null;
    to?: string | null;
    agentId?: string | null;
    kind?: string | null;
    outcome?: string | null;
    organizationId?: string | null;
  };
  userId: string;
  canManage: boolean;
  cors: Record<string, string>;
  json: (body: unknown, status: number, cors: Record<string, string>) => Response;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STAMP = /^\d{4}-\d{2}-\d{2}(T[\d:.+Z-]*)?$/;
const KINDS = ["call", "handed_out", "reclaimed", "sent_back", "reviewed"] as const;

/** The page size, bounded on the server whatever the caller asked for. */
function limitOf(body: FeedContext["body"], defaultSize: number, maxSize: number) {
  return Math.min(maxSize, Math.max(1, Math.trunc(Number(body.limit) || defaultSize)));
}
/**
 * Keyset cursors travel as base64 JSON of the last row's sort key. Timestamps
 * inside them are the text Postgres produced, never a JavaScript Date: the
 * driver would round microseconds to milliseconds and the next page would
 * skip every row sharing that millisecond.
 */
function encodeCursor(obj: Record<string, unknown>): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(obj))));
}
function decodeCursor<T>(raw: unknown): T | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    return JSON.parse(decodeURIComponent(escape(atob(raw)))) as T;
  } catch {
    return null;
  }
}
function uuidOrNull(v: unknown): string | null {
  return typeof v === "string" && UUID.test(v) ? v : null;
}
function stampOrNull(v: unknown): string | null {
  return typeof v === "string" && STAMP.test(v) ? v : null;
}

const POOL_ROWS_SQL = `
  with cfg as (
    select coalesce((select (value #>> '{}')::int from data_center.workflow_config
                      where key = 'pool.recent_days'), 7) as recent_days,
           coalesce((select (value #>> '{}')::int from data_center.workflow_config
                      where key = 'assignment.batch_size'), 20) as batch_size,
           coalesce((select value from data_center.workflow_config
                      where key = 'assignment.batch_size_by_partner'), '{}'::jsonb) as by_partner
  ),
  pool as (
    select r.organization_id, r.partner_name,
           count(*)::int as waiting,
           count(*) filter (where r.digitised_at >= now() - make_interval(days => cfg.recent_days))::int as new_recent,
           min(r.sales_date) as oldest_sale
      from data_center.v_callable_records r, cfg
     group by r.organization_id, r.partner_name
  ),
  on_it as (
    select b.organization_id, array_agg(distinct coalesce(pr.full_name, pr.email)) as names
      from data_center.assignment_batches b
      join public.profiles pr on pr.id = b.assigned_to
     where b.state = 'open'
     group by b.organization_id
  ),
  rows as (
    select p.organization_id::text as organization_id, p.partner_name, o.state,
           p.waiting, p.new_recent, p.oldest_sale,
           coalesce(x.names, '{}'::text[]) as on_it,
           coalesce((cfg.by_partner ->> p.organization_id::text)::int, cfg.batch_size) as batch_size,
           cfg.recent_days
      from pool p
      cross join cfg
      left join public.organizations o on o.id = p.organization_id
      left join on_it x on x.organization_id = p.organization_id
  )`;

const ACTIVITY_EVENTS_SQL = `
  events as (
    select a.attempted_at as at, 'call'::text as kind, a.created_by as actor_id,
           a.sale_id, null::uuid as batch_id,
           jsonb_build_object('attempt_no', a.attempt_no, 'outcome_value', o.value,
                              'outcome_label', o.label, 'note', a.note) as detail,
           o.value as outcome_value
      from data_center.call_attempts a
      left join data_center.option_values o on o.id = a.outcome_id
    union all
    select b.assigned_at, 'handed_out', b.created_by, null, b.id,
           jsonb_build_object('size', b.size, 'assigned_to', b.assigned_to::text,
                              'assigned_to_name', (select coalesce(full_name, email) from public.profiles where id = b.assigned_to),
                              'override_reason', b.override_reason),
           null
      from data_center.assignment_batches b
    union all
    select b.reclaimed_at, 'reclaimed', b.updated_by, null, b.id,
           jsonb_build_object('size', b.size, 'assigned_to', b.assigned_to::text,
                              'assigned_to_name', (select coalesce(full_name, email) from public.profiles where id = b.assigned_to),
                              'reason', b.reclaim_reason),
           null
      from data_center.assignment_batches b
     where b.reclaimed_at is not null
    union all
    select c.opened_at, 'sent_back', c.opened_by, c.sale_id, null,
           jsonb_build_object('reason', (select label from data_center.option_values where id = c.reason_id),
                              'disputed_fields', c.disputed_fields, 'note', c.note, 'state', c.state),
           null
      from data_center.corrections c
    union all
    select c.reviewed_at, 'reviewed', c.reviewed_by, c.sale_id, null,
           jsonb_build_object('review_outcome', c.review_outcome, 'note', c.review_note),
           null
      from data_center.corrections c
     where c.reviewed_at is not null
  ),
  shaped as (
    select e.at, e.kind, e.actor_id::text as actor_id,
           coalesce(pr.full_name, pr.email, case when e.kind in ('handed_out', 'reclaimed') and e.actor_id is null then 'Engine' end) as actor_name,
           e.sale_id::text as sale_id, s.stove_serial_no, s.end_user_name,
           coalesce(s.partner_name, ob.partner_name) as partner_name,
           coalesce(s.organization_id, b.organization_id)::text as organization_id,
           e.batch_id::text as batch_id, e.detail, e.outcome_value
      from events e
      left join public.profiles pr on pr.id = e.actor_id
      left join data_center.v_sold_stoves s on s.sale_id = e.sale_id
      left join data_center.assignment_batches b on b.id = e.batch_id
      left join public.organizations ob on ob.id = b.organization_id
     where e.at is not null
  ),
  -- The window. A bare date is a call-centre day, whole, in the call centre's
  -- own timezone; a full stamp is taken as sent; nothing means the last week.
  window_ as (
    select case when $1::text ~ '^\\d{4}-\\d{2}-\\d{2}$' then timezone(cfg.tz, ($1::text)::date::timestamp)
                when $1::text is null then now() - interval '7 days'
                else ($1::text)::timestamptz end as from_at,
           case when $2::text ~ '^\\d{4}-\\d{2}-\\d{2}$' then timezone(cfg.tz, (($2::text)::date + 1)::timestamp) - interval '1 microsecond'
                when $2::text is null then now()
                else ($2::text)::timestamptz end as to_at
      from (select coalesce((select value #>> '{}' from data_center.workflow_config
                              where key = 'call_centre.timezone'), 'Africa/Lagos') as tz) cfg
  ),
  filtered as (
    select x.* from shaped x, window_ w
     where x.at >= w.from_at and x.at <= w.to_at
       and ($3::uuid is null or x.actor_id = $3::uuid::text
            or (x.kind in ('handed_out', 'reclaimed') and x.detail ->> 'assigned_to' = $3::uuid::text))
       and ($4::text is null or x.kind = $4::text)
       and ($5::text is null or x.outcome_value = $5::text)
       and ($6::uuid is null or x.organization_id = $6::uuid::text)
       and ($7::text is null or x.stove_serial_no ilike '%' || $7 || '%'
            or x.end_user_name ilike '%' || $7 || '%' or x.actor_name ilike '%' || $7 || '%')
  )`;

export async function handleFeed(ctx: FeedContext): Promise<Response> {
  const { action, body, userId, canManage, cors, json } = ctx;
  const denied = () =>
    json(
      {
        error: "This needs the assignment.manage permission. A super admin can add it " +
          "from Settings, or grant the data manager level.",
        code: "no_feature",
      },
      403,
      cors,
    );

  switch (action) {
    case "pool_partners": {
      if (!canManage) return denied();
      const limit = limitOf(body, 25, 200);
      const q = typeof body.q === "string" && body.q.trim() ? body.q.trim() : null;
      const state = typeof body.state === "string" && body.state.trim() ? body.state.trim() : null;
      const nobodyOn = body.nobodyOn === true;
      // Each sort names its order and the keyset predicate that continues it
      // after the last row seen. The partner id is the final tiebreaker, so
      // two partners with one name and one count still page cleanly. The
      // predicate is written with named slots and numbered here, so the
      // placeholder numbers can never drift from the args list.
      type PoolCursor = { w?: number; n?: number; o?: string | null; p: string; id: string };
      const sorts: Record<string, { order: string; after: string }> = {
        waiting: {
          order: "r.waiting desc, r.partner_name asc, r.organization_id asc",
          after: "(r.waiting < :W or (r.waiting = :W and (r.partner_name, r.organization_id) > (:P, :ID)))",
        },
        new: {
          order: "r.new_recent desc, r.waiting desc, r.partner_name asc, r.organization_id asc",
          after: "(r.new_recent < :N or (r.new_recent = :N and (r.waiting < :W or (r.waiting = :W and (r.partner_name, r.organization_id) > (:P, :ID)))))",
        },
        oldest: {
          order: "r.oldest_sale asc nulls last, r.partner_name asc, r.organization_id asc",
          after: "((r.oldest_sale > :O::date) or (r.oldest_sale is null and :O::date is not null) or (r.oldest_sale is not distinct from :O::date and (r.partner_name, r.organization_id) > (:P, :ID)))",
        },
        name: {
          order: "r.partner_name asc, r.organization_id asc",
          after: "((r.partner_name, r.organization_id) > (:P, :ID))",
        },
      };
      const sortKey = sorts[String(body.sort ?? "waiting")] ? String(body.sort ?? "waiting") : "waiting";
      const sort = sorts[sortKey];
      const cursor = decodeCursor<PoolCursor>(body.cursor);
      const where = [
        "($1::text is null or r.partner_name ilike '%' || $1 || '%')",
        "($2::text is null or r.state = $2)",
        "(not $3::boolean or cardinality(r.on_it) = 0)",
      ];
      const args: unknown[] = [q, state, nobodyOn];
      if (cursor && typeof cursor.p === "string" && typeof cursor.id === "string") {
        const slots: [string, unknown, string][] = [
          [":W", cursor.w ?? 0, "::int"],
          [":N", cursor.n ?? 0, "::int"],
          [":O", cursor.o ?? null, "::text"],
          [":P", cursor.p, "::text"],
          [":ID", cursor.id, "::text"],
        ];
        let sql = sort.after;
        for (const [slot, value, cast] of slots) {
          if (!sql.includes(slot)) continue;
          args.push(value);
          const n = args.length;
          // ":O::date" keeps its date cast; the others take the slot's own.
          sql = sql.split(`${slot}::date`).join(`$${n}::date`).split(slot).join(`$${n}${cast}`);
        }
        where.push(sql);
      }
      return await withReadConnection(async (conn) => {
        const [rows, counted, totals] = await Promise.all([
          conn.queryObject<Record<string, unknown>>({
            text: `${POOL_ROWS_SQL}
              select r.* from rows r
               where ${where.join(" and ")}
               order by ${sort.order}
               limit ${limit + 1}`,
            args,
          }),
          conn.queryObject<{ total: number }>({
            text: `${POOL_ROWS_SQL} select count(*)::int as total from rows r where ${where.slice(0, 3).join(" and ")}`,
            args: args.slice(0, 3),
          }),
          conn.queryObject<{ waiting: number; partners: number; nobody_on: number; new_recent: number; recent_days: number }>({
            text: `${POOL_ROWS_SQL}
              select coalesce(sum(waiting), 0)::int as waiting, count(*)::int as partners,
                     count(*) filter (where cardinality(on_it) = 0)::int as nobody_on,
                     coalesce(sum(new_recent), 0)::int as new_recent,
                     max(recent_days)::int as recent_days
                from rows`,
          }),
        ]);
        const hasMore = rows.rows.length > limit;
        const page = hasMore ? rows.rows.slice(0, limit) : rows.rows;
        const last = page[page.length - 1];
        const nextCursor = hasMore && last
          ? encodeCursor({
            w: Number(last.waiting),
            n: Number(last.new_recent),
            o: last.oldest_sale == null ? null : String(last.oldest_sale).slice(0, 10),
            p: String(last.partner_name),
            id: String(last.organization_id),
          })
          : null;
        return json(
          {
            data: {
              rows: page,
              total: Number(counted.rows[0]?.total ?? 0),
              limit,
              nextCursor,
              sort: sortKey,
              totals: totals.rows[0],
            },
          },
          200,
          cors,
        );
      });
    }

    case "activity": {
      const limit = limitOf(body, 50, 500);
      const from = stampOrNull(body.from);
      const to = stampOrNull(body.to);
      // An editor without the manage permission reads their own trail only.
      const agentId = canManage ? uuidOrNull(body.agentId) : userId;
      const kind = KINDS.includes(body.kind as typeof KINDS[number]) ? String(body.kind) : null;
      const outcome = typeof body.outcome === "string" && body.outcome.trim() ? body.outcome.trim() : null;
      const orgId = uuidOrNull(body.organizationId);
      const q = typeof body.q === "string" && body.q.trim() ? body.q.trim() : null;
      const filterArgs: unknown[] = [from, to, agentId, kind, outcome, orgId, q];
      // Newest first, then kind, then the record or batch the event names. The
      // cursor is the last row's (at, kind, key), with `at` as Postgres text.
      type FeedCursor = { at: string; k: string; key: string };
      const cursor = decodeCursor<FeedCursor>(body.cursor);
      const pageArgs: unknown[] = [...filterArgs];
      let after = "";
      if (cursor && typeof cursor.at === "string") {
        pageArgs.push(cursor.at, cursor.k ?? "", cursor.key ?? "");
        after = `where (f.at < $8::timestamptz
                    or (f.at = $8::timestamptz
                        and (f.kind, coalesce(f.sale_id, f.batch_id, '')) > ($9::text, $10::text)))`;
      }
      pageArgs.push(limit + 1);
      const limitSlot = `$${pageArgs.length}`;
      return await withReadConnection(async (conn) => {
        const [rows, counted, hist, totals] = await Promise.all([
          conn.queryObject<Record<string, unknown>>({
            text: `with ${ACTIVITY_EVENTS_SQL}
              select f.*, f.at::text as at_text from filtered f
               ${after}
               order by f.at desc, f.kind asc, coalesce(f.sale_id, f.batch_id, '') asc
               limit ${limitSlot}`,
            args: pageArgs,
          }),
          conn.queryObject<{ total: number }>({
            text: `with ${ACTIVITY_EVENTS_SQL} select count(*)::int as total from filtered`,
            args: filterArgs,
          }),
          conn.queryObject<Record<string, unknown>>({
            text: `with ${ACTIVITY_EVENTS_SQL}
              select date_trunc('hour', f.at) as bucket,
                     count(*) filter (where f.kind = 'call')::int as calls,
                     count(*) filter (where f.kind = 'call' and f.outcome_value = 'callback_requested')::int as callback,
                     count(*) filter (where f.kind = 'call' and f.outcome_value in ('unreachable', 'phone_unanswered', 'wrong_number', 'customer_hung_up'))::int as unreached,
                     count(*) filter (where f.kind <> 'call')::int as other
                from filtered f
               group by 1
               order by 1`,
            args: filterArgs,
          }),
          conn.queryObject<Record<string, unknown>>({
            text: `with ${ACTIVITY_EVENTS_SQL}
              select count(*) filter (where kind = 'call')::int as calls,
                     count(*) filter (where kind = 'handed_out')::int as handed_out,
                     count(*) filter (where kind = 'reclaimed')::int as reclaimed,
                     count(*) filter (where kind = 'sent_back')::int as sent_back,
                     count(*) filter (where kind = 'reviewed')::int as reviewed,
                     (select count(*)::int from data_center.call_records cr, window_ w
                       where cr.verification_outcome = 'fully_verified'
                         and cr.updated_at >= w.from_at and cr.updated_at <= w.to_at
                         and ($3::uuid is null or cr.updated_by = $3::uuid)) as verified,
                     (select from_at from window_) as from_at,
                     (select to_at from window_) as to_at
                from filtered`,
            args: filterArgs,
          }),
        ]);
        const hasMore = rows.rows.length > limit;
        const page = hasMore ? rows.rows.slice(0, limit) : rows.rows;
        const last = page[page.length - 1];
        const nextCursor = hasMore && last
          ? encodeCursor({
            at: String(last.at_text),
            k: String(last.kind),
            key: String(last.sale_id ?? last.batch_id ?? ""),
          })
          : null;
        return json(
          {
            data: {
              rows: page.map(({ at_text: _t, ...r }) => r),
              total: Number(counted.rows[0]?.total ?? 0),
              limit,
              nextCursor,
              histogram: hist.rows.map((h) => ({
                ...h,
                spoke: Number(h.calls) - Number(h.callback) - Number(h.unreached),
              })),
              totals: totals.rows[0],
              kinds: KINDS,
              scope: canManage ? "all" : "own",
            },
          },
          200,
          cors,
        );
      });
    }

    default:
      return json({ error: "Unknown action", code: "bad_action" }, 400, cors);
  }
}
