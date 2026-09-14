-- The dashboard's figures, all dated the same way.
--
-- WHAT IS WRONG
--
-- 20260829120000 gave the scorecards a period. It did not give one to the
-- other seven families this page reads, so selecting a period left the page
-- half-narrowed: Issued answered for 2026 while Sold, Verified, the four bar
-- charts and every support card dropped to zero. Not stale, not slow: absent,
-- because the read query keeps only rows carrying a period in range and those
-- families carry none.
--
-- Measured on production before writing this:
--
--   scorecard.*   733 rows   all periodised
--   analysis.*  1,698 rows   all periodised
--   sales.*        11 rows   NONE periodised   <- Sold, the three bar charts
--   verification.*  1 row    NONE              <- Verified
--   stock.*         2 rows   NONE              <- the Stock chart
--   calls.*         4 rows   NONE              <- three support cards
--   corrections.*   3 rows   NONE              <- one support card
--   import.*        3 rows   NONE              <- one support card
--
-- WHICH DATE
--
-- The page states its own rule, in Dashboard.jsx next to the control: the noun
-- is "consignments" and the period dates a figure by WHEN THE STOVE WAS SOLD TO
-- THE PARTNER, never when the record reached this app. The scorecards already
-- obey it. This makes the rest obey it too, so the whole page describes one
-- population instead of two.
--
-- The alternative was to date each family by its own event, so Sold would mean
-- "sold to an end user in August". That reads reasonably until you put it next
-- to Issued: the row would compare a count of one cohort against a count of a
-- different one, and the hint under Sold ("x% of what was transferred") would
-- be a ratio across two populations. Checked against production, both datings
-- agree on all 19 live sales today (July consignment -> July sale, August ->
-- August), so this choice costs nothing now and is the one that stays correct
-- when they diverge.
--
-- WHAT DOES NOT GET A PERIOD, DELIBERATELY
--
-- The read query SUMS the months in a range. Two consequences:
--
--   calls.avg_attempts and corrections.avg_days_to_resolve are averages. A sum
--   of monthly averages is not an average of anything, so periodising them
--   would produce a number that is wrong rather than narrow.
--
--   import.* counts the bench's own work. A batch spans many consignments, so
--   there is no cohort to date it by without inventing one.
--
-- These five stay all-time and say so on the card. The read function passes any
-- family with no dated row through a range untouched, so they keep answering
-- instead of vanishing, and the UI marks them "all time" so a reader is never
-- told that a narrowed page holds an unnarrowed number.

-- ===========================================================================
-- 1. One definition of "which consignment period does this belong to"
-- ===========================================================================
--
-- Written once as two views rather than repeated in the eleven places below.
-- The join it replaces is three tables deep and has two ways to fan out, and
-- an inlined copy that got one of them wrong would overcount silently.

/*
 * A consignment's month.
 *
 * Grouped by transaction_id rather than selected per row, so a duplicated
 * transaction id yields ONE period instead of duplicating everything joined to
 * it. The reconciliation removed both duplicates that existed, and the unique
 * index that would prevent new ones is still Phase 4 work, so this holds the
 * line until it lands.
 */
create or replace view data_center.v_consignment_period as
select h.transaction_id,
       to_char(min(h.sales_date), 'YYYY-MM') as period
  from public.stove_transfer_history h
 where h.sales_date is not null
 group by h.transaction_id;

comment on view data_center.v_consignment_period is
  'The month a consignment was sold to the partner, one row per transaction id. The single definition of the period every Data Center dashboard figure is dated by.';

/*
 * A sale's consignment month, via the stock row it sold.
 *
 * Joined on stove_ids_base.sale_id, the real foreign key, rather than by
 * matching stove_serial_no as text. Both were checked against production and
 * agree on all 19 live sales, but the key is indexed and case-exact while the
 * text match needs upper(btrim(...)) on both sides, which no index can serve.
 * On 19 sales that is invisible; at the 500,000 this module is sized for it is
 * a full scan of stock per sale.
 *
 * The lateral with limit 1 is still doing real work. One stove ID exists as two
 * stock rows at two different partners, awaiting a decision on where the stove
 * actually is, and the day both rows point at one sale a plain join would count
 * that sale twice in every metric below. One row per sale, whatever stock says.
 */
create or replace view data_center.v_sale_period as
select s.id as sale_id, x.period
  from public.sales s
  left join lateral (
    select cp.period
      from public.stove_ids_base b
      join data_center.v_consignment_period cp on cp.transaction_id = b.sales_reference
     where b.sale_id = s.id
     order by cp.period
     limit 1
  ) x on true;

comment on view data_center.v_sale_period is
  'The consignment month behind each sale: sale -> stove -> consignment -> its sold-to-partner date. One row per sale even where a stove ID is duplicated in stock.';

revoke all on data_center.v_consignment_period from "anon", "authenticated";
revoke all on data_center.v_sale_period          from "anon", "authenticated";
grant select on data_center.v_consignment_period to "service_role";
grant select on data_center.v_sale_period        to "service_role";

-- ===========================================================================
-- 2. compute_metrics, with every cohort-able family dated
-- ===========================================================================
--
-- Replaced whole rather than patched family by family: the eleven inserts read
-- as one list, and a reader needs to see which carry a period and which
-- deliberately do not without diffing against a previous version.
--
-- Everything not about dating is what it was.

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
  insert into data_center.metric_snapshots (run_id, metric_key, dimension, value_num)
  select p_run_id, k, jsonb_build_object('period', period), v from (
    select p.period, 'corrections.open' k, count(*)::numeric v
      from data_center.call_records cr
      left join data_center.v_sale_period p on p.sale_id = cr.sale_id
     where cr.correction_requested_at is not null and cr.correction_resolved_at is null
     group by 1
    union all
    select p.period, 'corrections.resolved', count(*)::numeric
      from data_center.call_records cr
      left join data_center.v_sale_period p on p.sale_id = cr.sale_id
     where cr.correction_resolved_at is not null
     group by 1
    union all
    select null::text, z.k, 0::numeric
      from (values ('corrections.open'), ('corrections.resolved')) as z(k)
  ) t;
  get diagnostics n = row_count; written := written + n;

  -- An average, so all-time for the same reason as calls.avg_attempts.
  insert into data_center.metric_snapshots (run_id, metric_key, dimension, value_num)
  select p_run_id, 'corrections.avg_days_to_resolve', '{}'::jsonb,
         round(coalesce(avg(extract(epoch from (correction_resolved_at - correction_requested_at)) / 86400), 0), 2)
    from data_center.call_records where correction_resolved_at is not null;
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
  'Writes the dashboard metric families for one run. Every family belonging to a consignment carries a period at month grain, dated by when the stove was sold to the partner; the two averages and the three import counters carry none, because a sum of averages is not an average and a batch has no consignment.';
