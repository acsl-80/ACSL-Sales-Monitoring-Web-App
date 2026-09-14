-- ===========================================================================
-- Phase 24, slice 5b: the pool knows what is callable, and in what order.
--
-- 1. v_callable_records leaves out what nobody should ring today: a record
--    with Sales (an open or fixed correction episode), a record somebody is
--    half-way through (a draft saved within assignment.draft_holds_hours), and
--    a record rung within callback.recall_after_days, unless a "ring again"
--    close is newer than that attempt. It gains digitised_at (when the sale
--    was recorded, which for a paper receipt is when it was typed) and
--    recall_due. Columns appended, none changed.
-- 2. One picker, data_center.pick_callable, used by the engine and by the
--    manual door. The order is assignment.priority (a default order and
--    per-partner overrides), each token mapped through a fixed case to a
--    whitelisted fragment; anything else raises. The tokens are an option
--    list, so their labels are data.
-- 3. Unconfirmed shared phones stay in the pool: the call is how a suspicion
--    becomes a fact.
--
-- No index on public.sales for this: within one partner the callable set is
-- hundreds of rows, and the sort of that set is not where time goes at 500,000
-- (the partner filter already has idx_sales_org_date_id). Recorded in D23.
--
-- Rollback: the previous view and doors live in 20260907010000 and
-- 20260907020000; pick_callable, the config keys and the option list are
-- additive and may stay.
-- ===========================================================================

insert into data_center.workflow_config (key, value, description) values
  ('assignment.draft_holds_hours', '48'::jsonb,
   'A record with a call draft saved within this many hours stays out of the pool: somebody is half-way through it.'),
  ('callback.recall_after_days', '2'::jsonb,
   'A record rung within this many days waits before it is offered again, unless a ring-again close is newer than the attempt.'),
  ('assignment.priority',
   '{"order": ["recall_due", "newest_digitised", "oldest_sale"], "by_partner": {}}'::jsonb,
   'The order the picker hands records out in: a list of tokens from the assignment_priority list, and per-partner overrides keyed by organisation id.')
on conflict (key) do nothing;

insert into data_center.option_lists (key, label, description) values
  ('assignment_priority', 'Hand-out order', 'How the picker orders a partner''s callable records')
on conflict (key) do nothing;

insert into data_center.option_values (list_key, value, label, sort_order) values
  ('assignment_priority', 'recall_due',       'Ring-again first',            1),
  ('assignment_priority', 'newest_digitised', 'Newest digitised first',      2),
  ('assignment_priority', 'oldest_sale',      'Oldest sale first',           3),
  ('assignment_priority', 'newest_sale',      'Newest sale first',           4)
on conflict (list_key, value) do nothing;

-- ---------------------------------------------------------------------------
-- The pool, v3.
-- ---------------------------------------------------------------------------

create or replace view data_center.v_callable_records as
select
  c.sale_id,
  c.organization_id,
  c.partner_name,
  c.sales_date,
  c.stove_serial_no,
  c.end_user_name,
  c.primary_phone,
  coalesce(c.attempt_count, 0) as attempt_count,
  c.last_attempt_at,
  rc.reviewed_at as recall_closed_at,
  coalesce(rc.attempts_at_close, 0) as attempts_before_recall,
  c.created_at as digitised_at,
  (rc.reviewed_at is not null
     and (c.last_attempt_at is null or rc.reviewed_at > c.last_attempt_at)) as recall_due
