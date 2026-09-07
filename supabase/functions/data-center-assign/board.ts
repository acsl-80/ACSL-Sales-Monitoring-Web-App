import { withReadConnection } from "../_shared/data-center-db.ts";
import { AGENT_ROSTER_SQL } from "./agents.ts";

/**
 * The shift board and the agent's day (Phase 26, C1).
 *
 * One row per agent, one day on the axis: every call the agent logged sits on
 * the hour it was made, in its outcome family; a flag where a batch was handed
 * to them or taken back. A call is counted against the login that logged it
 * (D35), never against the registry's agent dropdown.
 *
 * `board`        every agent for one day (or the seven days ending on it)
 * `agent_day`    one agent, the same, plus To call and Called
 * `assign_preview` the rows the picker would hand out, and no batch made
 */

export type BoardContext = {
  action: string;
  body: {
    day?: string | null;
    range?: string | null;
    agentId?: string | null;
    organizationId?: string | null;
    size?: number | null;
    order?: unknown;
  };
  userId: string;
  canManage: boolean;
  cors: Record<string, string>;
  json: (body: unknown, status: number, cors: Record<string, string>) => Response;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The call centre's day, in its own timezone, ending on $1 (or today). */
const DAY_CTE = `
  cfg as (
    select coalesce((select value #>> '{}' from data_center.workflow_config
                      where key = 'call_centre.timezone'), 'Africa/Lagos') as tz
  ),
  day as (
    select coalesce($1::date, timezone(cfg.tz, now())::date) as d, cfg.tz,
           coalesce($1::date, timezone(cfg.tz, now())::date) - $3::int as d_from
      from cfg
  )`;

/** The day the window ends on, and the timezone it was read in. $1 day or null. */
const RESOLVE_DAY_SQL = `
  select coalesce($1::date, timezone(c.tz, now())::date)::text as d, c.tz
    from (select coalesce((select value #>> '{}' from data_center.workflow_config
                            where key = 'call_centre.timezone'), 'Africa/Lagos') as tz) c`;

/**
 * The colour family of a mark is a display rule over the call-outcome value,
 * written once here (D35). A callback is amber, an unreached line is red,
 * everything else means somebody answered.
 */
const FAMILY_SQL = `
  case when o.value = 'callback_requested' then 'callback'
       when o.value in ('unreachable', 'phone_unanswered', 'wrong_number', 'customer_hung_up') then 'unreached'
       else 'spoke' end`;

/** $1 day, $2 agent or null, $3 days back (0 for one day). */
const MARKS_SQL = `with ${DAY_CTE}
  select a.created_by::text as agent_id, a.attempted_at as at, a.sale_id::text as sale_id,
         a.attempt_no, s.stove_serial_no, s.end_user_name, s.partner_name,
         o.value as outcome_value, o.label as outcome_label,
         ${FAMILY_SQL} as family,
         timezone(day.tz, a.attempted_at)::date::text as on_day
    from data_center.call_attempts a
    cross join day
    left join data_center.option_values o on o.id = a.outcome_id
    left join data_center.v_sold_stoves s on s.sale_id = a.sale_id
   where a.created_by is not null
     and timezone(day.tz, a.attempted_at)::date between day.d_from and day.d
     and ($2::uuid is null or a.created_by = $2::uuid)
   order by a.attempted_at`;

const FLAGS_SQL = `with ${DAY_CTE}
  select b.assigned_to::text as agent_id, b.id::text as batch_id, b.size, o.partner_name,
         x.kind, x.at, b.reclaim_reason,
         timezone(day.tz, x.at)::date::text as on_day
    from data_center.assignment_batches b
    cross join day
    join public.organizations o on o.id = b.organization_id
    cross join lateral (values ('handed_out', b.assigned_at), ('reclaimed', b.reclaimed_at)) as x(kind, at)
   where x.at is not null
     and timezone(day.tz, x.at)::date between day.d_from and day.d
     and ($2::uuid is null or b.assigned_to = $2::uuid)
   order by x.at`;

/** Fully verified records saved by the agent inside the window, per day. */
const VERIFIED_SQL = `with ${DAY_CTE}
  select cr.updated_by::text as agent_id, timezone(day.tz, cr.updated_at)::date::text as on_day,
         count(*)::int as verified
    from data_center.call_records cr
    cross join day
   where cr.updated_by is not null
     and cr.verification_outcome = 'fully_verified'
     and timezone(day.tz, cr.updated_at)::date between day.d_from and day.d
     and ($2::uuid is null or cr.updated_by = $2::uuid)
   group by 1, 2`;

const TO_CALL_SQL = `
  select b.id::text as batch_id, b.assigned_at, i.position, i.sale_id::text as sale_id,
         r.stove_serial_no, r.resolved_end_user_name as end_user_name, r.partner_name,
         r.resolved_phone as phone, r.resolved_alt_phone as alt_phone,
         coalesce(r.attempt_count, 0) as attempt_count, r.last_attempt_at,
         r.verification_outcome, r.correction_state,
         (select max(x.reviewed_at) from data_center.corrections x
           where x.sale_id = i.sale_id and x.review_outcome = 'recall') as recall_closed_at,
         (select o.value from data_center.call_attempts a
            left join data_center.option_values o on o.id = a.outcome_id
           where a.sale_id = i.sale_id order by a.attempted_at desc limit 1) as last_outcome_value
    from data_center.assignment_batches b
    join data_center.assignment_items i on i.batch_id = b.id and i.is_active
    join data_center.v_call_center_resolved r on r.sale_id = i.sale_id
   where b.assigned_to = $1::uuid and b.state = 'open'
   order by b.assigned_at, i.position`;

type Mark = {
  agent_id: string; at: Date | string; sale_id: string; attempt_no: number;
  stove_serial_no: string | null; end_user_name: string | null; partner_name: string | null;
  outcome_value: string | null; outcome_label: string | null; family: string; on_day: string;
};
type Flag = {
  agent_id: string; batch_id: string; size: number; partner_name: string | null;
  kind: string; at: Date | string; reclaim_reason: string | null; on_day: string;
};
type Verified = { agent_id: string; on_day: string; verified: number };

function dayArg(raw: unknown): string | null {
  return typeof raw === "string" && DAY.test(raw) ? raw : null;
}
function dayList(endDay: string, back: number): string[] {
  const end = new Date(`${endDay}T00:00:00Z`);
  const out: string[] = [];
  for (let i = back; i >= 0; i--) {
    const d = new Date(end.getTime() - i * 86_400_000);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export async function handleBoard(ctx: BoardContext): Promise<Response> {
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
    case "board": {
      if (!canManage) return denied();
      const back = body.range === "week" ? 6 : 0;
      const day = dayArg(body.day);
      return await withReadConnection(async (conn) => {
        const [roster, marks, flags, verified, resolved] = await Promise.all([
          conn.queryObject<Record<string, unknown>>({ text: AGENT_ROSTER_SQL }),
          conn.queryObject<Mark>({ text: MARKS_SQL, args: [day, null, back] }),
          conn.queryObject<Flag>({ text: FLAGS_SQL, args: [day, null, back] }),
          conn.queryObject<Verified>({ text: VERIFIED_SQL, args: [day, null, back] }),
          conn.queryObject<{ d: string; tz: string }>({ text: RESOLVE_DAY_SQL, args: [day] }),
        ]);
        const d = resolved.rows[0];
        const days = dayList(d.d, back);
        const agents = roster.rows.map((a) => {
          const id = String(a.agent_id);
          const mine = marks.rows.filter((m) => m.agent_id === id);
          const myFlags = flags.rows.filter((f) => f.agent_id === id);
          const myVerified = verified.rows.filter((v) => v.agent_id === id);
          const perDay = days.map((on) => ({
            date: on,
            called: mine.filter((m) => m.on_day === on).length,
            verified: myVerified.find((v) => v.on_day === on)?.verified ?? 0,
          }));
          return {
            agent_id: id,
            full_name: a.full_name,
            email: a.email,
            access_role: a.access_role,
            presence: a.presence,
            is_enabled: a.is_enabled,
            open_batches: a.open_batches,
            max_open_batches: a.max_open_batches,
            to_call: a.records_held,
            current_serial: a.current_serial,
            current_sale_id: a.current_sale_id,
            last_seen_at: a.last_seen_at,
            called: mine.length,
            verified: myVerified.reduce((n, v) => n + v.verified, 0),
            marks: back === 0 ? mine.map(stripAgent) : [],
            flags: myFlags.map(stripAgent),
            days: back === 0 ? undefined : perDay,
          };
        });
        return json(
          {
            data: {
              day: d.d,
              tz: d.tz,
              range: back === 0 ? "day" : "week",
              days,
              agents,
              totals: {
                called: marks.rows.length,
                verified: verified.rows.reduce((n, v) => n + v.verified, 0),
              },
            },
          },
          200,
          cors,
        );
      });
    }

    case "agent_day": {
      const target = body.agentId && UUID.test(body.agentId) ? body.agentId : userId;
      if (target !== userId && !canManage) return denied();
      const back = body.range === "week" ? 6 : 0;
      const day = dayArg(body.day);
      return await withReadConnection(async (conn) => {
        const [roster, marks, flags, verified, toCall, resolved] = await Promise.all([
          conn.queryObject<Record<string, unknown>>({ text: AGENT_ROSTER_SQL }),
          conn.queryObject<Mark>({ text: MARKS_SQL, args: [day, target, back] }),
          conn.queryObject<Flag>({ text: FLAGS_SQL, args: [day, target, back] }),
          conn.queryObject<Verified>({ text: VERIFIED_SQL, args: [day, target, back] }),
          conn.queryObject<Record<string, unknown>>({ text: TO_CALL_SQL, args: [target] }),
          conn.queryObject<{ d: string; tz: string }>({ text: RESOLVE_DAY_SQL, args: [day] }),
        ]);
        const agent = roster.rows.find((a) => String(a.agent_id) === target) ?? null;
        if (!agent && target !== userId) {
          return json({ error: "No such agent", code: "not_found" }, 404, cors);
        }
        const d = resolved.rows[0];
        const days = dayList(d.d, back);
        return json(
          {
            data: {
              agent: agent ?? { agent_id: target },
              day: d.d,
              tz: d.tz,
              range: back === 0 ? "day" : "week",
              called: marks.rows.length,
              verified: verified.rows.reduce((n, v) => n + v.verified, 0),
              marks: marks.rows.map(stripAgent),
              flags: flags.rows.map(stripAgent),
              concluded: marks.rows.map((m) => ({
                at: m.at,
                sale_id: m.sale_id,
                attempt_no: m.attempt_no,
                stove_serial_no: m.stove_serial_no,
                end_user_name: m.end_user_name,
                partner_name: m.partner_name,
                outcome_value: m.outcome_value,
                outcome_label: m.outcome_label,
                family: m.family,
              })),
              to_call: toCall.rows,
              tally: days.map((on) => ({
                date: on,
                called: marks.rows.filter((m) => m.on_day === on).length,
                verified: verified.rows.find((v) => v.on_day === on)?.verified ?? 0,
              })),
            },
          },
          200,
          cors,
        );
      });
    }

    case "assign_preview": {
      if (!canManage) return denied();
      const agentId = body.agentId && UUID.test(body.agentId) ? body.agentId : null;
      const orgId = body.organizationId && UUID.test(body.organizationId) ? body.organizationId : null;
      if (!agentId || !orgId) {
        return json({ error: "agentId and organizationId are required", code: "bad_input" }, 400, cors);
      }
      const order = Array.isArray(body.order) && body.order.length > 0 ? body.order.map(String) : null;
      try {
        return await withReadConnection(async (conn) => {
          const sizing = await conn.queryObject<{
            size: number; waiting: number; recent_days: number;
            open_batches: number; cap: number; is_enabled: boolean;
          }>({
            text: `select coalesce($3::int,
                            (select (value -> $2::text #>> '{}')::int from data_center.workflow_config
                              where key = 'assignment.batch_size_by_partner'),
                            (select (value #>> '{}')::int from data_center.workflow_config
                              where key = 'assignment.batch_size'), 20) as size,
                          (select count(*)::int from data_center.v_callable_records r
                            where r.organization_id = $2::uuid) as waiting,
                          coalesce((select (value #>> '{}')::int from data_center.workflow_config
                                     where key = 'pool.recent_days'), 7) as recent_days,
                          (select count(*)::int from data_center.assignment_batches b
                            where b.assigned_to = $1::uuid and b.state = 'open') as open_batches,
                          coalesce((select max_open_batches from data_center.call_agent_profiles
                                     where user_id = $1::uuid),
                                   (select (value #>> '{}')::int from data_center.workflow_config
                                     where key = 'assignment.max_open_batches'), 1) as cap,
                          coalesce((select is_enabled from data_center.call_agent_profiles
                                     where user_id = $1::uuid), true) as is_enabled`,
            args: [agentId, orgId, body.size ?? null],
          });
          const s = sizing.rows[0];
          const picked = await conn.queryObject<Record<string, unknown>>({
            text: `select p.pos, r.sale_id::text as sale_id, r.stove_serial_no, r.end_user_name,
                          r.primary_phone as phone, r.sales_date, r.attempt_count, r.last_attempt_at,
                          r.recall_due, r.digitised_at,
                          (r.digitised_at >= now() - make_interval(days => $4::int)) as is_recent
                     from data_center.pick_callable($1::uuid, $2::int, $3::text[]) p
                     join data_center.v_callable_records r on r.sale_id = p.sale_id
                    order by p.pos`,
            args: [orgId, s.size, order, s.recent_days],
          });
          return json(
            {
              data: {
                rows: picked.rows,
                size: picked.rows.length,
                requested: s.size,
                waiting: s.waiting,
                waitingAfter: Math.max(0, s.waiting - picked.rows.length),
                recentCount: picked.rows.filter((r) => r.is_recent === true).length,
                recentDays: s.recent_days,
                agent: {
                  open_batches: s.open_batches,
                  cap: s.cap,
                  is_enabled: s.is_enabled,
                  over_capacity: s.open_batches >= s.cap,
                },
              },
            },
            200,
            cors,
          );
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (/hand-out order names/.test(message)) {
          return json({ error: message, code: "bad_order" }, 409, cors);
        }
        throw err;
      }
    }

    default:
      return json({ error: "Unknown action", code: "bad_action" }, 400, cors);
  }
}

function stripAgent<T extends { agent_id: string }>(row: T): Omit<T, "agent_id"> {
  const { agent_id: _drop, ...rest } = row;
  return rest;
}
