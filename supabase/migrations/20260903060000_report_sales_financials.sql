-- ===========================================================================
-- Sales Records at scale: the totals, the due buckets and the years come
-- from SQL, over the same filters and the same scope as the rows.
--
-- Slice 9a of the 2026-09-02 review (finding F6). Sales Records and the
-- Financial Report loaded at most 500 sales into the browser and did
-- everything there: search, every filter, the sort, the paging, the money
-- totals, the payment-status counts and the "due in 30 days / overdue" chips.
-- Past five hundred sales every one of those was computed over the first
-- five hundred and shown as if it were the whole. Production passed that
-- mark months ago.
--
-- This function answers the questions that are not a page of rows: how many
-- match, what they add up to, how many are fully, partly and not yet paid,
-- how many fall due in each window, which years the scope covers and which
-- partners it holds. It takes exactly the filters get-sales-advanced applies
-- to the rows, so the number at the top and the rows beneath it never
-- disagree, and it takes the caller's scope as data (organisations, the
-- agent's own attribution, a manager's team) because the scope is decided in
-- the function that already decides it, not here.
--
-- THE DUE DATE is the rule the edge function has always applied per row: an
-- instalment sale's next payment falls one month per instalment already paid
-- after the sale date, the count of payments capped by the model's duration;
-- a sale settled ahead of schedule has no next date; a sale with nothing owed
-- has none either. Days are counted in the business's calendar, Lagos. Where
-- a due chip is asked for, the function pages that population itself in due
-- order and returns the page's ids, so the chip is a server filter rather
-- than a filter over whatever rows happened to be loaded.
--
-- ACCESS. Service role only; get-sales-advanced calls it with the scope it
-- computed for the signed-in user.
-- ===========================================================================

