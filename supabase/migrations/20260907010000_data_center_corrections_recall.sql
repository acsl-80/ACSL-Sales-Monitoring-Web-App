-- ===========================================================================
-- Phase 24, slice 3: review and recall.
--
-- 1. A record whose fix the call centre closed with "ring again" earns a fresh
--    allowance of calls. No flag: v_callable_records subtracts the attempts
--    that had been made when the newest such close happened, so the same
--    `callback_limit` applies to the calls made since. The engine reads the
--    view and needs no change; the columns it read are unchanged and two are
--    appended.
-- 2. The dashboard's correction counts come from the episodes, split by state,
--    so "Waiting on Sales" and "Awaiting review" are two numbers.
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
  c.last_attempt_at,
  rc.reviewed_at as recall_closed_at,
  coalesce(rc.attempts_at_close, 0) as attempts_before_recall
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
  -- Not already someone's work. `is_active` rather than the batch state, so
  -- one index answers it: see the partial unique index on assignment_items.
  and not exists (
    select 1 from data_center.assignment_items i
     where i.sale_id = c.sale_id and i.is_active
  );

comment on view data_center.v_callable_records is
  'Records still needing a call: nothing concluded, attempts left since the last "ring again" close, not already assigned. The one definition of outstanding work.';

-- ---------------------------------------------------------------------------
-- compute_metrics, replaced whole as before, with only the correction family
-- changed: counts per episode state, and the average from the episodes.
-- ---------------------------------------------------------------------------

