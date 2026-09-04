-- ===========================================================================
-- Phase 24, slice 5a: the engine can hand out work, to whoever may manage it.
--
-- 1. assign_batches picked its agents from call_agent_profiles with an inner
--    join to module_access. No profile row had ever been written in
--    production, so the engine found nobody and every batch was handed out by
--    hand, five agents ending up three batches over a capacity of one. The
--    agents read and the staleness sweep already treated a missing row as
--    "enabled, default capacity"; the engine now does the same.
-- 2. assign_batch_manual refuses a paused agent, and refuses to hand out more
--    than the agent's capacity unless a reason is given. The reason lands on
--    the batch (`override_reason`), so the log says why.
-- 3. `assignment.capacity_ceiling` bounds what a per-agent capacity may be set
--    to from the app.
--
-- No backfill: the five agents over capacity stay as they are, shown as
-- "3 of 1" on the console for a supervisor to reclaim or reassign. The notice
-- at the end says how many stand over.
--
-- Rollback: the two functions are replaced whole and the previous versions
-- live in 20260821040000 and 20260821070000; the column and the config key are
-- additive and may stay.
-- ===========================================================================

alter table data_center.assignment_batches
  add column if not exists override_reason text;

comment on column data_center.assignment_batches.override_reason is
  'Why a supervisor handed this batch to an agent already at capacity. Null for the engine and for any batch within capacity.';

insert into data_center.workflow_config (key, value, description) values
  ('assignment.capacity_ceiling', '10'::jsonb,
   'The most open batches a per-agent capacity may be set to from the app.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- The engine, replaced whole; only the agent selection changed.
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
       group by r.organization_id
       order by count(*) desc, r.organization_id
       limit 1;
    end if;

    exit when chosen_org is null;

    want := coalesce((per_partner ->> chosen_org::text)::int, default_size);

    insert into data_center.assignment_batches (organization_id, assigned_to, size)
    values (chosen_org, chosen_agent, want)
    returning id into new_batch;

    -- Oldest first. A record that has waited longest is the one whose buyer is
    -- least likely to remember the purchase, so it is the one worth ringing
    -- soonest.
    with picked as (
      select r.sale_id, row_number() over (order by r.sales_date, r.sale_id) as pos
        from data_center.v_callable_records r
       where r.organization_id = chosen_org
       order by r.sales_date, r.sale_id
       limit want
    )
    insert into data_center.assignment_items (batch_id, sale_id, position)
    select new_batch, picked.sale_id, picked.pos from picked;

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
-- The manual door. Dropped and recreated rather than overloaded: a second
-- signature beside the old one would make every four-argument call ambiguous.
-- ---------------------------------------------------------------------------

drop function if exists data_center.assign_batch_manual(uuid, uuid, integer, uuid);

create or replace function data_center.assign_batch_manual(
  p_agent uuid,
  p_org uuid,
  p_size integer default null,
  p_actor uuid default null,
  p_override_reason text default null
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
  cap int := coalesce(
    (select p.max_open_batches from data_center.call_agent_profiles p where p.user_id = p_agent),
    (select (value #>> '{}')::int from data_center.workflow_config
      where key = 'assignment.max_open_batches'),
    1);
  open_now int := (select count(*) from data_center.assignment_batches b
                    where b.assigned_to = p_agent and b.state = 'open');
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

  -- Paused is paused, by hand as much as by engine. Somebody on leave who
  -- keeps their access must not come back to forty records.
  if exists (
    select 1 from data_center.call_agent_profiles p
     where p.user_id = p_agent and not p.is_enabled
  ) then
    raise exception 'That agent is not taking work right now. Resume them first.'
      using errcode = 'check_violation', hint = 'paused';
  end if;

  -- Capacity is a refusal with a door in it, not a wall. The engine never
  -- goes over; a supervisor may, with a reason that lands on the batch so
  -- the log says why this agent holds three against a limit of one.
  if open_now >= cap and nullif(trim(coalesce(p_override_reason, '')), '') is null then
    raise exception 'This agent already holds % open % against a capacity of %. Give a reason to hand out more.',
      open_now, case when open_now = 1 then 'batch' else 'batches' end, cap
      using errcode = 'check_violation', hint = 'over_capacity';
  end if;

  -- The same lock the engine takes. Without it a manual assign and a scheduled
  -- run can both read the pool, both pick the same records, and one of them
  -- loses on the unique index halfway through inserting a batch.
  if not pg_try_advisory_lock(8150621) then
    raise exception 'Work is being handed out right now, try again in a moment'
      using errcode = 'lock_not_available';
  end if;

  insert into data_center.assignment_batches
    (organization_id, assigned_to, size, created_by, override_reason)
  values (p_org, p_agent, want, p_actor,
          case when open_now >= cap then nullif(trim(p_override_reason), '') end)
  returning id into new_batch;

  -- Oldest first, exactly as the engine does it: a record that has waited
  -- longest is the one whose buyer is least likely to remember the purchase.
  with picked as (
    select r.sale_id, row_number() over (order by r.sales_date, r.sale_id) as pos
      from data_center.v_callable_records r
     where r.organization_id = p_org
     order by r.sales_date, r.sale_id
     limit want
  )
  insert into data_center.assignment_items (batch_id, sale_id, position)
  select new_batch, picked.sale_id, picked.pos from picked;

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

comment on function data_center.assign_batch_manual(uuid, uuid, integer, uuid, text) is
  'A supervisor hands one partner''s records to one agent. Refuses a paused agent; refuses more than the agent''s capacity unless a reason is given, which lands on the batch. Same tables, triggers and lock as the engine.';

-- ---------------------------------------------------------------------------
-- What the migration found, for the person applying it.
-- ---------------------------------------------------------------------------

do $$
declare
  over int;
  default_cap int := coalesce(
    (select (value #>> '{}')::int from data_center.workflow_config
      where key = 'assignment.max_open_batches'), 1);
begin
  select count(*) into over
    from (
      select b.assigned_to, count(*) as open_now,
             coalesce(max(p.max_open_batches), default_cap) as cap
        from data_center.assignment_batches b
        left join data_center.call_agent_profiles p on p.user_id = b.assigned_to
       where b.state = 'open'
       group by b.assigned_to
    ) x
   where x.open_now > x.cap;
  raise notice 'assignment: % agent(s) stand over capacity; nothing was changed for them', over;
end $$;
