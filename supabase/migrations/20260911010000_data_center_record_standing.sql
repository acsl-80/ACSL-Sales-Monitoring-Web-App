-- Phase 28, S1: a record's standing, defined once (D41, D43).
--
-- Six places computed "never called", "verified" and "unreachable" six ways:
-- the pool view, My calls, MyWork, the records presets, the metrics and the
-- analysis. One SQL function now answers it, the three views carry it, a
-- partner view sums it, the registry names it, and calls.exhausted reads the
-- same callback limit the pool does. Additive: every existing column keeps
-- its place; the resolved view is recreated because it was frozen as v.*.
--
-- Readback at the end: standings on production today, one row per value.

-- 1. The function --------------------------------------------------------------
create or replace function data_center.record_standing(
  p_verification_outcome text,
  p_attempt_count integer,
  p_correction_state text
) returns text
language sql
immutable
as $$
  select case
    when p_correction_state in ('open', 'fixed')        then 'with_sales'
    when p_verification_outcome = 'fully_verified'     then 'verified'
    when p_verification_outcome = 'partially_verified' then 'partially_verified'
    when p_verification_outcome = 'unreachable'        then 'unreachable'
    when coalesce(p_attempt_count, 0) > 0              then 'in_progress'
    else 'never_called'
  end
$$;

comment on function data_center.record_standing(text, integer, text) is
  'Where a call record stands (D41): with_sales while an episode is open or fixed, then the verdict, then in_progress once a call was made, else never_called. Every surface reads this; none defines its own.';

-- 2. The views -----------------------------------------------------------------
create or replace view data_center.v_call_center as
select
  v.*,
  cr.verification_outcome,
  cr.corrected_phone,
  cr.corrected_alt_phone,
  cr.corrected_end_user_name,
  cr.corrected_address,
  cr.corrected_state,
  cr.corrected_lga,
  cr.ward,
  cr.landmark,
  cr.stated_serial,
  cr.answers,
  cr.other_comments,
  cr.version              as call_record_version,
  cr.updated_at           as call_record_updated_at,
  co.label                as call_outcome,
  ca.label                as call_agent,
  att.call_date_1,
  att.call_date_2,
  att.call_date_3,
  coalesce(cr.attempt_count, 0) as attempt_count,
  cr.last_attempt_at,
  coalesce(
    cx.state,
    case
      when cr.correction_requested_at is null then 'none'
      when cr.correction_resolved_at is null  then 'open'
      else 'resolved'
    end
  ) as correction_state,
  cr.correction_requested_at,
  cr.correction_resolved_at,
  crr.label as correction_reason,
  cr.correction_note,
  case
    when cr.stated_serial is null or v.stove_serial_no is null then null
    else upper(trim(cr.stated_serial)) = upper(trim(v.stove_serial_no))
  end as serial_matches,
  case
    when cr.corrected_phone is null or v.primary_phone is null then null
    else right(regexp_replace(cr.corrected_phone, '\D', '', 'g'), 10)
       <> right(regexp_replace(v.primary_phone,   '\D', '', 'g'), 10)
  end as phone_was_corrected,
  (cr.sale_id is not null) as has_call_record,
  -- Phase 28, D41: one word for where the record stands, from the same
  -- three facts the columns above already carry.
  data_center.record_standing(
    cr.verification_outcome,
    cr.attempt_count,
    coalesce(
      cx.state,
      case
        when cr.correction_requested_at is null then 'none'
        when cr.correction_resolved_at is null  then 'open'
        else 'resolved'
      end
    )
  ) as standing
from data_center.v_sold_stoves v
left join data_center.call_records cr  on cr.sale_id = v.sale_id
left join data_center.option_values co on co.id      = cr.call_outcome_id
left join data_center.option_values ca on ca.id      = cr.call_agent_id
left join data_center.option_values crr on crr.id    = cr.correction_reason_id
left join lateral (
  select
    max(a.attempted_at) filter (where a.attempt_no = 1)::date as call_date_1,
    max(a.attempted_at) filter (where a.attempt_no = 2)::date as call_date_2,
    max(a.attempted_at) filter (where a.attempt_no = 3)::date as call_date_3
  from data_center.call_attempts a
  where a.sale_id = cr.sale_id
) att on true
left join lateral (
  select c.state
    from data_center.corrections c
   where c.sale_id = cr.sale_id
   order by c.seq desc
   limit 1
) cx on true;

