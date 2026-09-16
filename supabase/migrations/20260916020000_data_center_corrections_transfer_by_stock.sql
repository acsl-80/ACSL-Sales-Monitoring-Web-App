-- Phase 32, slice 2 (2026-09-16): a correction finds its transfer without
-- reading every transfer. Decision D59.
--
-- Slice 1 took the corrections badge from twelve seconds to four by counting
-- once instead of six times. The four seconds that remain are this view's own,
-- and they are spent in one place.
--
-- `v_corrections` resolves each correction's transfer through a lateral over
-- `data_center.v_transfer_stoves`, which expands every transfer's `stove_ids`
-- JSON array into one row per stove: 23,069 rows across 794 transfers. That
-- expansion runs once per correction row, so reading 114 corrections expands
-- the same 23,069 rows 114 times, and then matches the serial as text because
-- nothing about a JSON expansion can be indexed.
--
-- The stove's own stock row already carries the answer. Every one of the
-- 23,067 stoves in stock has a `sales_reference`, 23,066 of them name a
-- transfer that exists, and `stove_ids_base.sale_id` is indexed. So the
-- transfer is one index lookup away from the sale the correction is about.
--
-- Measured on production before this was written: the two routes were compared
-- for every correction, on every column the lateral feeds (transfer id,
-- transaction id, partner name, sales rep, organisation). 114 of 114
-- identical, none different.
--
-- `routeFor` in the corrections SQL moves the same way in the same PR, because
-- it answers the same question for the send-back panel and it must not answer
-- it differently. It also gains the `order by` it never had: it took `limit 1`
-- from an unordered join, so a stove named in two transfers could route to
-- either one.
--
-- Not changed here, deliberately: `v_transfer_stoves` itself. Nineteen other
-- places read it, and it means "every stove this transfer ever named", which
-- is not the same question as "which transfer is this stove on now". Changing
-- what it means to make it faster is a different slice with a different proof.
--
-- Undo: re-create the view from 20260905030000.

create or replace view data_center.v_corrections as
select
  c.id,
  c.sale_id,
  c.seq,
  c.state,
  c.reason_id,
  ov.value                     as reason_value,
  ov.label                     as reason_label,
  c.disputed_fields,
  c.note,
  c.opened_at,
  c.opened_by,
  op.full_name                 as opened_by_name,
  c.routed_rep_key,
  c.routed_rep_user_id,
  f.sales_rep,
  coalesce(c.routed_rep_user_id, ra.user_id, ra.delegate_user_id) as current_rep_user_id,
  rp.full_name                 as rep_account_name,
  ra.no_account                as rep_marked_no_account,
  (ra.user_id is null and ra.delegate_user_id is not null) as via_delegate,
  c.assigned_to,
  asg.full_name                as assigned_to_name,
  c.claimed_at,
  c.before,
  c.after,
  c.fixed_at,
  c.fixed_by,
  fx.full_name                 as fixed_by_name,
  c.fix_note,
  c.fixed_on_behalf,
  c.reviewed_at,
  c.reviewed_by,
  rv.full_name                 as reviewed_by_name,
  c.review_note,
  c.review_outcome,
  c.attempts_at_close,
  c.reopened_from,
  s.stove_serial_no,
  s.transaction_id,
  f.organization_id,
  f.partner_name,
  f.transaction_id             as transfer_reference,
  coalesce(cr.corrected_end_user_name, s.end_user_name) as end_user_name,
  coalesce(cr.corrected_phone, s.phone)                 as phone,
  s.sales_date,
  cr.verification_outcome,
  coalesce(cr.attempt_count, 0) as attempt_count,
  cr.serial_unconfirmed_at,
  s.is_archived
from data_center.corrections c
join public.sales s on s.id = c.sale_id
left join data_center.call_records cr on cr.sale_id = c.sale_id
left join data_center.option_values ov on ov.id = c.reason_id
left join public.profiles op on op.id = c.opened_by
left join public.profiles asg on asg.id = c.assigned_to
left join public.profiles fx on fx.id = c.fixed_by
left join public.profiles rv on rv.id = c.reviewed_by
-- The transfer this sale's stove is on, by the stock row that names it, newest
-- first for the case the hardening migration of 2026-09-05 found: a serial in
-- two transfers used to double the episode.
left join lateral (
  select f.transfer_id, f.transaction_id, f.partner_name, f.sales_rep, f.organization_id
    from public.stove_ids_base sb
    join public.stove_transfer_history h on h.transaction_id = sb.sales_reference
    join data_center.transfer_funnel f on f.transfer_id = h.id
   where sb.sale_id = c.sale_id
   order by f.transfer_date desc nulls last
   limit 1
) f on true
left join data_center.sales_rep_accounts ra on ra.rep_key = lower(trim(f.sales_rep))
left join public.profiles rp on rp.id = coalesce(c.routed_rep_user_id, ra.user_id, ra.delegate_user_id);

comment on view data_center.v_corrections is
  'Corrections with the sale, the call record and the transfer they belong to (D59). The transfer comes from the stove''s own stock row rather than by expanding every transfer''s stove list, which is the same answer and an index lookup instead of a scan.';

-- Readback: the shape is unchanged, and so are the values every surface reads.
select 'corrections in the view' as what, count(*)::int as n from data_center.v_corrections
union all
select 'carrying a transfer reference', count(*)::int
  from data_center.v_corrections where transfer_reference is not null
union all
select 'carrying a sales rep', count(*)::int
  from data_center.v_corrections where sales_rep is not null
union all
select 'routed to somebody', count(*)::int
  from data_center.v_corrections where current_rep_user_id is not null
order by 1;
