-- Phase 23a: stock ageing counted three stoves twice.
--
-- `analysis.stock_age` joined public.stove_transfer_history on
-- transaction_id = sales_reference to reach a date fallback and a state.
-- transaction_id has no unique constraint and two are duplicated in
-- production, so every stove on those references fanned out and was counted
-- once per matching transfer.
--
-- Measured: the bands summed to 15,481 against 15,478 stoves actually in
-- stock. Small, and wrong in the direction that matters - the whole point of
-- this metric is to be trusted about how much is sitting where.
--
-- The join bought nothing. Zero stock rows lack transfer_sales_date, zero have
-- a transfer state differing from the partner's, and zero transfers carry a
-- null state. Removing it also removes a fallback to transfer_date, which is
-- when a record reached this app rather than when the ERP transferred the
-- stove, and is the wrong date to age against by up to eighteen months.
--
-- Only `aged` changes. The other four metrics in this function were never
-- affected: they join organizations and sales by primary key, and call_records
-- by its own primary key, none of which can fan out.

create or replace function data_center.compute_analysis(p_run_id uuid)
returns integer
language plpgsql
security definer
set search_path = data_center, public, pg_temp
as $$
declare
  written integer := 0;
  n integer;
  v_tz text;
  v_window integer;
  complete_pred text;
  creditable_pred text;
  k text;
