-- Phase 28, slice 5 (2026-09-11): New first, and worked records stay with
-- the agent. Decisions D49 to D51.
--
--  1. pick_callable learns the token never_called: a partner's untried
--     numbers before its tried ones. The registry offers it as "New numbers
--     first" and the configured default order becomes never_called, then
--     oldest_sale. Per-partner overrides are kept as they are.
--  2. reclaim_stale_batches releases only the never-called records of a quiet
--     batch; the records the agent has already worked stay with them until a
--     manager moves them. A batch left with no active record is reclaimed as
--     before; one with worked records stays open.
--
-- Additive: no table changes. Undo: re-run the previous definitions from
-- 20260907030000 and 20260821040000, and set the order back.

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
      -- Slice 5, D51: the numbers nobody has called yet come first.
      when 'never_called'     then '(coalesce(r.attempt_count, 0) = 0) desc'
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
  'The next records to hand out for one partner, in the configured order (assignment.priority, overridable per call). The one picker behind the engine and the manual door. Since slice 5 the token never_called puts untried numbers first.';

insert into data_center.option_values (list_key, value, label, sort_order) values
  ('assignment_priority', 'never_called', 'New numbers first', 0)
on conflict (list_key, value) do update
  set label = excluded.label, sort_order = excluded.sort_order, is_active = true;

update data_center.workflow_config
   set value = jsonb_set(coalesce(value, '{}'::jsonb), '{order}', '["never_called", "oldest_sale"]'::jsonb),
       updated_at = now()
 where key = 'assignment.priority';

-- ---------------------------------------------------------------------------
-- D50. A quiet batch lets go of the numbers nobody has called yet. The
-- records the agent has worked (a call logged, a verdict, a send-back) stay
-- with them; the manager moves those through reassign when they choose to.
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
  create temp table if not exists quiet_batches (id uuid primary key, reason text) on commit drop;
  delete from quiet_batches;
  insert into quiet_batches (id, reason)
  select b.id,
         case
           when not coalesce(p.is_enabled, true) then 'agent is not taking work'
           else 'no activity for ' || stale_days || ' day(s)'
         end
    from data_center.assignment_batches b
    left join data_center.call_agent_profiles p on p.user_id = b.assigned_to
   where b.state = 'open'
     and (not coalesce(p.is_enabled, true)
          or b.last_activity_at < now() - make_interval(days => stale_days));

  -- The untried records go back to the pool.
  update data_center.assignment_items i
     set is_active = false
    from quiet_batches q
    left join data_center.call_records cr on cr.sale_id = i.sale_id
   where i.batch_id = q.id
     and i.is_active
     and coalesce(cr.attempt_count, 0) = 0
     and coalesce(cr.verification_outcome, 'not_verified') = 'not_verified'
     and not exists (select 1 from data_center.corrections x
                      where x.sale_id = i.sale_id and x.state in ('open', 'fixed'));

  -- A batch with nothing left in it is reclaimed; one with worked records
  -- stays open with its agent.
  update data_center.assignment_batches b
     set state = 'reclaimed',
         reclaimed_at = now(),
         reclaim_reason = q.reason
    from quiet_batches q
   where b.id = q.id
     and not exists (select 1 from data_center.assignment_items i
                      where i.batch_id = b.id and i.is_active);

  get diagnostics reclaimed = row_count;
  return reclaimed;
end;
$$;

comment on function data_center.reclaim_stale_batches() is
  'Quiet batches (no activity past assignment.stale_after_days, or a paused agent) release their never-called records to the pool; worked records stay with the agent (D50). Returns the batches closed because nothing was left in them.';

-- Readback: the token is known, the default order leads with it, and the
-- reclaim function carries its new comment.
select
  (select count(*) from data_center.option_values where list_key = 'assignment_priority' and value = 'never_called' and is_active) as token_row,
  (select value -> 'order' ->> 0 from data_center.workflow_config where key = 'assignment.priority') as first_token,
  (select obj_description('data_center.reclaim_stale_batches()'::regprocedure) like '%D50%') as reclaim_rewritten;
