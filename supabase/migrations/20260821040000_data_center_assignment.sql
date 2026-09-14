-- Phase 11: handing work to call agents, in batches, without a dispatcher.
--
-- Today every agent keeps a spreadsheet and somebody aggregates them by hand.
-- The aggregation is not the problem: the problem is that nobody can say who
-- is working what, so two people ring the same buyer and a partner's records
-- sit untouched because everyone assumed someone else had them.
--
-- Four rules, all of them somebody's stated requirement:
--
--   Batches, never a trickle.   Twenty records at a time, so an agent has a
--                               morning's work rather than a queue that refills
--                               under them.
--   One partner per batch.      A queue that mixes partners means relearning
--                               the context every call.
--   Finish a partner first.     An agent stays with a partner while it has
--                               records left, then moves on.
--   Nobody dispatches.          The cycle runs itself.


-- ===========================================================================
-- 1. A batch
--
-- `size` is what was handed out, recorded rather than counted, because the
-- configured batch size can change and a batch should still be able to say
-- what it was when it was made.
-- ===========================================================================

create table if not exists data_center.assignment_batches (
  id uuid primary key default gen_random_uuid(),

  -- One partner, always. The engine builds a batch from one organization and
  -- the trigger below refuses an item from any other, so this is an
  -- invariant rather than an intention.
  organization_id uuid not null references public.organizations (id) on delete restrict,

  assigned_to uuid not null references auth.users (id) on delete restrict,
  assigned_at timestamptz not null default now(),
  size integer not null check (size > 0),

  state text not null default 'open'
    check (state in ('open', 'completed', 'reclaimed')),

  -- Touched, meaning an attempt was logged or a record saved against one of
  -- its items. Staleness is measured from here, not from assigned_at: an agent
  -- working steadily through a large batch has not gone quiet.
  last_activity_at timestamptz not null default now(),

  completed_at timestamptz,
  reclaimed_at timestamptz,
  reclaim_reason text,

  created_by uuid,
  updated_at timestamptz,
  updated_by uuid
);

comment on table data_center.assignment_batches is
  'Twenty records of one partner, handed to one agent. Reclaimed if it goes quiet or the agent stops taking work.';

-- The engine's own question, asked every run: who holds how many open batches.
create index if not exists assignment_batches_open_idx
  on data_center.assignment_batches (assigned_to) where state = 'open';

-- The staleness sweep, and the "what is this partner's work like" question.
create index if not exists assignment_batches_activity_idx
  on data_center.assignment_batches (last_activity_at) where state = 'open';

create index if not exists assignment_batches_org_idx
  on data_center.assignment_batches (organization_id, assigned_at desc);


-- ===========================================================================
-- 2. The records in it
--
-- `is_active` is what stops a record being in two batches at once, and it is a
-- column rather than a join to the batch state because the constraint has to
-- be an index, and an index cannot read another table.
--
-- Reclaiming a batch clears it, which is the whole point: those records go
-- back into the pool. Completing a batch does not, because they were called.
-- ===========================================================================

create table if not exists data_center.assignment_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references data_center.assignment_batches (id) on delete cascade,
  sale_id uuid not null references public.sales (id) on delete cascade,

  -- The order they were handed over in. An agent working top to bottom is
  -- working the oldest records first, which is what the ordering encodes.
  position integer not null check (position > 0),

  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- One active assignment per sale. This is the constraint that makes "two
-- agents ringing the same buyer" impossible rather than unlikely.
create unique index if not exists assignment_items_one_active_idx
  on data_center.assignment_items (sale_id) where is_active;

create index if not exists assignment_items_batch_idx
  on data_center.assignment_items (batch_id, position);


-- ===========================================================================
-- 3. What still needs a call
--
-- The pool the engine draws from, defined once so the engine and the UI
-- cannot disagree about how much work is left. It comes after the tables
-- because it reads assignment_items to exclude what is already someone's work.
--
-- A record is callable when nobody has concluded anything about it and it has
-- not used up its attempts. `unreachable` is a conclusion, not a gap: it means
-- the attempts ran out, which is exactly why the record stops appearing here.
-- ===========================================================================

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
  c.last_attempt_at