create or replace function data_center.compute_metrics(p_run_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'data_center', 'public'
as $function$
declare
  complete_pred text := data_center.completeness_predicate('s');
  top_n integer;
  written integer := 0;
  n integer;
begin
  select coalesce(value::text::integer, 15) into top_n
  from data_center.workflow_config where key = 'metrics.top_n';
  top_n := coalesce(top_n, 15);

  -- ---- Sales volume and completeness -------------------------------------
  -- Each of these was one row with an empty dimension. Each is now one row per
  -- consignment month, which the read query sums back to the same figure when
  -- no period is asked for.
  execute format($q$
    insert into data_center.metric_snapshots (run_id, metric_key, dimension, value_num)
    select $1, k, jsonb_build_object('period', period), v from (
      select p.period, 'sales.total' k, count(*)::numeric v
        from public.sales s
        left join data_center.v_sale_period p on p.sale_id = s.id
       where s.is_archived is not true
       group by 1
      union all
      select p.period, 'sales.archived', count(*)::numeric
        from public.sales s
        left join data_center.v_sale_period p on p.sale_id = s.id
       where s.is_archived
       group by 1
      union all
      select p.period, 'sales.complete', count(*) filter (where %1$s)::numeric
        from public.sales s
        left join data_center.v_sale_period p on p.sale_id = s.id
       where s.is_archived is not true
       group by 1
      union all
      select p.period, 'sales.incomplete', count(*) filter (where not (%1$s))::numeric
        from public.sales s
        left join data_center.v_sale_period p on p.sale_id = s.id
       where s.is_archived is not true
       group by 1
      union all
      select p.period, 'sales.app_says_completed',
             count(*) filter (where s.status = 'completed')::numeric
        from public.sales s
        left join data_center.v_sale_period p on p.sale_id = s.id
       where s.is_archived is not true
       group by 1
      union all
      select p.period, 'sales.status_disagreement',
             count(*) filter (where s.status <> 'completed' and (%1$s))::numeric
        from public.sales s
        left join data_center.v_sale_period p on p.sale_id = s.id
       where s.is_archived is not true
       group by 1
      union all
      /*
       * Every scalar key gets a guaranteed undated zero.
       *
       * Adding `group by period` turned an empty table from "one row saying 0"
       * into no row at all. The equivalence check caught it: five families
       * disappeared from the payload instead of reporting zero, because
       * call_records and call_attempts are both empty today. On a freshly
       * seeded database public.sales is empty too, so the Sold card would have
       * lost its metric entirely rather than showing 0.
       *
       * The zero adds nothing to the all-time sum and is excluded from every
       * range, so its only effect is that the key always exists.
       */
      select null::text, z.k, 0::numeric
        from (values ('sales.total'), ('sales.archived'), ('sales.complete'),
                     ('sales.incomplete'), ('sales.app_says_completed'),
                     ('sales.status_disagreement')) as z(k)
    ) t
  $q$, complete_pred) using p_run_id;
  get diagnostics n = row_count; written := written + n;

  -- ---- Volume over time ---------------------------------------------------
  -- Grouped inserts go through a subquery rather than a positional GROUP BY.
  -- In `insert ... select p_run_id, 'literal', expr`, position 2 is the
  -- literal, not the expression, so `group by 2` silently groups by a constant.
  --
  -- Two different months live in this row and that is intended: `month` is when
  -- the stove reached its end user, `period` is when it left for the partner.
  -- The chart answers "of the consignments in the period shown, when did the
  -- stoves actually sell", which is the lag this module exists to measure.
  insert into data_center.metric_snapshots (run_id, metric_key, dimension, value_num)
  select p_run_id, 'sales.by_month', dim, v from (
    select jsonb_build_object('month', to_char(date_trunc('month', s.sales_date), 'YYYY-MM'),
                              'period', p.period) as dim,
           count(*)::numeric as v
    from public.sales s
    left join data_center.v_sale_period p on p.sale_id = s.id
    where s.is_archived is not true
      and s.sales_date is not null
      and s.sales_date >= (current_date - interval '24 months')
    group by 1
  ) t;
  get diagnostics n = row_count; written := written + n;

  -- ---- Who and where ------------------------------------------------------
  --
  -- The top-N is chosen ONCE, on the all-time totals, and that set is then cut
  -- by period. Ranking within each month instead would be the obvious way and
  -- is wrong: the read query sums the months back together, and a partner
  -- placing 16th in every month while placing 3rd overall would be dropped from
  -- every month and so vanish from the total the page shows.
  insert into data_center.metric_snapshots (run_id, metric_key, dimension, value_num)
  select p_run_id, 'sales.by_partner', dim, v from (
    with top_partners as (
      select s.organization_id
        from public.sales s
       where s.is_archived is not true
       group by 1
       order by count(*) desc, s.organization_id
       limit top_n
    )
    select jsonb_build_object('partner', coalesce(o.partner_name, 'Unknown'),
                              'organization_id', s.organization_id,
                              'period', p.period) as dim,
           count(*)::numeric as v
    from public.sales s
    join top_partners tp on tp.organization_id is not distinct from s.organization_id
    left join public.organizations o on o.id = s.organization_id
    left join data_center.v_sale_period p on p.sale_id = s.id
    where s.is_archived is not true
    group by 1
  ) t;
  get diagnostics n = row_count; written := written + n;

  insert into data_center.metric_snapshots (run_id, metric_key, dimension, value_num)
  select p_run_id, 'sales.by_state', dim, v from (
    with top_states as (
      select coalesce(s.state_backup, 'Unknown') as state
        from public.sales s
       where s.is_archived is not true
       group by 1
       order by count(*) desc, 1
       limit top_n
    )
    select jsonb_build_object('state', coalesce(s.state_backup, 'Unknown'),
                              'period', p.period) as dim,
           count(*)::numeric as v
    from public.sales s
    join top_states ts on ts.state = coalesce(s.state_backup, 'Unknown')
    left join data_center.v_sale_period p on p.sale_id = s.id
    where s.is_archived is not true
    group by 1
  ) t;
  get diagnostics n = row_count; written := written + n;

  -- ---- Verification -------------------------------------------------------
  -- A sale nobody has called is its own bucket rather than being folded into
  -- not_verified. "Never touched" and "called and could not confirm" are
  -- different problems with different answers, and the queue can already tell
  -- them apart, so the dashboard should too.
  insert into data_center.metric_snapshots (run_id, metric_key, dimension, value_num)
  select p_run_id, 'verification.by_outcome', dim, v from (
    select jsonb_build_object('outcome',
             case when cr.sale_id is null then 'never_called'
                  else cr.verification_outcome end,
             'period', p.period) as dim,
           count(*)::numeric as v
    from public.sales s
    left join data_center.call_records cr on cr.sale_id = s.id
    left join data_center.v_sale_period p on p.sale_id = s.id
    where s.is_archived is not true
    group by 1
  ) t;
  get diagnostics n = row_count; written := written + n;

  -- ---- The call centre's own work ----------------------------------------
  --
  -- Dated by the consignment behind the record, not by when the call was made,
  -- so "August" means the same population here as it does two cards to the
  -- left. Whether the call centre was busy in a given week is a different
  -- question and belongs to a surface that asks it.
  --
  -- avg_attempts is excluded on purpose. The read query sums a range, and a sum
  -- of monthly averages is not an average, so it stays one all-time row and the
  -- card says so.
  insert into data_center.metric_snapshots (run_id, metric_key, dimension, value_num)
  select p_run_id, k, jsonb_build_object('period', period), v from (
    select p.period, 'calls.records_worked' k, count(*)::numeric v
      from data_center.call_records cr
      left join data_center.v_sale_period p on p.sale_id = cr.sale_id
     group by 1
    union all
    select p.period, 'calls.attempts_total', count(*)::numeric
      from data_center.call_attempts ca
      left join data_center.v_sale_period p on p.sale_id = ca.sale_id
     group by 1
    union all
    select p.period, 'calls.exhausted', count(*)::numeric
      from data_center.call_records cr
      left join data_center.v_sale_period p on p.sale_id = cr.sale_id
     where cr.attempt_count >= 3 and cr.verification_outcome = 'not_verified'
     group by 1
    union all
    -- The same guarantee, for the same reason. Both call tables are empty
    -- today, which is exactly when the group-by produces nothing.
    select null::text, z.k, 0::numeric
      from (values ('calls.records_worked'), ('calls.attempts_total'),
                   ('calls.exhausted')) as z(k)
  ) t;
  get diagnostics n = row_count; written := written + n;

  insert into data_center.metric_snapshots (run_id, metric_key, dimension, value_num)
  select p_run_id, 'calls.avg_attempts', '{}'::jsonb,
         round(coalesce(avg(attempt_count) filter (where attempt_count > 0), 0), 2)
    from data_center.call_records;
  get diagnostics n = row_count; written := written + n;

  -- ---- The correction loop ------------------------------------------------
  -- Episodes, not the mirror columns on call_records: since phase 24 `fixed`
  -- is a state of its own (Sales says it is done, the call centre has not
  -- looked), and the mirror cannot tell it from open. One row per state.
  insert into data_center.metric_snapshots (run_id, metric_key, dimension, value_num)
  select p_run_id, k, jsonb_build_object('period', period), v from (
    select p.period, 'corrections.' || cx.state as k, count(*)::numeric as v
      from data_center.corrections cx
      left join data_center.v_sale_period p on p.sale_id = cx.sale_id
     where cx.state in ('open', 'fixed', 'resolved')
     group by 1, 2
    union all
    select null::text, z.k, 0::numeric
      from (values ('corrections.open'), ('corrections.fixed'), ('corrections.resolved')) as z(k)
  ) t;
  get diagnostics n = row_count; written := written + n;

  -- An average, so all-time for the same reason as calls.avg_attempts.
  insert into data_center.metric_snapshots (run_id, metric_key, dimension, value_num)
  select p_run_id, 'corrections.avg_days_to_resolve', '{}'::jsonb,
         round(coalesce(avg(extract(epoch from (reviewed_at - opened_at)) / 86400), 0), 2)
    from data_center.corrections where state = 'resolved' and reviewed_at is not null;
  get diagnostics n = row_count; written := written + n;

  -- ---- Stock --------------------------------------------------------------
  -- Dated by the consignment that carried the stove, the same date
  -- scorecard.issued uses, so the Stock chart and the Issued card narrow to the
  -- same population instead of to two.
  insert into data_center.metric_snapshots (run_id, metric_key, dimension, value_num)
  select p_run_id, 'stock.by_status', dim, v from (
    select jsonb_build_object('status', coalesce(b.status, 'unknown'),
                              'period', cp.period) as dim,
           count(*)::numeric as v
    from public.stove_ids_base b
    left join data_center.v_consignment_period cp on cp.transaction_id = b.sales_reference
    where b.is_archived is not true
    group by 1
  ) t;
  get diagnostics n = row_count; written := written + n;

  -- ---- Import -------------------------------------------------------------
  -- No period, and not an oversight. A batch is the bench's own unit of work
  -- and spans however many consignments the sheet happened to cover, so there
  -- is no cohort to date it by that would not be invented. All-time, and the
  -- card says all-time.
  insert into data_center.metric_snapshots (run_id, metric_key, dimension, value_num)
  select p_run_id, k, '{}'::jsonb, v from (
    select 'import.batches_committed' k, count(*)::numeric v
      from data_center.import_batches where state = 'committed'
    union all
    select 'import.rows_committed', coalesce(sum(committed_rows), 0)::numeric
      from data_center.import_batches
    union all
    select 'import.exceptions_open', count(*)::numeric
      from data_center.import_rows where status = 'exception'
  ) t;
  get diagnostics n = row_count; written := written + n;

  return written;
end;
$function$;


comment on function data_center.compute_metrics(uuid) is
  'Writes the dashboard metric families for one run. Every family belonging to a consignment carries a period at month grain, dated by when the stove was sold to the partner; the two averages and the three import counters carry none, because a sum of averages is not an average and a batch has no consignment. Correction counts are per episode state: open, fixed, resolved.';
