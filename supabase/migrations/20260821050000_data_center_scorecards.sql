-- Phase 13: the five scorecards, from one engine.
--
-- Five scorecards showing the same columns, each grouped by a different
-- dimension. The rule from CLAUDE.md is the whole design: one metric engine,
-- parameterised by dimension, never one per dimension. Five implementations
-- of the same six numbers are five chances for the same number to disagree
-- with itself.
--
-- Two sources, because the five dimensions ask about two different things:
--
--   partner, location, sales rep    what happened to what was SHIPPED.
--                                   Sums over transfer_funnel, which the
--                                   refresh already computed per transfer, so
--                                   this is arithmetic over ~500 rows, not a
--                                   pass over sales.
--
--   call agent, manager             what happened to what was HANDED OUT.
--                                   A transfer was never given to an agent;
--                                   records were. So their scorecard counts
--                                   assigned records and what each one became.
--
-- The columns keep one meaning across both:
--
--   issued        shipped to the partner / handed to the agent
--   received      returned on paper / touched at least once
--   digitalised   typed into the system / concluded with a saved record
--   verified, unverified, unreachable   the outcomes
--   unresolved    issued minus the three outcomes: still someone's problem
--
-- §3.4's consistency rule holds by construction on both sides:
-- verified + unverified + unreachable + unresolved = the reconciling column
-- (digitalised for shipments, issued for people), because unresolved is
-- defined as the remainder rather than counted separately.

create or replace function data_center.compute_scorecards(p_run_id uuid)
returns integer
language plpgsql
security definer
set search_path = data_center, public, pg_temp
as $$
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
                 ('partially_verified', 'doubtful_verification'))::numeric as unverified,
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
$$;

comment on function data_center.compute_scorecards(uuid) is
  'The five scorecards: partner, location and sales rep summed from transfer_funnel; call agent and manager counted from assigned records. One engine, dimensions as data.';