from data_center.v_call_center c
left join lateral (
  select x.reviewed_at, x.attempts_at_close
    from data_center.corrections x
   where x.sale_id = c.sale_id
     and x.state = 'resolved'
     and x.review_outcome = 'recall'
   order by x.seq desc
   limit 1
) rc on true
where c.is_archived is not true
  and (c.verification_outcome is null or c.verification_outcome = 'not_verified')
  -- Attempts since the last "ring again" close, against the same limit.
  and coalesce(c.attempt_count, 0) - coalesce(rc.attempts_at_close, 0)
      < coalesce((select (value #>> '{}')::int
                    from data_center.workflow_config
                   where key = 'callback_limit'), 3)
  -- Not with Sales. An open or fixed episode keeps the record out until the
  -- call centre closes it; a supervisor cannot hand out what Sales is fixing.
  and coalesce(c.correction_state, 'none') not in ('open', 'fixed')
  -- Not half-typed. A draft saved recently is somebody's work in progress.
  and not exists (
    select 1 from data_center.call_drafts d
     where d.sale_id = c.sale_id
       and d.saved_at > now() - make_interval(hours =>
             coalesce((select (value #>> '{}')::int from data_center.workflow_config
                        where key = 'assignment.draft_holds_hours'), 48))
  )
  -- Not just rung, unless "ring again" is newer than the attempt.
  and (
    c.last_attempt_at is null
    or rc.reviewed_at > c.last_attempt_at
    or c.last_attempt_at < now() - make_interval(days =>
         coalesce((select (value #>> '{}')::int from data_center.workflow_config
                    where key = 'callback.recall_after_days'), 2))
  )
  -- Not already someone's work. `is_active` rather than the batch state, so
  -- one index answers it: see the partial unique index on assignment_items.
  and not exists (
    select 1 from data_center.assignment_items i
     where i.sale_id = c.sale_id and i.is_active
  );

comment on view data_center.v_callable_records is
  'Records still needing a call: nothing concluded, attempts left since the last ring-again close, not with Sales, not half-typed, not rung in the last days unless ring-again is newer, not already assigned. The one definition of outstanding work.';

-- ---------------------------------------------------------------------------
-- The picker.
-- ---------------------------------------------------------------------------

create or replace function data_center.pick_callable(
  p_org uuid,
  p_limit integer,
  p_order text[] default null
)
returns table (sale_id uuid, pos integer)
language plpgsql
stable
security definer
set search_path = data_center, public, pg_temp
as $$
declare
  cfg jsonb := coalesce(
    (select value from data_center.workflow_config where key = 'assignment.priority'),
    '{}'::jsonb);
  tokens text[];
  tok text;
  frag text;
  frags text[] := '{}';
  order_sql text;
begin
  -- The caller's order, else the partner's override, else the default.
  -- A value of the wrong shape (a string where a list belongs) is read as
  -- absent rather than raising inside the engine.
  tokens := coalesce(
    nullif(p_order, '{}'::text[]),
    case when jsonb_typeof(cfg -> 'by_partner' -> p_org::text) = 'array'
         then nullif(array(select jsonb_array_elements_text(cfg -> 'by_partner' -> p_org::text)), '{}'::text[]) end,
    case when jsonb_typeof(cfg -> 'order') = 'array'
         then nullif(array(select jsonb_array_elements_text(cfg -> 'order')), '{}'::text[]) end,
    array['oldest_sale']);

  -- Each token maps through a fixed case to a whitelisted fragment. Anything
  -- else raises: the configuration names an order, it never writes SQL. The
  -- same discipline completeness_predicate() uses.
  foreach tok in array tokens loop
    frag := case tok
      when 'recall_due'       then 'r.recall_due desc'
      when 'newest_digitised' then 'r.digitised_at desc nulls last'
      when 'oldest_sale'      then 'r.sales_date asc nulls last'
      when 'newest_sale'      then 'r.sales_date desc nulls last'
      else null
    end;
    if frag is null then
      raise exception 'The hand-out order names %, which the picker does not know. An administrator can correct assignment.priority in Settings.', tok
        using errcode = 'check_violation', hint = 'bad_order';
    end if;
    frags := frags || frag;
  end loop;
  order_sql := coalesce(nullif(array_to_string(frags, ', '), '') || ', ', '') || 'r.sale_id';

  return query execute format(
    'select r.sale_id, (row_number() over (order by %s))::int as pos
       from data_center.v_callable_records r
      where r.organization_id = $1
      order by %s
      limit $2',
    order_sql, order_sql)
  using p_org, p_limit;
end;
$$;

comment on function data_center.pick_callable(uuid, integer, text[]) is
  'The next records to hand out for one partner, in the configured order (assignment.priority, overridable per call). The one picker behind the engine and the manual door.';

-- ---------------------------------------------------------------------------
-- The engine, replaced whole; only the pick changed.
-- ---------------------------------------------------------------------------

create or replace function data_center.assign_batches(p_max_batches integer default 50)
returns table (batch_id uuid, agent_id uuid, organization_id uuid, size integer)
language plpgsql
security definer
set search_path = data_center, public, pg_temp
as $$
declare
  default_size int := coalesce(
    (select (value #>> '{}')::int from data_center.workflow_config
      where key = 'assignment.batch_size'), 20);
  default_cap int := coalesce(
    (select (value #>> '{}')::int from data_center.workflow_config
      where key = 'assignment.max_open_batches'), 1);
  per_partner jsonb := coalesce(
    (select value from data_center.workflow_config
      where key = 'assignment.batch_size_by_partner'), '{}'::jsonb);

  chosen_agent uuid;
  chosen_org uuid;
  want int;
  made int := 0;
  new_batch uuid;
  taken int;
begin
  if not pg_try_advisory_lock(8150621) then
    -- Another run holds it. Returning nothing is right: the work is being
    -- handed out by that run, and queueing behind it would just do it twice.
    return;
  end if;

  loop
    exit when made >= p_max_batches;

    -- The agent with the fewest open batches who is still under capacity.
    -- Ties break on who has waited longest, so work spreads rather than
    -- landing on whoever sorts first.
    select a.user_id into chosen_agent
      from (
        select m.user_id,
               coalesce(p.max_open_batches, default_cap) as cap,
               (select count(*) from data_center.assignment_batches b
                 where b.assigned_to = m.user_id and b.state = 'open') as open_now,
               (select max(b.assigned_at) from data_center.assignment_batches b
                 where b.assigned_to = m.user_id) as last_given
          -- Everyone who may take work, whether or not a profile row exists:
          -- the rule the agents read and the staleness sweep already use.
          -- An inner join here left the engine with nobody to pick when no
          -- profile had ever been written, which is how every batch in
          -- production came to be handed out by hand.
          from data_center.module_access m
          left join data_center.call_agent_profiles p on p.user_id = m.user_id
         where coalesce(p.is_enabled, true)
           and m.access_role in ('call_agent', 'editor')
      ) a
     where a.open_now < a.cap
     order by a.open_now, a.last_given nulls first
     limit 1;

    exit when chosen_agent is null;

    -- Finish a partner before starting another. Their last batch's partner
    -- wins if it still has callable records; otherwise the partner with the
    -- most outstanding, because that is where the backlog is.
    select coalesce(
      (select b.organization_id
         from data_center.assignment_batches b
        where b.assigned_to = chosen_agent
        order by b.assigned_at desc
        limit 1
        ),
      null) into chosen_org;

    if chosen_org is null
       or not exists (select 1 from data_center.v_callable_records r
                       where r.organization_id = chosen_org) then
      select r.organization_id into chosen_org
        from data_center.v_callable_records r
       where r.organization_id is not null
       group by r.organization_id
       order by count(*) desc, r.organization_id
       limit 1;
    end if;

    exit when chosen_org is null;

    want := coalesce((per_partner ->> chosen_org::text)::int, default_size);

    insert into data_center.assignment_batches (organization_id, assigned_to, size)
    values (chosen_org, chosen_agent, want)
    returning id into new_batch;

    -- One picker, two doors. The order comes from assignment.priority, so
    -- "ring-again first, then the newest digitised, then the oldest sale"
    -- is configuration, and the manual door picks the same way.
    insert into data_center.assignment_items (batch_id, sale_id, position)
    select new_batch, p.sale_id, p.pos
      from data_center.pick_callable(chosen_org, want) p;

    get diagnostics taken = row_count;

    if taken = 0 then
      -- The partner emptied between the two statements. Nothing to hand over,
      -- so take the empty batch back out rather than leaving an agent holding
      -- a batch of nothing.
      delete from data_center.assignment_batches where id = new_batch;
      exit;
    end if;

    -- What was actually handed over, which can be short of `want` when the
    -- partner is nearly exhausted.
    update data_center.assignment_batches set size = taken where id = new_batch;

    batch_id := new_batch;
    agent_id := chosen_agent;
    organization_id := chosen_org;
    size := taken;
    return next;

    made := made + 1;
  end loop;

  perform pg_advisory_unlock(8150621);
end;
$$;

-- ---------------------------------------------------------------------------
-- The manual door, dropped and recreated with the order as a sixth argument.
-- ---------------------------------------------------------------------------

drop function if exists data_center.assign_batch_manual(uuid, uuid, integer, uuid, text);

create or replace function data_center.assign_batch_manual(
  p_agent uuid,
  p_org uuid,
  p_size integer default null,
  p_actor uuid default null,
  p_override_reason text default null,
  p_order text[] default null
)
returns table (batch_id uuid, size integer)
language plpgsql
security definer
set search_path = data_center, public, pg_temp
as $$
declare
  want int := coalesce(
    p_size,
    (select (value #>> '{}')::int from data_center.workflow_config
      where key = 'assignment.batch_size'),
    20);
  new_batch uuid;
  taken int;
  cap int;
  open_now int;
begin
  if want < 1 or want > 500 then
    raise exception 'A batch is between 1 and 500 records, not %', want
      using errcode = 'check_violation';
  end if;

  -- The agent has to be an agent. Assigning call work to someone who cannot
  -- open the call centre produces a queue nobody can see, which looks like the
  -- assignment silently failed.
  if not exists (
    select 1 from data_center.module_access m
     where m.user_id = p_agent and m.access_role in ('call_agent', 'editor')
  ) then
    raise exception 'That person is not a call agent or an editor'
      using errcode = 'check_violation';
  end if;

  -- The same lock the engine takes. Without it a manual assign and a scheduled
  -- run can both read the pool, both pick the same records, and one of them
  -- loses on the unique index halfway through inserting a batch.
  if not pg_try_advisory_lock(8150621) then
    raise exception 'Work is being handed out right now, try again in a moment'
      using errcode = 'lock_not_available';
  end if;

  -- The rules, read under the lock so two hands cannot both pass a capacity
  -- of one. A refusal releases the lock before it is raised.
  begin
    select a.open_now, a.cap into open_now, cap
      from data_center.assert_agent_can_receive(p_agent, p_override_reason) a;
  exception when others then
    perform pg_advisory_unlock(8150621);
    raise;
  end;

  insert into data_center.assignment_batches
    (organization_id, assigned_to, size, created_by, override_reason)
  values (p_org, p_agent, want, p_actor,
          case when open_now >= cap then nullif(trim(p_override_reason), '') end)
  returning id into new_batch;

  -- The same picker the engine uses; the supervisor may name the order
  -- ("newest first" for a partner whose records just landed), else the
  -- configured one applies.
  insert into data_center.assignment_items (batch_id, sale_id, position)
  select new_batch, p.sale_id, p.pos
    from data_center.pick_callable(p_org, want, p_order) p;

  get diagnostics taken = row_count;

  if taken = 0 then
    delete from data_center.assignment_batches where id = new_batch;
    perform pg_advisory_unlock(8150621);
    batch_id := null;
    size := 0;
    return next;
    return;
  end if;

  update data_center.assignment_batches set size = taken where id = new_batch;
  perform pg_advisory_unlock(8150621);

  batch_id := new_batch;
  size := taken;
  return next;
end;
$$;

comment on function data_center.assign_batch_manual(uuid, uuid, integer, uuid, text, text[]) is
  'A supervisor hands one partner''s records to one agent, in the configured order or the one named. Refuses a paused agent; refuses more than the agent''s capacity unless a reason is given, which lands on the batch. Same tables, triggers and lock as the engine.';
