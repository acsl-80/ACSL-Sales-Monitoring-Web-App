-- ===========================================================================
-- Data Center, phase 24, slice 7b: the disagreement metric compares like with
-- like.
--
-- sales.status_disagreement counted every sale the module called complete and
-- the sales app did not call completed. Once the sales app's rule matches its
-- form (20260908020000), a sale with every field and no drawn signature reads
-- pending there, and the module, which accepts a paper agreement as evidence,
-- calls it complete: that is two rules answering two different questions, not
-- a disagreement about the record. A disagreement is the sales app saying a
-- required field is missing (incomplete) while the module says nothing is.
-- The metric now counts exactly that. Nothing else in compute_metrics changes.
-- ===========================================================================

create or replace function data_center.compute_metrics(p_run_id uuid, p_families text[] default null)
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
  recent_days integer := coalesce(
    (select (value #>> '{}')::int from data_center.workflow_config where key = 'pool.recent_days'), 7);
begin
  select coalesce(value::text::integer, 15) into top_n
  from data_center.workflow_config where key = 'metrics.top_n';
  top_n := coalesce(top_n, 15);

  -- ---- The pool -----------------------------------------------------------
  -- What is callable now, by partner, and what arrived lately. No period: a
  -- pool is a moment. Computed first, so a run asked for the pool family
  -- alone (the board's Recompute) can stop right after it; the full run
  -- carries on through every family as before. One engine, one run id.
  insert into data_center.metric_snapshots (run_id, metric_key, dimension, value_num)
  select p_run_id, k, d, v from (
    select 'pool.callable' as k, '{}'::jsonb as d, count(*)::numeric as v
      from data_center.v_callable_records
    union all
    select 'pool.partners', '{}'::jsonb, count(distinct organization_id)::numeric
      from data_center.v_callable_records
    union all
    select 'pool.recall_due', '{}'::jsonb, count(*)::numeric
      from data_center.v_call_center c
     where c.is_archived is not true
       and exists (select 1 from data_center.corrections x
                    where x.sale_id = c.sale_id and x.state = 'resolved' and x.review_outcome = 'recall'
                      and x.reviewed_at > coalesce(c.last_attempt_at, '-infinity'::timestamptz))
    union all
    select 'pool.recent', '{}'::jsonb, count(*)::numeric
      from data_center.v_callable_records
     where digitised_at > now() - make_interval(days => recent_days)
    union all
    select 'pool.callable_by_partner',
           jsonb_build_object('organization_id', organization_id::text, 'partner_name', partner_name),
           count(*)::numeric
      from data_center.v_callable_records
     group by organization_id, partner_name
    union all
    select 'pool.recent_by_partner',
           jsonb_build_object('organization_id', organization_id::text, 'partner_name', partner_name),
           count(*)::numeric
      from data_center.v_callable_records
     where digitised_at > now() - make_interval(days => recent_days)
     group by organization_id, partner_name
  ) t;
  get diagnostics n = row_count; written := written + n;

  -- Never called: sold stoves with no call record at all. Live tables would
  -- need a group by over sales to answer it, so it is computed here.
  insert into data_center.metric_snapshots (run_id, metric_key, dimension, value_num)
  select p_run_id, 'pool.never_called', '{}'::jsonb, count(*)::numeric
    from public.sales s
   where s.is_archived is not true
     and not exists (select 1 from data_center.call_records cr where cr.sale_id = s.id);
  get diagnostics n = row_count; written := written + n;

  if p_families is not null then
    -- A partial run: named families only, and today the only name is pool.
    if exists (select 1 from unnest(p_families) f where f <> 'pool') then
      raise exception 'compute_metrics knows the family pool; % is not one', array_to_string(p_families, ', ')
        using errcode = 'check_violation', hint = 'bad_family';
    end if;
    -- The readers take the newest finished run as the current set, so every
    -- other family's rows are carried forward from the last full run under
    -- this run id, with the moment they were computed kept on them. One run
    -- id stays one consistent set, the dashboard never goes blank because
    -- the board pressed Recompute, and its "computed at" stays honest
    -- because it reads computed_at, not the run. Without a full run to copy
    -- from there is nothing honest to show, so the partial run refuses.
    if not exists (select 1 from data_center.metric_runs r where r.status = 'ok' and r.id <> p_run_id) then
      raise exception 'No full computation has run yet. Run the full computation first.'
        using errcode = 'check_violation', hint = 'no_full_run';
    end if;
    insert into data_center.metric_snapshots (run_id, metric_key, dimension, value_num, value_text, computed_at)
    select p_run_id, s.metric_key, s.dimension, s.value_num, s.value_text, s.computed_at
      from data_center.metric_snapshots s
     where s.run_id = (select r.id from data_center.metric_runs r
                        where r.status = 'ok' and r.id <> p_run_id
                        order by r.finished_at desc nulls last
                        limit 1)
       and s.metric_key not like 'pool.%';
    -- Carried rows are not written rows; the run's count says what it computed.
    return written;
  end if;

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
             count(*) filter (where s.status = 'incomplete' and (%1$s))::numeric
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

  -- ---- What is missing, per part of the rule ------------------------------
  -- One row per required field and one for the evidence, each the count of
  -- live sales missing that part. Deliberately undated, like the import
  -- counters: the dashboard's period is the consignment month and the
  -- records table's is the sale date, so a dated figure here could never
  -- equal the table it links to. Undated, both count every live sale and
  -- agree by construction. Built from the same configuration the predicate
  -- reads, so the parts here are the parts there.
  declare
    req text[];
    fld text;
    arms text[] := '{}';
    evidence text := data_center.completeness_evidence_predicate('s');
  begin
    select array(select jsonb_array_elements_text(value)) into req
      from data_center.workflow_config where key = 'completeness_required_fields';

    foreach fld in array coalesce(req, '{}'::text[]) loop
      arms := arms || format($a$
        select %L as field, count(*) filter (where not (%s))::numeric as v
          from public.sales s
         where s.is_archived is not true$a$, fld, data_center.field_present_predicate(fld, 's'));
    end loop;

    if evidence is not null then
      arms := arms || format($a$
        select %L as field, count(*) filter (where not %s)::numeric as v
          from public.sales s
         where s.is_archived is not true$a$, 'evidence', evidence);
    end if;

    if array_length(arms, 1) is not null then
      execute format($q$
        insert into data_center.metric_snapshots (run_id, metric_key, dimension, value_num)
        select $1, 'sales.incomplete_by_missing', jsonb_build_object('field', field), v
          from (%s) t
      $q$, array_to_string(arms, ' union all ')) using p_run_id;
      get diagnostics n = row_count; written := written + n;
    end if;
  end;

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
  -- looked), and the mirror cannot tell it from open. `resolved` counts the
  -- closes the call centre made (ring again, nothing to ring); a withdrawal
  -- or a send-back-again is not a resolution and is not counted as one.
  insert into data_center.metric_snapshots (run_id, metric_key, dimension, value_num)
  select p_run_id, k, jsonb_build_object('period', period), v from (
    select p.period, x.k, count(*)::numeric as v
      from (select cx.sale_id,
                   case when cx.state in ('open', 'fixed') then 'corrections.' || cx.state
                        when cx.state = 'resolved' and cx.review_outcome in ('recall', 'no_recall')
                          then 'corrections.resolved'
                   end as k
              from data_center.corrections cx) x
      left join data_center.v_sale_period p on p.sale_id = x.sale_id
     where x.k is not null
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
    from data_center.corrections
   where state = 'resolved' and reviewed_at is not null and review_outcome in ('recall', 'no_recall');
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

comment on function data_center.compute_metrics(uuid, text[]) is
  'Writes the dashboard metric families for one run. Every family belonging to a consignment carries a period at month grain, dated by when the stove was sold to the partner; the two averages, the three import counters and the pool family carry none. sales.incomplete_by_missing is undated and carries a field dimension: one row per required field and one for the evidence, over every live sale. sales.status_disagreement counts sales the sales app calls incomplete that this module calls complete. With p_families = array[''pool''] only the pool family is written and the run returns; the read takes the newest row per key, so the other families keep their last full run.';