create or replace function public.report_sales_financials(
  p_organization_ids uuid[] default null,
  p_agent_ids uuid[] default null,
  p_team_ids uuid[] default null,
  p_scope_empty boolean default false,
  p_search text default null,
  p_states text[] default null,
  p_lgas text[] default null,
  p_payment_model_id uuid default null,
  p_payment_status text default null,
  p_agent_approved boolean default null,
  p_is_installment boolean default null,
  p_date_from date default null,
  p_date_to date default null,
  p_periods jsonb default null,
  p_show_archived boolean default false,
  p_bucket text default null,
  p_page integer default 1,
  p_limit integer default 50
)
returns jsonb
language sql
stable
parallel safe
set search_path to 'public'
as $$
with scoped as (
  select s.id, s.sales_date, s.created_at, s.amount, s.total_paid, s.is_installment,
         s.payment_status, s.payment_model_id, s.organization_id, s.partner_name,
         s.contact_person, s.end_user_name, s.aka, s.phone, s.other_phone,
         s.stove_serial_no, s.contact_phone, s.state_backup, s.lga_backup, s.agent_approved
    from public.sales s
   where (case when p_show_archived then s.is_archived is true else s.is_archived is not true end)
     and not p_scope_empty
     and (
           (p_organization_ids is null and p_agent_ids is null and p_team_ids is null)
        or s.organization_id = any(p_organization_ids)
        or s.created_by = any(p_agent_ids)
        or s.sold_on_behalf_of = any(p_agent_ids)
        or s.sold_on_behalf_of = any(p_team_ids)
        or s.created_by = any(p_team_ids)
         )
),
filtered as (
  select s.*
    from scoped s
   where (p_search is null or btrim(p_search) = '' or (
             s.contact_person ilike '%' || p_search || '%'
          or s.end_user_name ilike '%' || p_search || '%'
          or s.aka ilike '%' || p_search || '%'
          or s.phone ilike '%' || p_search || '%'
          or s.other_phone ilike '%' || p_search || '%'
          or s.stove_serial_no ilike '%' || p_search || '%'
          or s.partner_name ilike '%' || p_search || '%'
          or s.contact_phone ilike '%' || p_search || '%'))
     and (p_states is null or s.state_backup = any(p_states))
     and (p_lgas is null or s.lga_backup = any(p_lgas))
     and (p_payment_model_id is null or s.payment_model_id = p_payment_model_id)
     and (p_agent_approved is null or coalesce(s.agent_approved, false) = p_agent_approved)
     and (p_is_installment is null or coalesce(s.is_installment, false) = p_is_installment)
     and (p_payment_status is null
          or (p_payment_status = 'paid' and (s.is_installment is not true or s.payment_status = 'fully_paid'))
          or (p_payment_status = 'partial' and s.is_installment and s.payment_status = 'partially_paid')
          or (p_payment_status = 'unpaid' and s.is_installment and coalesce(s.total_paid, 0) = 0))
     and (p_date_from is null or s.sales_date >= p_date_from)
     and (p_date_to is null or s.sales_date <= p_date_to)
     and (p_periods is null or jsonb_typeof(p_periods) <> 'array' or jsonb_array_length(p_periods) = 0
          or exists (select 1 from jsonb_array_elements(p_periods) p
                      where s.sales_date >= (p->>'from')::date and s.sales_date < (p->>'to')::date))
),
due as (
  select f.*,
         coalesce(pm.duration_months, 1) as total_inst,
         coalesce(pc.n, 0) as pay_count,
         (f.payment_status = 'fully_paid'
          or (coalesce(f.amount, 0) > 0 and coalesce(f.total_paid, 0) >= coalesce(f.amount, 0))) as settled,
         greatest(coalesce(f.amount, 0) - coalesce(f.total_paid, 0), 0) as balance,
         (now() at time zone 'Africa/Lagos')::date as today
    from filtered f
    left join public.payment_models pm on pm.id = f.payment_model_id
    left join (select sale_id, count(*)::integer as n from public.installment_payments group by sale_id) pc
           on pc.sale_id = f.id
),
dated as (
  select d.*,
         case when d.is_installment and not d.settled and d.balance > 0
               and (d.total_inst - least(d.pay_count, d.total_inst)) > 0
              then (coalesce(d.sales_date, (d.created_at at time zone 'Africa/Lagos')::date)
                    + make_interval(months => least(d.pay_count, d.total_inst)))::date
         end as next_due
    from due d
),
bucketed as (
  select x.*, (x.next_due - x.today) as days from dated x
),
matched as (
  select b.*
    from bucketed b
   where p_bucket is null
      or (p_bucket = 'overdue'  and b.days < 0)
      or (p_bucket = 'dueToday' and b.days = 0)
      or (p_bucket = 'due7'     and b.days between 0 and 7)
      or (p_bucket = 'due14'    and b.days between 0 and 14)
      or (p_bucket = 'due30'    and b.days between 0 and 30)
)
select jsonb_build_object(
  'total',          (select count(*) from filtered),
  'receivable',     (select coalesce(sum(amount), 0) from filtered),
  'collected',      (select coalesce(sum(total_paid), 0) from filtered),
  'outstanding',    (select coalesce(sum(amount), 0) - coalesce(sum(total_paid), 0) from filtered),
  'fully_paid',     (select count(*) from filtered where is_installment is not true or payment_status = 'fully_paid'),
  'partially_paid', (select count(*) from filtered where is_installment and payment_status = 'partially_paid'),
  'unpaid',         (select count(*) from filtered where is_installment and coalesce(total_paid, 0) = 0),
  'due', jsonb_build_object(
    'overdue',  (select count(*) from bucketed where days < 0),
    'dueToday', (select count(*) from bucketed where days = 0),
    'due7',     (select count(*) from bucketed where days between 0 and 7),
    'due14',    (select count(*) from bucketed where days between 0 and 14),
    'due30',    (select count(*) from bucketed where days between 0 and 30)),
  'years', (select coalesce(jsonb_agg(y order by y), '[]'::jsonb)
              from (select distinct extract(year from coalesce(sales_date, (created_at at time zone 'Africa/Lagos')::date))::integer as y
                      from scoped) ys),
  'partners', (select coalesce(jsonb_agg(jsonb_build_object('id', organization_id, 'partner_name', partner_name)
                                         order by partner_name), '[]'::jsonb)
                 from (select organization_id, min(partner_name) as partner_name
                         from scoped where organization_id is not null
                        group by organization_id order by 2 limit 500) ps),
  'bucket_total', case when p_bucket is null then null else (select count(*) from matched) end,
  'bucket_ids',   case when p_bucket is null then null else
                    (select coalesce(jsonb_agg(id order by ord), '[]'::jsonb)
                       from (select id, row_number() over (order by next_due, id) as ord
                               from matched
                              order by next_due, id
                             offset greatest(coalesce(p_page, 1) - 1, 0) * greatest(coalesce(p_limit, 50), 1)
                              limit greatest(coalesce(p_limit, 50), 1)) pg) end
);
$$;

comment on function public.report_sales_financials(uuid[], uuid[], uuid[], boolean, text, text[], text[], uuid, text, boolean, boolean, date, date, jsonb, boolean, text, integer, integer) is
  'Totals, payment-status counts, due windows, years and partners over live sales for one scope and the same filters get-sales-advanced applies to the rows; pages a due window in due order when asked. Slice 9a of the 2026-09-02 review.';

revoke all on function public.report_sales_financials(uuid[], uuid[], uuid[], boolean, text, text[], text[], uuid, text, boolean, boolean, date, date, jsonb, boolean, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.report_sales_financials(uuid[], uuid[], uuid[], boolean, text, text[], text[], uuid, text, boolean, boolean, date, date, jsonb, boolean, text, integer, integer)
  to service_role;
