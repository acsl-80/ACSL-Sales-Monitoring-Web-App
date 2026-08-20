-- Phase 6: computation and dashboards.
--
-- THE ONE RULE
--
-- A dashboard never aggregates. Every total, count and breakdown is computed
-- ahead of time into metric_snapshots, and reading one is an indexed lookup
-- whether the database holds 38 rows or 500,000.
--
-- Said as a test someone can apply: if a query behind a dashboard contains
-- count(*), sum() or group by over public.sales, it is in the wrong place.
--
-- WHY RUNS, AND NOT JUST ROWS
--
-- metric_snapshots was already append-only, which makes it a history worth
-- having: "how did verification look in June" is a question this answers for
-- free. What it could not answer is "is what I am looking at current, and did
-- the last computation actually finish". A dashboard that silently shows
-- Tuesday's numbers on Friday is worse than one that says it is stale.
--
-- So each computation is a run, every snapshot belongs to one, and the
-- dashboard reads the newest run that succeeded.

create table data_center.metric_runs (
  id           uuid primary key default gen_random_uuid(),
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  status       text not null default 'running'
               check (status in ('running', 'ok', 'failed')),
  metrics_written integer not null default 0,
  duration_ms  integer,
  triggered_by uuid references public.profiles (id) on delete set null,
  error        text
);

comment on table data_center.metric_runs is
  'One row per computation. The dashboard reads the newest run with status ok, so a failed run shows the previous numbers rather than none.';

create index metric_runs_recent_idx on data_center.metric_runs (finished_at desc)
  where status = 'ok';

alter table data_center.metric_snapshots
  add column run_id uuid references data_center.metric_runs (id) on delete cascade;

create index metric_snapshots_run_idx on data_center.metric_snapshots (run_id, metric_key);


-- ===========================================================================
-- The module's own definition of a complete sale
--
-- WHY THIS EXISTS RATHER THAN USING sales.status
--
-- calculate_sale_status() requires a stove photo and an agreement document
-- before it returns `completed`. The Sell Stove form stopped requiring either.
-- The result, in production: 30 of 38 sales read `incomplete`, including 14 of
-- the 15 live ones, and exactly ONE sale in the whole database reads
-- `completed`. A dashboard counting completed sales would report 1 out of 15,
-- be technically correct, and be useless.
--
-- So this module defines completeness for itself, from
-- workflow_config.completeness_required_fields, which today names seven fields
-- and deliberately omits the two images.
--
-- Fixing calculate_sale_status() is the sales app's work. What this module does
-- instead is measure the disagreement, so the defect is a number rather than
-- folklore.
--
-- NO STRING BUILT FROM UNCHECKED CONFIG. The field list is data, so the obvious
-- implementation pastes it into a predicate, which is an injection waiting for
-- anyone with write access to workflow_config. Every name is looked up in the
-- catalogue first, so only a real column of public.sales can get through.
-- ===========================================================================

create or replace function data_center.completeness_predicate(alias text default 's')
returns text
language plpgsql stable as $$
declare
  fields text[];
  f text;
  parts text[] := '{}';
  col_type text;
begin
  select array(select jsonb_array_elements_text(value))
    into fields
  from data_center.workflow_config
  where key = 'completeness_required_fields';

  -- No rule configured means nothing is claimed complete, rather than
  -- everything being claimed complete.
  if fields is null or array_length(fields, 1) is null then
    return 'false';
  end if;

  foreach f in array fields loop
    select data_type into col_type
    from information_schema.columns
    where table_schema = 'public' and table_name = 'sales' and column_name = f;

    if col_type is null then
      raise exception
        'completeness_required_fields names %, which is not a column of public.sales', f;
    end if;

    if col_type in ('text', 'character varying', 'character') then
      parts := parts || format('nullif(trim(coalesce(%I.%I, %L)), %L) is not null', alias, f, '', '');
    else
      parts := parts || format('%I.%I is not null', alias, f);
    end if;
  end loop;

  return array_to_string(parts, ' and ');
end;
$$;