from data_center.v_call_center c
where c.is_archived is not true
  and (c.verification_outcome is null or c.verification_outcome = 'not_verified')
  and coalesce(c.attempt_count, 0)
      < coalesce((select (value #>> '{}')::int
                    from data_center.workflow_config
                   where key = 'callback_limit'), 3)
  -- Not already someone's work. `is_active` rather than the batch state, so
  -- one index answers it: see the partial unique index below.
  and not exists (
    select 1 from data_center.assignment_items i
     where i.sale_id = c.sale_id and i.is_active
  );

comment on view data_center.v_callable_records is
  'Records still needing a call: nothing concluded, attempts left, not already assigned. The one definition of outstanding work.';


-- ===========================================================================
-- 4. The invariants, as triggers
--
-- Both of these could be left to the engine. Neither is, because the engine is
-- not the only thing that will ever write here: a correction, a support fix, a
-- future feature. A rule enforced in one function is a rule until someone
-- writes a second function.
-- ===========================================================================

create or replace function data_center.assignment_item_same_partner()
returns trigger
language plpgsql
as $$
declare
  batch_org uuid;
  sale_org uuid;
begin
  select organization_id into batch_org
    from data_center.assignment_batches where id = new.batch_id;
  select organization_id into sale_org
    from public.sales where id = new.sale_id;

  if batch_org is distinct from sale_org then
    raise exception
      'Batch % belongs to partner %, so it cannot hold sale % from partner %',
      new.batch_id, batch_org, new.sale_id, sale_org
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists assignment_items_same_partner on data_center.assignment_items;
create trigger assignment_items_same_partner
  before insert or update of batch_id, sale_id on data_center.assignment_items
  for each row execute function data_center.assignment_item_same_partner();


-- A reclaimed batch releases its records; nothing else does.
create or replace function data_center.assignment_batch_state_change()
returns trigger
language plpgsql
as $$
begin
  if new.state = 'reclaimed' and old.state is distinct from 'reclaimed' then
    update data_center.assignment_items
       set is_active = false
     where batch_id = new.id and is_active;
  end if;
  return new;
end;
$$;

drop trigger if exists assignment_batches_state_change on data_center.assignment_batches;
create trigger assignment_batches_state_change
  after update of state on data_center.assignment_batches
  for each row execute function data_center.assignment_batch_state_change();


alter table data_center.assignment_batches enable row level security;
alter table data_center.assignment_items enable row level security;
revoke all on data_center.assignment_batches from anon, authenticated;
revoke all on data_center.assignment_items from anon, authenticated;

drop trigger if exists audit_assignment_batches on data_center.assignment_batches;
create trigger audit_assignment_batches
  after insert or delete or update on data_center.assignment_batches
  for each row execute function data_center.log_change('id');


-- ===========================================================================
-- 5. Reclaiming
--
-- Defined before the engine because the engine calls it first: there is no
-- point handing out new work while an agent who left last week still holds
-- forty records nobody can reach.
--
-- Two reasons a batch comes back. It went quiet, or the agent stopped taking
-- work. The second is not a special case of the first: someone can be marked
-- unavailable ten minutes after being given a batch.
-- ===========================================================================

create or replace function data_center.reclaim_stale_batches()
returns integer
language plpgsql
security definer
set search_path = data_center, public, pg_temp
as $$
declare
  stale_days int := coalesce(
    (select (value #>> '{}')::int from data_center.workflow_config
      where key = 'assignment.stale_after_days'), 3);
  reclaimed int;
begin
  with gone as (
    select b.id,
           case
             when not coalesce(p.is_enabled, true) then 'agent is not taking work'
             else 'no activity for ' || stale_days || ' day(s)'
           end as reason
      from data_center.assignment_batches b
      left join data_center.call_agent_profiles p on p.user_id = b.assigned_to
     where b.state = 'open'
       and (not coalesce(p.is_enabled, true)
            or b.last_activity_at < now() - make_interval(days => stale_days))
  )
  update data_center.assignment_batches b
     set state = 'reclaimed',
         reclaimed_at = now(),
         reclaim_reason = gone.reason
    from gone
   where b.id = gone.id;

  get diagnostics reclaimed = row_count;
  return reclaimed;
end;
$$;

comment on function data_center.reclaim_stale_batches() is
  'Returns batches whose agent has gone quiet or stopped taking work. The items go back into v_callable_records through the state trigger.';


-- ===========================================================================
-- 6. The engine
--
-- Repeat until nothing more can be handed out:
--
--   pick the agent with the fewest open batches who is under capacity,
--   pick their partner: the one they were last working if it still has
--     records, otherwise the partner with the most outstanding,
--   take up to batch_size of that partner's oldest callable records,
--   write the batch.
--
-- Agent-first rather than partner-first, because capacity is the binding
-- constraint. Work always exists; someone free to do it does not.
--
-- The advisory lock is the part that matters. The obvious version reads the
-- open batches, decides, then writes, and two invocations can both read the
-- same "this agent has none" before either writes: the same check-then-act
-- that was tested and raced in the metrics run. A lock cannot be raced.
-- 8150621 sits beside the metrics run's 8150620.
-- ===========================================================================

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
        select p.user_id,
               coalesce(p.max_open_batches, default_cap) as cap,
               (select count(*) from data_center.assignment_batches b
                 where b.assigned_to = p.user_id and b.state = 'open') as open_now,
               (select max(b.assigned_at) from data_center.assignment_batches b
                 where b.assigned_to = p.user_id) as last_given
          from data_center.call_agent_profiles p
          join data_center.module_access m on m.user_id = p.user_id
         where p.is_enabled
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

comment on function data_center.assign_batches(integer) is
  'Hands out batches until agents are at capacity or work runs out. Takes an advisory lock: the check-then-act version can be raced, and was.';


-- ===========================================================================
-- 7. Keeping a batch's activity current
--
-- Staleness is measured from the last thing that happened, and the things that
-- happen to a batch happen to its records: an attempt logged, a record saved.
-- Without this every batch looks stale three days after it was handed out,
-- however hard the agent is working.
-- ===========================================================================

create or replace function data_center.touch_assignment_batch()
returns trigger
language plpgsql
as $$
begin
  update data_center.assignment_batches b
     set last_activity_at = now()
    from data_center.assignment_items i
   where i.batch_id = b.id
     and i.sale_id = new.sale_id
     and i.is_active
     and b.state = 'open';
  return new;
end;
$$;

drop trigger if exists touch_batch_on_attempt on data_center.call_attempts;
create trigger touch_batch_on_attempt
  after insert on data_center.call_attempts
  for each row execute function data_center.touch_assignment_batch();

drop trigger if exists touch_batch_on_record on data_center.call_records;
create trigger touch_batch_on_record
  after insert or update on data_center.call_records
  for each row execute function data_center.touch_assignment_batch();


-- ===========================================================================
-- 8. Who was given what, and what came of it
--
-- A view rather than a table dump, because the question people ask is about
-- the call, not about the row: which agent, which partner, which buyer, rung
-- when, and with what result.
-- ===========================================================================

create or replace view data_center.v_assignment_log as
select
  b.id as batch_id,
  b.organization_id,
  o.partner_name,
  b.assigned_to as agent_id,
  ap.full_name as agent_name,
  b.assigned_at,
  b.state as batch_state,
  b.size as batch_size,
  b.last_activity_at,
  b.reclaimed_at,
  b.reclaim_reason,

  i.sale_id,
  i.position,
  i.is_active,

  s.stove_serial_no,
  s.sales_date,

  cr.verification_outcome,
  co.label as call_outcome,
  cr.attempt_count,
  cr.updated_at as record_updated_at,

  -- The number that would have been rung. There is no column recording the
  -- digits actually dialled, so this is the number the record carried:
  -- corrected where an agent corrected it, as typed otherwise. Saying which
  -- one it is beats inventing a field nothing writes.
  coalesce(cr.corrected_phone, s.phone) as number_on_record,

  la.attempted_at as last_attempt_at,
  ao.label as last_attempt_outcome,
  la.note as last_attempt_note,
  lp.full_name as last_attempt_by
from data_center.assignment_batches b
join public.organizations o on o.id = b.organization_id
left join public.profiles ap on ap.id = b.assigned_to
join data_center.assignment_items i on i.batch_id = b.id
join public.sales s on s.id = i.sale_id
left join data_center.call_records cr on cr.sale_id = i.sale_id
left join data_center.option_values co on co.id = cr.call_outcome_id
left join lateral (
  select a.attempted_at, a.outcome_id, a.note, a.created_by
    from data_center.call_attempts a
   where a.sale_id = i.sale_id
   order by a.attempted_at desc
   limit 1
) la on true
left join data_center.option_values ao on ao.id = la.outcome_id
left join public.profiles lp on lp.id = la.created_by;

comment on view data_center.v_assignment_log is
  'One row per assigned record: who was given it, who rang, when, and what came of it.';