comment on view data_center.v_call_center is
  'Table 2. Table 1 plus what the call centre added. correction_state is none, open, fixed or resolved, read from the newest correction episode. standing is record_standing() over the same facts (D41).';

-- The resolved view was written as v.* and froze its columns at creation, so
-- the new column does not flow through a replace. Dropped and recreated with
-- the same body; nothing in the schema selects from it, only the functions.
drop view if exists data_center.v_call_center_resolved;
create view data_center.v_call_center_resolved as
select v.*,

       -- A correction is only a correction when somebody typed something.
       -- nullif on the trimmed value: an agent who tabbed through a field and
       -- left a space has not corrected anything.
       coalesce(nullif(btrim(v.corrected_end_user_name), ''), v.end_user_name)
         as resolved_end_user_name,
       coalesce(nullif(btrim(v.corrected_phone), ''), v.primary_phone)
         as resolved_phone,
       coalesce(nullif(btrim(v.corrected_alt_phone), ''), v.alternative_phone)
         as resolved_alt_phone,
       coalesce(nullif(btrim(v.corrected_address), ''), v.user_residential_address)
         as resolved_address,
       coalesce(nullif(btrim(v.corrected_state), ''), v.user_state)
         as resolved_state,
       coalesce(nullif(btrim(v.corrected_lga), ''), v.user_lga)
         as resolved_lga,

       -- Whether anything was corrected at all, so a surface can mark the
       -- record without comparing six pairs of strings itself.
       (nullif(btrim(v.corrected_end_user_name), '') is not null
        or nullif(btrim(v.corrected_phone), '') is not null
        or nullif(btrim(v.corrected_alt_phone), '') is not null
        or nullif(btrim(v.corrected_address), '') is not null
        or nullif(btrim(v.corrected_state), '') is not null
        or nullif(btrim(v.corrected_lga), '') is not null) as was_corrected

  from data_center.v_call_center v;

comment on view data_center.v_call_center_resolved is
  'Table 2 with the call centre''s corrections applied: one answer to what a buyer is called and where they live. Carries standing (D41).';

grant select on data_center.v_call_center_resolved to service_role;

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
  lp.full_name as last_attempt_by,
  -- Phase 28, D41.
  data_center.record_standing(
    cr.verification_outcome,
    cr.attempt_count,
    coalesce(
      cxs.state,
      case
        when cr.correction_requested_at is null then 'none'
        when cr.correction_resolved_at is null  then 'open'
        else 'resolved'
      end
    )
  ) as standing
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
left join public.profiles lp on lp.id = la.created_by
left join lateral (
  select c.state
    from data_center.corrections c
   where c.sale_id = i.sale_id
   order by c.seq desc
   limit 1
) cxs on true;

-- Per partner, one count per standing, plus what a hand-out can draw from.
-- Live, not compute (D46): a hand-out decision needs the number as of now and
-- the table is a few thousand rows.
create or replace view data_center.v_partner_standing as
select
  v.organization_id,
  v.partner_name,
  count(*) filter (where v.standing = 'never_called')::int       as never_called,
  count(*) filter (where v.standing = 'in_progress')::int        as in_progress,
  count(*) filter (where v.standing = 'verified')::int           as verified,
  count(*) filter (where v.standing = 'partially_verified')::int as partially_verified,
  count(*) filter (where v.standing = 'unreachable')::int        as unreachable,
  count(*) filter (where v.standing = 'with_sales')::int         as with_sales,
  count(*)::int                                                  as total,
  coalesce(pool.callable, 0)::int                                as callable