comment on function data_center.completeness_predicate is
  'The module completeness rule as plain column predicates, built from workflow_config. Column names are validated against the catalogue, so config cannot become SQL.';


-- ===========================================================================
-- The computation itself
--
-- All of it in one function, for three reasons.
--
-- It is one round trip rather than twenty from an edge function, which matters
-- because an edge function has a wall clock and this reads every sale.
--
-- It is one reviewable place. "Where does that number come from" has a single
-- answer, and the rule about dashboards never aggregating can be checked by
-- reading one file.
--
-- And it lets the completeness predicate be interpolated once rather than
-- evaluated per row. Measured at 480,005 live sales: as a per-row jsonb lookup
-- the same count took 73 SECONDS; as plain column predicates it takes 549 ms.
-- Same answer, 133 times faster.
-- ===========================================================================

create or replace function data_center.compute_metrics(p_run_id uuid)
returns integer
language plpgsql security definer set search_path = data_center, public as $$
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
  execute format($q$
    insert into data_center.metric_snapshots (run_id, metric_key, dimension, value_num)
    select $1, k, '{}'::jsonb, v from (
      select 'sales.total' k, count(*)::numeric v
        from public.sales s where s.is_archived is not true
      union all
      select 'sales.archived', count(*)::numeric
        from public.sales s where s.is_archived
      union all
      select 'sales.complete', count(*) filter (where %1$s)::numeric
        from public.sales s where s.is_archived is not true
      union all
      select 'sales.incomplete', count(*) filter (where not (%1$s))::numeric
        from public.sales s where s.is_archived is not true
      union all
      select 'sales.app_says_completed',
             count(*) filter (where s.status = 'completed')::numeric
        from public.sales s where s.is_archived is not true
      union all
      select 'sales.status_disagreement',
             count(*) filter (where s.status <> 'completed' and (%1$s))::numeric
        from public.sales s where s.is_archived is not true
    ) t
  $q$, complete_pred) using p_run_id;
  get diagnostics n = row_count; written := written + n;

  -- ---- Volume over time ---------------------------------------------------
  -- Grouped inserts go through a subquery rather than a positional GROUP BY.
  -- In `insert ... select p_run_id, 'literal', expr`, position 2 is the
  -- literal, not the expression, so `group by 2` silently groups by a constant.
  insert into data_center.metric_snapshots (run_id, metric_key, dimension, value_num)
  select p_run_id, 'sales.by_month', dim, v from (
    select jsonb_build_object('month', to_char(date_trunc('month', s.sales_date), 'YYYY-MM')) as dim,
           count(*)::numeric as v
    from public.sales s
    where s.is_archived is not true
      and s.sales_date is not null
      and s.sales_date >= (current_date - interval '24 months')
    group by 1
  ) t;
  get diagnostics n = row_count; written := written + n;

  -- ---- Who and where ------------------------------------------------------
  insert into data_center.metric_snapshots (run_id, metric_key, dimension, value_num)
  select p_run_id, 'sales.by_partner', dim, v from (
    select jsonb_build_object('partner', coalesce(o.partner_name, 'Unknown'),
                              'organization_id', s.organization_id) as dim,
           count(*)::numeric as v
    from public.sales s
    left join public.organizations o on o.id = s.organization_id
    where s.is_archived is not true
    group by 1
    order by 2 desc
    limit top_n
  ) t;
  get diagnostics n = row_count; written := written + n;

  insert into data_center.metric_snapshots (run_id, metric_key, dimension, value_num)
  select p_run_id, 'sales.by_state', dim, v from (
    select jsonb_build_object('state', coalesce(s.state_backup, 'Unknown')) as dim,
           count(*)::numeric as v
    from public.sales s
    where s.is_archived is not true
    group by 1
    order by 2 desc
    limit top_n
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
                  else cr.verification_outcome end) as dim,
           count(*)::numeric as v
    from public.sales s
    left join data_center.call_records cr on cr.sale_id = s.id
    where s.is_archived is not true
    group by 1
  ) t;
  get diagnostics n = row_count; written := written + n;

  -- ---- The call centre's own work ----------------------------------------
  insert into data_center.metric_snapshots (run_id, metric_key, dimension, value_num)
  select p_run_id, k, '{}'::jsonb, v from (
    select 'calls.records_worked' k, count(*)::numeric v from data_center.call_records
    union all
    select 'calls.attempts_total', count(*)::numeric from data_center.call_attempts
    union all
    select 'calls.avg_attempts',
           round(coalesce(avg(attempt_count) filter (where attempt_count > 0), 0), 2)
      from data_center.call_records
    union all
    select 'calls.exhausted', count(*)::numeric
      from data_center.call_records
      where attempt_count >= 3 and verification_outcome = 'not_verified'
  ) t;
  get diagnostics n = row_count; written := written + n;

  -- ---- The correction loop ------------------------------------------------
  insert into data_center.metric_snapshots (run_id, metric_key, dimension, value_num)
  select p_run_id, k, '{}'::jsonb, v from (
    select 'corrections.open' k, count(*)::numeric v
      from data_center.call_records
      where correction_requested_at is not null and correction_resolved_at is null
    union all
    select 'corrections.resolved', count(*)::numeric
      from data_center.call_records where correction_resolved_at is not null
    union all
    select 'corrections.avg_days_to_resolve',
           round(coalesce(avg(extract(epoch from (correction_resolved_at - correction_requested_at)) / 86400), 0), 2)
      from data_center.call_records where correction_resolved_at is not null
  ) t;
  get diagnostics n = row_count; written := written + n;

  -- ---- Stock --------------------------------------------------------------
  insert into data_center.metric_snapshots (run_id, metric_key, dimension, value_num)
  select p_run_id, 'stock.by_status', dim, v from (
    select jsonb_build_object('status', coalesce(b.status, 'unknown')) as dim,
           count(*)::numeric as v
    from public.stove_ids_base b
    where b.is_archived is not true
    group by 1
  ) t;
  get diagnostics n = row_count; written := written + n;

  -- ---- Import -------------------------------------------------------------
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
$$;

