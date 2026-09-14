-- ===========================================================================
-- Four outcomes, everywhere.
--
-- The check constraint dropped 'doubtful_verification' in the previous
-- migration; these are the two places that still counted it. Both are rebuilt
-- from what the database currently holds rather than retyped, so nothing else
-- about them can drift while this one word is removed.
--
-- No numbers move: no record has ever carried the outcome. What changes is
-- that a column can no longer be fed a value the table would now refuse.
-- ===========================================================================

create or replace view data_center.v_transfer_funnel as
WITH digitalised AS (
         SELECT ts.transfer_id,
            count(*) AS digitalised_count,
            count(*) FILTER (WHERE cr.verification_outcome = 'fully_verified'::text) AS verified_count,
            count(*) FILTER (WHERE cr.verification_outcome = ANY (ARRAY['partially_verified'::text])) AS unverified_count,
            count(*) FILTER (WHERE cr.verification_outcome = 'unreachable'::text) AS unreachable_count,
            count(*) FILTER (WHERE cr.sale_id IS NULL OR cr.verification_outcome = 'not_verified'::text) AS unresolved_count
           FROM data_center.v_transfer_stoves ts
             JOIN sales s ON upper(TRIM(BOTH FROM s.stove_serial_no)) = ts.stove_id AND s.is_archived IS NOT TRUE
             LEFT JOIN data_center.call_records cr ON cr.sale_id = s.id
          GROUP BY ts.transfer_id
        ), consigned AS (
         SELECT t.id AS transfer_id,
            sum(rc.received_count) AS received_logged
           FROM stove_transfer_history t
             JOIN data_center.record_consignments rc ON rc.transaction_id = t.transaction_id
          GROUP BY t.id
        )
 SELECT v.transfer_id,
    v.transaction_id,
    v.organization_id,
    v.partner_name,
    v.partner_id,
    v.transfer_state,
    v.transfer_branch,
    v.sales_rep,
    v.sales_date,
    v.transfer_date,
    v.issued_count,
    COALESCE(c.received_logged, d.digitalised_count, 0::bigint)::integer AS received_count,
    c.received_logged IS NOT NULL AS received_is_logged,
    COALESCE(d.digitalised_count, 0::bigint)::integer AS digitalised_count,
    COALESCE(d.verified_count, 0::bigint)::integer AS verified_count,
    COALESCE(d.unverified_count, 0::bigint)::integer AS unverified_count,
    COALESCE(d.unreachable_count, 0::bigint)::integer AS unreachable_count,
    COALESCE(d.unresolved_count, 0::bigint)::integer AS unresolved_count,
    (v.issued_count - COALESCE(d.digitalised_count, 0::bigint))::integer AS outstanding_count
   FROM data_center.v_transfers v
     LEFT JOIN digitalised d ON d.transfer_id = v.transfer_id
     LEFT JOIN consigned c ON c.transfer_id = v.transfer_id;

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
             jsonb_build_object('by', %1$L, 'key', g.key, 'label', g.label),
             m.v
      from (
        select %2$s as key, %3$s as label,
               sum(f.issued_count)      as issued,
               sum(f.received_count)    as received,
               sum(f.digitalised_count) as digitalised,
               sum(f.verified_count)    as verified,
               sum(f.unverified_count)  as unverified,
               sum(f.unreachable_count) as unreachable,
               sum(f.unresolved_count)  as unresolved
        from data_center.transfer_funnel f
        group by 1, 2
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
             jsonb_build_object('by', %1$L, 'key', g.key, 'label', g.label),
             m.v
      from (
        select %2$s as key, %3$s as label,
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
        group by 1, 2
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
$function$;

-- The runtime list the module reads for its outcome vocabulary, and the one
-- registry condition that named the retired value.
update data_center.workflow_config
   set value = '["fully_verified","partially_verified","unreachable","not_verified"]'::jsonb
 where key = 'verification_states';

update data_center.field_defs
   set visible_when = '{"field":"verification_outcome","in":["partially_verified","not_verified"]}'::jsonb
 where visible_when::text like '%doubtful_verification%';