from data_center.v_call_center v
left join lateral (
  select count(*) as callable
    from data_center.v_callable_records r
   where r.organization_id = v.organization_id
) pool on true
where v.is_archived is not true
group by v.organization_id, v.partner_name, pool.callable;

comment on view data_center.v_partner_standing is
  'One row per partner: how many records stand at each of the six standings, the total, and how many the pool can hand out (D46).';

grant select on data_center.v_partner_standing to service_role;

-- 3. The registry --------------------------------------------------------------
insert into data_center.option_lists (key, label, description) values
  ('record_standing', 'Where a record stands',
   'The six standings record_standing() answers. The words the surfaces use; the values are code.')
on conflict (key) do nothing;

insert into data_center.option_values (list_key, value, label, sort_order) values
  ('record_standing', 'never_called',       'New',             1),
  ('record_standing', 'in_progress',        'In progress',     2),
  ('record_standing', 'verified',           'Verified',        3),
  ('record_standing', 'partially_verified', 'Partly verified', 4),
  ('record_standing', 'unreachable',        'Unreachable',     5),
  ('record_standing', 'with_sales',         'With Sales',      6)
on conflict (list_key, value) do update
  set label = excluded.label, sort_order = excluded.sort_order, is_active = true;

-- The two outcomes the form's one save path needs (D43): a call that verified
-- the buyer, fully or partly, is an outcome like the other ten. First in the
-- list because they are what most calls end as; the ten move down two.
update data_center.option_values
   set sort_order = sort_order + 2
 where list_key = 'call_outcome'
   and value not in ('verified', 'partially_verified');

insert into data_center.option_values (list_key, value, label, sort_order) values
  ('call_outcome', 'verified',           'Verified',        0),
  ('call_outcome', 'partially_verified', 'Partly verified', 1)
on conflict (list_key, value) do update
  set label = excluded.label, sort_order = excluded.sort_order, is_active = true;

-- 4. calls.exhausted reads the configured limit ---------------------------------
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
    rule record;
  begin
    select array(select jsonb_array_elements_text(value)) into req
      from data_center.workflow_config where key = 'completeness_required_fields';

    foreach fld in array coalesce(req, '{}'::text[]) loop
      arms := arms || format($a$
        select %L as field, count(*) filter (where not (%s))::numeric as v
          from public.sales s
         where s.is_archived is not true$a$, fld, data_center.field_present_predicate(fld, 's'));
    end loop;

    -- One bucket per dated rule the module reads (slice F3a): the sales
    -- dated on or after the rule that lack the field. Keyed by the dictionary
    -- key, which is what the Missing facet and missing_predicate accept.
    for rule in
      select field_key, table_name, column_name, mandatory_from
        from public.sale_field_rules
       where 'data_center' = any(applies_to) and mandatory_from is not null
       order by mandatory_from, field_key
    loop
      arms := arms || format($a$
        select %L as field, count(*) filter (where not (coalesce(s.sales_date::date, current_date) < %L or %s))::numeric as v
          from public.sales s
         where s.is_archived is not true$a$,
        rule.field_key, rule.mandatory_from::text,
        data_center.field_present_predicate(rule.column_name, 's', rule.table_name));
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
     where cr.attempt_count >= coalesce((select (value #>> '{}')::int from data_center.workflow_config
                                          where key = 'callback_limit'), 3)
       and cr.verification_outcome = 'not_verified'
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

-- 5. Readback ------------------------------------------------------------------
do $$
declare
  r record;
  msg text := '';
begin
  for r in
    select standing, count(*)::int as n
      from data_center.v_call_center
     where is_archived is not true
     group by 1 order by 1
  loop
    msg := msg || format('%s=%s ', r.standing, r.n);
  end loop;
  raise notice 'record_standing: %', msg;
  raise notice 'partners with a standing row: %', (select count(*) from data_center.v_partner_standing);
  raise notice 'call_outcome rows: %', (select string_agg(value, ',' order by sort_order) from data_center.option_values where list_key = 'call_outcome');
end $$;