comment on function data_center.compute_metrics is
  'Every number a dashboard shows. Reads public.sales in full and is allowed to be slow, because nobody is waiting on it.';


-- ===========================================================================
-- Reading the current numbers
--
-- One view, so no caller has to know how "latest" is decided. The subselect
-- picks the newest successful run, which is a single indexed lookup on
-- metric_runs_recent_idx.
-- ===========================================================================

create or replace view data_center.v_current_metrics as
select
  m.metric_key,
  m.dimension,
  m.value_num,
  m.value_text,
  m.computed_at,
  r.finished_at as run_finished_at
from data_center.metric_snapshots m
join data_center.metric_runs r on r.id = m.run_id
where r.id = (
  select id from data_center.metric_runs
  where status = 'ok'
  order by finished_at desc
  limit 1
);

comment on view data_center.v_current_metrics is
  'What the dashboard reads. Never aggregates: every value here was computed by a run.';


-- ===========================================================================
-- Keeping the history from becoming the problem
--
-- Append-only is the right shape and it grows without limit. Pruning is a
-- function rather than a cron so that deleting history is always something
-- somebody chose, and the two most recent successful runs are never removed:
-- one is what the dashboard shows, the other is what it falls back to.
-- ===========================================================================

create or replace function data_center.prune_metric_runs(keep_days integer default 90)
returns integer
language plpgsql security definer set search_path = data_center, public as $$
declare
  removed integer;
begin
  delete from data_center.metric_runs
  where finished_at < now() - make_interval(days => keep_days)
    and id not in (
      select id from data_center.metric_runs
      where status = 'ok' order by finished_at desc limit 2
    );
  get diagnostics removed = row_count;
  return removed;
end;
$$;


insert into data_center.workflow_config (key, value, description) values
  ('metrics.top_n', '15'::jsonb,
   'How many partners and states a breakdown keeps. A dashboard with 500 bars is not a dashboard.'),
  ('metrics.stale_after_hours', '24'::jsonb,
   'Older than this and the dashboard says so rather than presenting the numbers as current.')
on conflict (key) do nothing;

alter table data_center.metric_runs enable row level security;