begin
  select coalesce(w.value #>> '{}', 'Africa/Lagos') into v_tz
    from data_center.workflow_config w where w.key = 'analysis.timezone';
  v_tz := coalesce(v_tz, 'Africa/Lagos');

  select coalesce((w.value #>> '{}')::int, 30) into v_window
    from data_center.workflow_config w where w.key = 'analysis.absorption_window_days';
  v_window := coalesce(v_window, 30);

  -- Refuse to run rather than silently drop the oldest stock. Without an open
  -- top band every stove past the last stated edge matches no band and
  -- disappears from a chart whose entire purpose is to find exactly those.
  foreach k in array array['analysis.stock_age_buckets', 'analysis.velocity_buckets'] loop
    if not exists (select 1 from data_center.age_bands(k) where max_days is null) then
      raise exception
        '% has no open top band (max null); the far end of the distribution would be dropped silently', k;
    end if;
  end loop;

  -- =========================================================================
  -- 1. Stock ageing: unsold stock sitting at a partner, by how long.
  --
  -- The population is deliberately narrow and must be described as such on the
  -- chart: stock TRANSFERRED to a partner and not yet sold. Stock that never
  -- left ACSL has no sales_reference and is excluded, so an empty top band
  -- means "no old stock at partners", not "no old stock".
  --
  -- Filed under its TRANSFER month, so narrowing to 2025 asks "what did we
  -- ship in 2025 that is still sitting, and how old is it now".
  --
  -- greatest(days, 0) because a transfer dated in the future would otherwise
  -- produce a negative age, match no band, and vanish - the same silent drop
  -- the open-top guard above exists to prevent, arriving from the other end.
  -- =========================================================================

  with aged as (
    -- One row per stove. The join to stove_transfer_history is gone, and its
    -- absence is the fix: transaction_id carries no unique constraint, two of
    -- them are duplicated in production, and joining on it fanned those stoves
    -- out so the bands counted 15,481 where the table holds 15,478.
    --
    -- Nothing was lost with it. Measured on production before removing it:
    -- zero stock rows lack transfer_sales_date, so the date fallback never
    -- fired; zero rows had a transfer state differing from the partner's; zero
    -- transfers carried a null state. It was three extra stoves and a
    -- dependency, in exchange for nothing.
    --
    -- The fallback was also the wrong date to want. transfer_date is when the
    -- record reached this app - April to August 2026 for every consignment -
    -- while transfer_sales_date is the ERP's date of transfer to the partner,
    -- running from February 2025. Ageing measured on the record date would
    -- have compressed eighteen months into four and reported almost everything
    -- as fresh.
    select b.organization_id,
           o.state                             as transfer_state,
           coalesce(o.partner_name, 'Unknown') as partner_name,
           b.transfer_sales_date               as transferred_on,
           -- Future-dated stock clamps to zero rather than matching no band and
           -- vanishing. Three such stoves were found and corrected at source;
           -- the clamp stays because the next one should not disappear either.
           greatest(current_date - b.transfer_sales_date, 0) as days
      from public.stove_ids_base b
      left join public.organizations o on o.id = b.organization_id
     where b.is_archived is not true
       and b.status <> 'sold'
       and b.sale_id is null
       and b.transfer_sales_date is not null
  ),
  banded as (
    select a.organization_id, a.transfer_state, a.partner_name,
           to_char(a.transferred_on, 'YYYY-MM') as period,
           k.code, k.label as band_label, k.ord as band_ord
      from aged a
      join data_center.age_bands('analysis.stock_age_buckets') k
        on a.days >= k.min_days
       and (k.max_days is null or a.days <= k.max_days)
  ),
  by_partner as (
    select 'partner'::text as by, organization_id::text as key, partner_name as label,
           code, band_label, band_ord, period, count(*)::numeric as units
      from banded group by 1, 2, 3, 4, 5, 6, 7
  ),
  by_state as (
    select 'location'::text as by,
           coalesce(transfer_state, 'Unknown') as key,
           coalesce(transfer_state, 'Unknown') as label,
           code, band_label, band_ord, period, count(*)::numeric as units
      from banded group by 1, 2, 3, 4, 5, 6, 7
  )
  insert into data_center.metric_snapshots (run_id, metric_key, dimension, value_num)
  select p_run_id, 'analysis.stock_age',
         data_center.xdim(src.by, src.key, src.label, null,
                          'age_bucket', src.code, src.band_label, src.band_ord,
                          src.period),
         src.units
    from (select * from by_partner union all select * from by_state) src;
  get diagnostics n = row_count; written := written + n;

  -- =========================================================================
  -- 2. Absorption: does this partner reliably move stock inside the window?
  --
  -- Two counts, never a rate. A stored percentage cannot be re-aggregated and
  -- cannot carry its own denominator, so "92%" of eleven units would read the
  -- same as "92%" of nine hundred. The client divides.
  -- =========================================================================

  with eligible as (
    select b.organization_id,
           coalesce(o.partner_name, 'Unknown')            as partner_name,
           to_char(b.transfer_sales_date, 'YYYY-MM')      as period,
           (b.sale_id is not null
             and s.sales_date is not null
             and (s.sales_date - b.transfer_sales_date) <= v_window) as absorbed
      from public.stove_ids_base b
      left join public.organizations o on o.id = b.organization_id
      left join public.sales s         on s.id = b.sale_id
     where b.is_archived is not true
       and b.transfer_sales_date is not null
       and b.transfer_sales_date <= current_date - v_window
  )
  insert into data_center.metric_snapshots (run_id, metric_key, dimension, value_num)
  select p_run_id, 'analysis.absorption',
         data_center.xdim('partner', g.key, g.label, null,
                          'measure', m.k, m.l, m.o, g.period),
         m.v
    from (
      select organization_id::text as key, partner_name as label, period,
             count(*)::numeric                        as eligible,
             count(*) filter (where absorbed)::numeric as within
        from eligible group by 1, 2, 3
    ) g
    cross join lateral (values
      ('eligible', 'Eligible units', 1, g.eligible),
      ('within',   'Sold in window', 2, g.within)
    ) m(k, l, o, v);
  get diagnostics n = row_count; written := written + n;

  -- =========================================================================
  -- 3. Velocity: how long a partner takes to move a stove, as a distribution.
  --
  -- Filed under the TRANSFER month, matching absorption, so both answer the
  -- same cohort question: of what we shipped in this range, how fast did it
  -- move. A median is not stored because it cannot be summed across months.
  -- =========================================================================

  with sold as (
    select b.organization_id,
           coalesce(o.partner_name, 'Unknown')       as partner_name,
           to_char(b.transfer_sales_date, 'YYYY-MM') as period,
           greatest(s.sales_date - b.transfer_sales_date, 0) as days
      from public.stove_ids_base b
      join public.sales s              on s.id = b.sale_id
      left join public.organizations o on o.id = b.organization_id
     where b.is_archived is not true
       and s.is_archived is not true
       and b.transfer_sales_date is not null
       and s.sales_date is not null
  )
  insert into data_center.metric_snapshots (run_id, metric_key, dimension, value_num)
  select p_run_id, 'analysis.velocity',
         data_center.xdim('partner', g.key, g.label, null,
                          'days_bucket', g.code, g.band_label, g.band_ord, g.period),
         g.units
    from (
      select d.organization_id::text as key, d.partner_name as label, d.period,
             k.code, k.label as band_label, k.ord as band_ord,
             count(*)::numeric as units
        from sold d
        join data_center.age_bands('analysis.velocity_buckets') k
          on d.days >= k.min_days
         and (k.max_days is null or d.days <= k.max_days)
       group by 1, 2, 3, 4, 5, 6
    ) g;
  get diagnostics n = row_count; written := written + n;

  -- =========================================================================
  -- 4 and 5. Creditable yield, and where it leaks.
  --
  -- ONE definition of creditable, built once and interpolated into both
  -- statements. If the funnel and the leak decomposition each carried their
  -- own copy they would drift, and the leak reasons would stop summing to
  -- (sold - creditable) with nothing to say so.
  --
  -- Verified alone is not usable data. A record also has to be complete on the
  -- module's own definition (never sales.status, which still demands a photo
  -- the form dropped), have its stove ID confirmed, not be flagged as a second
  -- Save80 in the same household, not be waiting on a correction, and not
  -- share a phone number with another sale nobody has confirmed.
  --
  -- Filed under the SALE month. A sale with no sales_date falls back to
  -- created_at rather than to a null period, because a record with no month
  -- would sit outside every range anybody could select and would therefore be
  -- invisible in exactly the way this module is not allowed to be.
  -- =========================================================================

  complete_pred := data_center.completeness_predicate('s');

  creditable_pred := format($c$(
        cr.verification_outcome = 'fully_verified'
    and %1$s
    and cr.serial_unconfirmed_at is null
    and coalesce(cr.answers ->> 'double_counting', 'only_stove') = 'only_stove'
    and (cr.correction_requested_at is null or cr.correction_resolved_at is not null)
    and not exists (select 1 from data_center.shared_phones sp
                     where sp.sale_id = s.id and sp.confirmed is false))$c$,
    complete_pred);

  -- The chain is monotonically non-increasing by construction, because each
  -- stage's filter contains the one before it. That property is what makes it
  -- a funnel rather than five unrelated counts, and the e2e spec asserts it.
  execute format($q$
    insert into data_center.metric_snapshots (run_id, metric_key, dimension, value_num)
    select $1, 'analysis.yield_funnel',
           data_center.xdim('partner', g.key, g.label, null,
                            'stage', m.k, m.l, m.o, g.period),
           m.v
      from (
        select s.organization_id::text             as key,
               coalesce(o.partner_name, 'Unknown') as label,
               to_char(coalesce(s.sales_date, s.created_at::date), 'YYYY-MM') as period,
               count(*)::numeric                                    as sold,
               count(*) filter (where cr.attempt_count > 0)::numeric as called,
               count(*) filter (where cr.verification_outcome = 'fully_verified')::numeric
                 as verified,
               count(*) filter (where cr.verification_outcome = 'fully_verified'
                                  and %1$s)::numeric                 as complete,
               count(*) filter (where %2$s)::numeric                 as creditable
          from public.sales s
          left join public.organizations o      on o.id = s.organization_id
          left join data_center.call_records cr on cr.sale_id = s.id
         where s.is_archived is not true
         group by 1, 2, 3
      ) g
      cross join lateral (values
        ('sold',       'Sold',                  1, g.sold),
        ('called',     'Called',                2, g.called),
        ('verified',   'Verified',              3, g.verified),
        ('complete',   'Verified and complete', 4, g.complete),
        ('creditable', 'Creditable',            5, g.creditable)
      ) m(k, l, o, v)
  $q$, complete_pred, creditable_pred) using p_run_id;
  get diagnostics n = row_count; written := written + n;

  -- Every non-creditable sale is charged to exactly ONE reason, the first gate
  -- it failed, so the reasons sum to (sold - creditable). Overlapping tags
  -- would let one record appear under three headings and turn a decomposition
  -- into a word cloud. correction_open is tested first because it names what
  -- is already being done about the record, whatever else is also wrong.
  --
  -- never_called is tested BEFORE not_verified, and the order is load-bearing
  -- rather than arbitrary. `not_verified` is the column's DEFAULT, so a record
  -- created the moment an agent opened it carries that value having never been
  -- dialled. Only attempt_count separates "we rang and got nowhere" from "we
  -- have not rung". Reversing these two would report the call centre as having
  -- failed on work it has not yet been given, which is the opposite of the
  -- truth and would be read as an agent performance problem.
  --
  -- The filter is `coalesce(..., false) is not true`, not `not (...)`. A sale
  -- with no call record makes the creditable expression NULL, and `not NULL`
  -- is NULL, which would have quietly excluded every never-called record from
  -- the chart whose whole job is to show them.
  execute format($q$
    insert into data_center.metric_snapshots (run_id, metric_key, dimension, value_num)
    select $1, 'analysis.yield_leak',
           data_center.xdim('partner', g.key, g.label, null,
                            'reason', g.reason, r.label, r.ord, g.period),
           g.records
      from (
        select s.organization_id::text             as key,
               coalesce(o.partner_name, 'Unknown') as label,
               to_char(coalesce(s.sales_date, s.created_at::date), 'YYYY-MM') as period,
               case
                 when cr.correction_requested_at is not null
                      and cr.correction_resolved_at is null      then 'correction_open'
                 when cr.sale_id is null
                      or coalesce(cr.attempt_count, 0) = 0       then 'never_called'
                 when cr.verification_outcome = 'unreachable'    then 'unreachable'
                 when cr.verification_outcome = 'not_verified'   then 'not_verified'
                 when cr.verification_outcome = 'partially_verified'
                                                                 then 'partially_verified'
                 when not (%1$s)                                 then 'incomplete'
                 when cr.serial_unconfirmed_at is not null       then 'serial_unconfirmed'
                 when coalesce(cr.answers ->> 'double_counting', 'only_stove') <> 'only_stove'
                                                                 then 'double_counted'
                 when exists (select 1 from data_center.shared_phones sp
                               where sp.sale_id = s.id and sp.confirmed is false)
                                                                 then 'shared_phone'
                 else 'other'
               end                                 as reason,
               count(*)::numeric                   as records
          from public.sales s
          left join public.organizations o      on o.id = s.organization_id
          left join data_center.call_records cr on cr.sale_id = s.id
         where s.is_archived is not true
           and coalesce(%2$s, false) is not true
         group by 1, 2, 3, 4
      ) g
      join (values
        ('correction_open',    'Sent back for correction',        1),
        ('never_called',       'Never called',                    2),
        ('unreachable',        'Unreachable',                     3),
        ('not_verified',       'Called, not verified',            4),
        ('partially_verified', 'Partially verified',              5),
        ('incomplete',         'Verified but incomplete',         6),
        ('serial_unconfirmed', 'Stove ID not confirmed',          7),
        ('double_counted',     'Another Save80 in the household', 8),
        ('shared_phone',       'Phone shared, unconfirmed',       9),
        ('other',              'Something else',                 10)
      ) r(code, label, ord) on r.code = g.reason
  $q$, complete_pred, creditable_pred) using p_run_id;
  get diagnostics n = row_count; written := written + n;

  return written;
end;
$$;
