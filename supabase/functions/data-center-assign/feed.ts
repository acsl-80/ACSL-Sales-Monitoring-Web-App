import { withReadConnection } from "../_shared/data-center-db.ts";

/**
 * The pool by partner and the activity feed (Phase 26, C1).
 *
 * `pool_partners` every partner with work waiting: waiting, new in the recent
 *                 window, oldest sale, who holds an open batch of it, the
 *                 configured batch size. Filtered, sorted, paged by offset,
 *                 because the list is 59 rows long and a manager reads it as
 *                 pages, not as a scroll.
 * `activity`      one row per thing that happened: a call logged, a batch
 *                 handed out or reclaimed, a record sent back, a fix
 *                 reviewed. Filtered, paged, with an hourly histogram over
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
    page?: number | null;
    pageSize?: number | null;
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

function paging(body: FeedContext["body"], defaultSize: number, maxSize: number) {
  const pageSize = Math.min(maxSize, Math.max(1, Math.trunc(Number(body.pageSize) || defaultSize)));
  const page = Math.max(1, Math.trunc(Number(body.page) || 1));
  return { page, pageSize, offset: (page - 1) * pageSize };
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
  window_ as (
    select coalesce($1::timestamptz, now() - interval '7 days') as from_at,
           coalesce($2::timestamptz, now()) as to_at
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
      const { page, pageSize, offset } = paging(body, 25, 200);
      const q = typeof body.q === "string" && body.q.trim() ? body.q.trim() : null;
      const state = typeof body.state === "string" && body.state.trim() ? body.state.trim() : null;
      const nobodyOn = body.nobodyOn === true;
      const sortSql = ({
        waiting: "waiting desc, partner_name",
        new: "new_recent desc, waiting desc, partner_name",
        oldest: "oldest_sale asc nulls last, partner_name",
        name: "partner_name",
      } as Record<string, string>)[String(body.sort ?? "waiting")] ?? "waiting desc, partner_name";
      return await withReadConnection(async (conn) => {
        // The total is its own statement: a window count rides on the rows that
        // come back, and a page past the end has none, which would read as zero.
        const POOL_WHERE = `where ($1::text is null or r.partner_name ilike '%' || $1 || '%')
                 and ($2::text is null or r.state = $2)
                 and (not $3::boolean or cardinality(r.on_it) = 0)`;
        const [rows, counted, totals] = await Promise.all([
          conn.queryObject<Record<string, unknown>>({
            text: `${POOL_ROWS_SQL}
              select r.* from rows r
               ${POOL_WHERE}
               order by ${sortSql}
               limit $4 offset $5`,
            args: [q, state, nobodyOn, pageSize, offset],
          }),
          conn.queryObject<{ total: number }>({
            text: `${POOL_ROWS_SQL} select count(*)::int as total from rows r ${POOL_WHERE}`,
            args: [q, state, nobodyOn],
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
        return json(
          {
            data: {
              rows: rows.rows,
              total: Number(counted.rows[0]?.total ?? 0),
              page,
              pageSize,
              totals: totals.rows[0],
            },
          },
          200,
          cors,
        );
      });
    }

    case "activity": {
      const { page, pageSize, offset } = paging(body, 50, 500);
      const from = stampOrNull(body.from);
      const to = stampOrNull(body.to);
      // An editor without the manage permission reads their own trail only.
      const agentId = canManage ? uuidOrNull(body.agentId) : userId;
      const kind = KINDS.includes(body.kind as typeof KINDS[number]) ? String(body.kind) : null;
      const outcome = typeof body.outcome === "string" && body.outcome.trim() ? body.outcome.trim() : null;
      const orgId = uuidOrNull(body.organizationId);
      const q = typeof body.q === "string" && body.q.trim() ? body.q.trim() : null;
      const args = [from, to, agentId, kind, outcome, orgId, q];
      return await withReadConnection(async (conn) => {
        const [rows, counted, hist, totals] = await Promise.all([
          conn.queryObject<Record<string, unknown>>({
            text: `with ${ACTIVITY_EVENTS_SQL}
              select f.* from filtered f
               order by f.at desc
               limit $8 offset $9`,
            args: [...args, pageSize, offset],
          }),
          // Its own statement, for the same reason as the partner list's total.
          conn.queryObject<{ total: number }>({
            text: `with ${ACTIVITY_EVENTS_SQL} select count(*)::int as total from filtered`,
            args,
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
            args,
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
            args,
          }),
        ]);
        return json(
          {
            data: {
              rows: rows.rows,
              total: Number(counted.rows[0]?.total ?? 0),
              page,
              pageSize,
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
