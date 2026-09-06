-- ===========================================================================
-- The field alignment's go-live is 11 September 2026, not the 8th.
--
-- His word of 2026-09-06: brain-codes have until 11 September to ship the
-- phone app's new fields, so the six rows that become mandatory at go-live
-- move to that day, and the rule and the deadline are the same day. Only rows
-- still on the seeded date move: a date already moved in Settings stays.
-- Host lane on his word (a data change on public.sale_field_rules).
-- ===========================================================================

update public.sale_field_rules
   set mandatory_from = date '2026-09-11',
       note = coalesce(note, '') || ' Go-live moved to 2026-09-11 on 2026-09-06.'
 where mandatory_from = date '2026-09-08'
   and field_key in ('end_user_surname', 'end_user_first_name', 'city', 'sales_agent_name', 'previous_stove_type', 'terms_accepted');
