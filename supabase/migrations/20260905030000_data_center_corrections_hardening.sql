-- ===========================================================================
-- Corrections: what the review of slice 1 found
-- ===========================================================================
--
-- Two things a second pair of eyes saw in 20260905010000 once it was live.
--
-- 1. Two opens at once both succeeded. openCorrection() read the newest
--    episode, then inserted with max(seq) + 1, so under read committed the
--    loser got seq + 1 rather than a refusal, and a sale carried two open
--    episodes. A partial unique index says it in the database: one live
--    episode per sale, whatever the callers do.
--
-- 2. v_corrections joined a stove to its transfer without bounding the join.
--    A serial that appears in two transfers doubled the episode in the list,
--    the tab counts and the banner. routeFor() already bounds the same join
--    with limit 1; the view does now.
--
-- Rollback:
--   drop index if exists data_center.corrections_one_live_per_sale;
--   re-create v_corrections from 20260905010000.
-- ===========================================================================

create unique index if not exists corrections_one_live_per_sale
  on data_center.corrections (sale_id)
  where state in ('open', 'fixed');

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
left join lateral (
  select f.transfer_id, f.transaction_id, f.partner_name, f.sales_rep, f.organization_id
    from data_center.v_transfer_stoves b
    join data_center.transfer_funnel f on f.transfer_id = b.transfer_id
   where b.stove_id = upper(trim(s.stove_serial_no))
   order by f.transfer_date desc nulls last
   limit 1
) f on true
left join data_center.sales_rep_accounts ra on ra.rep_key = lower(trim(f.sales_rep))
left join public.profiles rp on rp.id = coalesce(c.routed_rep_user_id, ra.user_id, ra.delegate_user_id);

comment on view data_center.v_corrections is
  'Every correction episode with its route, its people and the sale it belongs to. One transfer per stove, the newest, so a serial in two transfers is one row.';
