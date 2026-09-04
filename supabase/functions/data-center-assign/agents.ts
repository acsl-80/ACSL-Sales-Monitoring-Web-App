// Data Center assignment: the agents.
//
// Who may take work, what each is holding, and the profile that says whether
// they are taking work today and how much. Split from index.ts so the doorway
// stays under the module's size rule; the gate (assignment.manage) is decided
// there and passed in.

import { withConnection, withReadConnection } from "../_shared/data-center-db.ts";

export type AgentsContext = {
  action: string;
  body: {
    agentId?: string;
    isEnabled?: boolean | null;
    maxOpenBatches?: number | null;
    note?: string | null;
  };
  userId: string;
  cors: Record<string, string>;
  json: (body: unknown, status: number, cors: Record<string, string>) => Response;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function handleAgents(ctx: AgentsContext): Promise<Response> {
  const { action, body, userId, cors, json } = ctx;

  switch (action) {
    /**
     * The console's own read: every call agent with what they are holding,
     * and every partner with what is still waiting. Two questions that are
     * always asked together, because assigning is choosing one of each.
     *
     * `defaultCap` rides along so the console can say "3 of 1" for an agent
     * with no profile row, using the same default the engine uses.
     */
    case "agents": {
      return await withReadConnection(async (conn) => {
        const agents = await conn.queryObject({
          text: `select m.user_id::text as agent_id,
                        p.full_name, p.email, p.role as app_role,
                        m.access_role,
                        coalesce(cap.is_enabled, true) as is_enabled,
                        cap.max_open_batches,
                        cap.note,
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
        // One statement for every setting the console needs: the module measured
        // statements per request as the cost worth minimising. The hand-out
        // order rides along, read as absent when the config is not a list.
        const defaults = await conn.queryObject<{
          batch_size: number; default_cap: number; ceiling: number;
          order: string[] | null; options: { value: string; label: string }[] | null;
        }>({
          text: `select coalesce((select (value #>> '{}')::int from data_center.workflow_config
                                   where key = 'assignment.batch_size'), 20) as batch_size,
                        coalesce((select (value #>> '{}')::int from data_center.workflow_config
                                   where key = 'assignment.max_open_batches'), 1) as default_cap,
                        coalesce((select (value #>> '{}')::int from data_center.workflow_config
                                   where key = 'assignment.capacity_ceiling'), 10) as ceiling,
                        (select case when jsonb_typeof(value -> 'order') = 'array'
                                     then array(select jsonb_array_elements_text(value -> 'order')) end
                           from data_center.workflow_config where key = 'assignment.priority') as "order",
                        (select jsonb_agg(jsonb_build_object('value', v.value, 'label', v.label) order by v.sort_order)
                           from data_center.option_values v
                          where v.list_key = 'assignment_priority' and v.is_active) as options`,
        });
        const d = defaults.rows[0];
        const pr = d;
        return json(
          {
            data: {
              agents: agents.rows,
              pool: pool.rows,
              batchSize: Number(d?.batch_size ?? 20),
              defaultCap: Number(d?.default_cap ?? 1),
              capacityCeiling: Number(d?.ceiling ?? 10),
              priority: { order: pr?.order ?? [], options: pr?.options ?? [] },
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
     * Whether an agent is taking work, and how much.
     *
     * Pause, resume, capacity and a note, on the profile row the engine and
     * the manual door both read. Only the keys sent change; a pause keeps the
     * capacity, a capacity change keeps the pause. Capacity is bounded by
     * `assignment.capacity_ceiling`, so a typo cannot hand one person the
     * whole pool. The row's audit trigger records who changed what.
     */
    case "agent_profile_set": {
      const agentId = String(body.agentId ?? "");
      if (!UUID.test(agentId)) {
        return json({ error: "agentId is required", code: "bad_input" }, 400, cors);
      }
      const hasEnabled = body.isEnabled !== undefined && body.isEnabled !== null;
      if (hasEnabled && typeof body.isEnabled !== "boolean") {
        // "false" as a string would read as true and silently resume someone.
        return json({ error: "isEnabled must be true or false", code: "bad_input" }, 400, cors);
      }
      const hasCap = body.maxOpenBatches !== undefined;
      const hasNote = body.note !== undefined;
      if (!hasEnabled && !hasCap && !hasNote) {
        return json({ error: "Nothing to change", code: "bad_input" }, 400, cors);
      }
      return await withConnection(async (conn) => {
        const role = await conn.queryObject<{ access_role: string }>({
          text: `select access_role from data_center.module_access where user_id = $1`,
          args: [agentId],
        });
        const accessRole = role.rows[0]?.access_role;
        if (!accessRole || !["call_agent", "editor"].includes(accessRole)) {
          return json(
            { error: "That person is not a call agent or an editor", code: "not_an_agent" },
            400,
            cors,
          );
        }
        let cap: number | null = null;
        if (hasCap && body.maxOpenBatches !== null) {
          const ceiling = await conn.queryObject<{ n: number }>({
            text: `select coalesce((select (value #>> '{}')::int from data_center.workflow_config
                                     where key = 'assignment.capacity_ceiling'), 10) as n`,
          });
          const max = Number(ceiling.rows[0]?.n ?? 10);
          cap = Number(body.maxOpenBatches);
          if (!Number.isInteger(cap) || cap < 1 || cap > max) {
            return json(
              { error: `Capacity is between 1 and ${max} open batches`, code: "bad_input" },
              400,
              cors,
            );
          }
        }
        const r = await conn.queryObject({
          text: `insert into data_center.call_agent_profiles
                   (user_id, is_enabled, max_open_batches, note,
                    enabled_at, enabled_by, created_by, updated_at, updated_by)
                 values ($1, coalesce($2::boolean, true), $3::int, $4,
                         case when coalesce($2::boolean, true) then now() end,
                         case when coalesce($2::boolean, true) then $5::uuid end,
                         $5, now(), $5)
                 on conflict (user_id) do update set
                   is_enabled = coalesce($2::boolean, data_center.call_agent_profiles.is_enabled),
                   max_open_batches = case when $6::boolean then $3::int
                                           else data_center.call_agent_profiles.max_open_batches end,
                   note = case when $7::boolean then $4 else data_center.call_agent_profiles.note end,
                   enabled_at = case when $2::boolean is true and not data_center.call_agent_profiles.is_enabled
                                     then now() else data_center.call_agent_profiles.enabled_at end,
                   enabled_by = case when $2::boolean is true and not data_center.call_agent_profiles.is_enabled
                                     then $5::uuid else data_center.call_agent_profiles.enabled_by end,
                   updated_at = now(), updated_by = $5
                 returning user_id::text as agent_id, is_enabled, max_open_batches, note`,
          args: [
            agentId,
            hasEnabled ? Boolean(body.isEnabled) : null,
            cap,
            hasNote ? (body.note ?? null) : null,
            userId,
            hasCap,
            hasNote,
          ],
        });
        return json({ data: { profile: r.rows[0] } }, 200, cors);
      });
    }

    default:
      return json({ error: `Unknown action: ${action}`, code: "bad_action" }, 400, cors);
  }
}
