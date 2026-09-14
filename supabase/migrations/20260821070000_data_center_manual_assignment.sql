-- ===========================================================================
-- Assigning by hand
--
-- The engine hands out work well when the answer is "spread it evenly": it
-- picks the agent with the fewest open batches, finishes a partner before
-- starting another, and takes back what goes quiet. What it cannot express is
-- a supervisor's judgement. Give Hanifa this partner because she has called
-- them before. Give the Kano backlog to three people this afternoon. Take
-- those forty back, he is on leave from Friday.
--
-- So this is a second door onto the same room, not a second room. Same tables,
-- same triggers, same advisory lock, same partial unique index. A record
-- cannot be in two batches whether it got there by engine or by hand, because
-- that rule was never written into the engine in the first place - it is an
-- index, and an index does not care who is inserting.
--
-- Rollback:
--   drop function data_center.assign_batch_manual(uuid, uuid, integer, uuid);
--   drop function data_center.unassign_batch(uuid, text, uuid);
--   drop function data_center.unassign_item(uuid, uuid);
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Hand one partner's records to one agent
--
-- Returns the batch it made and how many records actually went into it, which
-- can be short of what was asked for when the partner is nearly exhausted.
-- Zero means the pool emptied, and the caller is told rather than left looking
-- at an agent holding a batch of nothing.
-- ---------------------------------------------------------------------------

create or replace function data_center.assign_batch_manual(
  p_agent uuid,
  p_org uuid,
  p_size integer default null,
  p_actor uuid default null
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

  insert into data_center.assignment_batches
    (organization_id, assigned_to, size, created_by)
  values (p_org, p_agent, want, p_actor)
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

comment on function data_center.assign_batch_manual(uuid, uuid, integer, uuid) is
  'A supervisor hands one partner''s records to one agent. Same tables, triggers and lock as the engine.';


-- ---------------------------------------------------------------------------
-- 2. Take a whole batch back
--
-- Reclaiming is already the word for this and already has a trigger that
-- releases the records, so an administrator taking work back travels the same
-- path as the staleness sweep. One state change, one place where records go
-- back into the pool.
-- ---------------------------------------------------------------------------

create or replace function data_center.unassign_batch(
  p_batch uuid,
  p_reason text default 'unassigned by an administrator',
  p_actor uuid default null
)
returns integer
language plpgsql
security definer
set search_path = data_center, public, pg_temp
as $$
declare
  released int;
begin
  select count(*)::int into released
    from data_center.assignment_items
   where batch_id = p_batch and is_active;

  update data_center.assignment_batches
     set state = 'reclaimed',
         reclaimed_at = now(),
         reclaim_reason = p_reason,
         updated_at = now(),
         updated_by = p_actor
   where id = p_batch and state = 'open';

  if not found then
    raise exception 'That batch is not open'
      using errcode = 'check_violation';
  end if;

  return released;
end;
$$;

comment on function data_center.unassign_batch(uuid, text, uuid) is
  'Returns an open batch to the pool, through the same state change the staleness sweep uses.';


-- ---------------------------------------------------------------------------
-- 3. Take one record back
--
-- Because a supervisor's actual complaint is usually about one number, not
-- twenty. A batch emptied this way is reclaimed rather than left open holding
-- nothing: an open batch with no records still counts against the agent's
-- capacity, which would quietly stop them being given more work.
-- ---------------------------------------------------------------------------

create or replace function data_center.unassign_item(
  p_sale_id uuid,
  p_actor uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = data_center, public, pg_temp
as $$
declare
  the_batch uuid;
  still_active int;
begin
  update data_center.assignment_items
     set is_active = false
   where sale_id = p_sale_id and is_active
  returning batch_id into the_batch;

  if the_batch is null then
    raise exception 'That record is not assigned to anyone'
      using errcode = 'check_violation';
  end if;

  select count(*)::int into still_active
    from data_center.assignment_items
   where batch_id = the_batch and is_active;

  if still_active = 0 then
    update data_center.assignment_batches
       set state = 'reclaimed',
           reclaimed_at = now(),
           reclaim_reason = 'emptied one record at a time',
           updated_at = now(),
           updated_by = p_actor
     where id = the_batch and state = 'open';
  end if;

  return the_batch;
end;
$$;

comment on function data_center.unassign_item(uuid, uuid) is
  'Returns one record to the pool. Reclaims the batch if it was the last one in it.';
