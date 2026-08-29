-- The Data Center dashboard, answerable for a period.
--
-- WHY
--
-- The dashboard could only ever show all time. Its scorecard metrics carried
-- `by`, `key` and `label` and no date at all, so there was no way to ask what
-- August looked like. The Analysis board has answered period questions since
-- it shipped, because its metrics carry `period`; the dashboard simply never
-- got the same treatment.
--
-- HOW
--
-- The same shape Analysis already uses: every metric carries `period` at MONTH
-- grain, and any range is a sum of months. Precomputing each named period
-- would multiply the rows by the number of periods offered and still could not
-- answer a range nobody thought to precompute.
--
-- Cheap here: measured before writing this, the snapshot grows from 3,311 rows
-- to about 4,725. Not 14x, because most partners transfer in a handful of the
-- fifteen months the data spans.
--
-- WHICH DATE
--
-- The sold-to-partner date, never the date the record reached this app. Those
-- differ on most records: confirmed against the ERP itself, where
-- stove_ids.transfer_sales_date matches sales_orders.sales_date on 741 of 741
-- references while the arrival date matches on 214. Every other surface
-- already computes on the sold-to-partner date; this makes the dashboard the
-- same, which is the whole point.
--
-- The shipment cuts take it from transfer_funnel.sales_date. The assignment
-- cuts are not shipments and have no sales date, so they take the month the
-- work was handed out, which is their equivalent. Giving both a period keeps
-- one rule for the range filter rather than two.
--
-- A shipment with no usable sales date keeps a NULL period. It belongs in the
-- all-time view and in no particular month, which is exactly what is true of
-- it. Nine such rows exist today, carrying four stoves, three of them demo.

CREATE OR REPLACE FUNCTION data_center.compute_scorecards(p_run_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'data_center', 'public', 'pg_temp'
AS $function$
declare
  d record;
  written integer := 0;
  n integer;
begin
  -- ---- Shipment dimensions: partner, location, sales rep -------------------
  --
  -- One statement per dimension, all from the same template, differing only in
  -- the grouping expressions. The dimension jsonb records `by`, `key` and
  -- `label`, so the reader can both filter and render without joining.
  for d in
    select * from (values
      ('partner',   'f.organization_id::text', 'coalesce(f.partner_name, ''Unknown'')'),
      ('location',  'coalesce(f.transfer_state, ''Unknown'')', 'coalesce(f.transfer_state, ''Unknown'')'),
      ('sales_rep', 'coalesce(f.sales_rep, ''Unknown'')', 'coalesce(f.sales_rep, ''Unknown'')')
    ) as t(dim_by, key_expr, label_expr)
  loop
    execute format($q$
      insert into data_center.metric_snapshots (run_id, metric_key, dimension, value_num)
      select $1, 'scorecard.' || m.k,
             jsonb_build_object('by', %1$L, 'key', g.key, 'label', g.label, 'period', g.period),
             m.v
      from (
        select %2$s as key, %3$s as label,
               case when f.sales_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
                    then to_char(left(f.sales_date, 10)::date, 'YYYY-MM') end as period,
               sum(f.issued_count)      as issued,
               sum(f.received_count)    as received,
               sum(f.digitalised_count) as digitalised,
               sum(f.verified_count)    as verified,
               sum(f.unverified_count)  as unverified,
               sum(f.unreachable_count) as unreachable,
               sum(f.unresolved_count)  as unresolved
        from data_center.transfer_funnel f
        group by 1, 2, 3
      ) g
      cross join lateral (values
        ('issued', g.issued), ('received', g.received),
        ('digitalised', g.digitalised), ('verified', g.verified),
        ('unverified', g.unverified), ('unreachable', g.unreachable),
        ('unresolved', g.unresolved)
      ) m(k, v)
    $q$, d.dim_by, d.key_expr, d.label_expr) using p_run_id;
    get diagnostics n = row_count; written := written + n;
  end loop;

  -- ---- People dimensions: call agent, manager -------------------------------
  --
  -- Reclaimed batches are excluded: those records were taken back, so counting
  -- them against the agent would charge them for work they no longer hold.
  -- The manager rollup is the same numbers through profiles.manager_id, which
  -- production has on 50 of 486 profiles today, so it reads sparse until the
  -- org chart is filled in. That is the data's problem to fix, not this
  -- function's to disguise.
  for d in
    select * from (values
      ('call_agent', 'b.assigned_to::text', 'coalesce(ap.full_name, ''Unknown agent'')'),
      ('manager',    'ap.manager_id::text', 'coalesce(mp.full_name, ''No manager set'')')
    ) as t(dim_by, key_expr, label_expr)
  loop
    execute format($q$
      insert into data_center.metric_snapshots (run_id, metric_key, dimension, value_num)
      select $1, 'scorecard.' || m.k,
             jsonb_build_object('by', %1$L, 'key', g.key, 'label', g.label, 'period', g.period),
             m.v
      from (
        select %2$s as key, %3$s as label,
               to_char(b.assigned_at, 'YYYY-MM') as period,
               count(*)::numeric as issued,
               count(*) filter (where cr.attempt_count > 0)::numeric as received,
               count(*) filter (where cr.verification_outcome is not null
                                  and cr.verification_outcome <> 'not_verified')::numeric as digitalised,
               count(*) filter (where cr.verification_outcome = 'fully_verified')::numeric as verified,
               count(*) filter (where cr.verification_outcome in
                 ('partially_verified'))::numeric as unverified,
               count(*) filter (where cr.verification_outcome = 'unreachable')::numeric as unreachable,
               (count(*) - count(*) filter (where cr.verification_outcome is not null
                                              and cr.verification_outcome <> 'not_verified'))::numeric as unresolved
        from data_center.assignment_items i
        join data_center.assignment_batches b on b.id = i.batch_id
        left join public.profiles ap on ap.id = b.assigned_to
        left join public.profiles mp on mp.id = ap.manager_id
        left join data_center.call_records cr on cr.sale_id = i.sale_id
        where b.state <> 'reclaimed'
          and %2$s is not null
        group by 1, 2, 3
      ) g
      cross join lateral (values
        ('issued', g.issued), ('received', g.received),
        ('digitalised', g.digitalised), ('verified', g.verified),
        ('unverified', g.unverified), ('unreachable', g.unreachable),
        ('unresolved', g.unresolved)
      ) m(k, v)
    $q$, d.dim_by, d.key_expr, d.label_expr) using p_run_id;
    get diagnostics n = row_count; written := written + n;
  end loop;

  return written;
end;
$function$

comment on function data_center.compute_scorecards(uuid) is
  'Scorecard metrics at month grain. Shipment cuts are dated by the sold-to-partner date (transfer_funnel.sales_date), never by when the record reached this app; assignment cuts by assignment_batches.assigned_at, when the work was handed out. A range is a sum of months, as in compute_analysis.';
