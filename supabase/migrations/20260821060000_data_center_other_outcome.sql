-- ===========================================================================
-- The outcome that was missing: "Something else"
--
-- The nine seeded call outcomes came from the workbook's Key tab, and the Key
-- tab is a closed list. The July data proves the list is not closed in
-- practice: RESPONDED, REPONDED and NO PHONE NUMBER were typed straight into a
-- column meant to be constrained, because an agent who hits something the list
-- does not cover has nowhere to put it.
--
-- Giving them somewhere to put it is what stops the next three inventions.
-- `call_attempts.note` already exists and already stores free text, so this is
-- one row of data plus the wording in the editor that asks for the note when
-- this outcome is chosen. There is no new column, because there was never a
-- missing column.
--
-- Rollback:
--   delete from data_center.option_values
--    where list_key = 'call_outcome' and value = 'other';
-- ===========================================================================

insert into data_center.option_values (list_key, value, label, sort_order)
values ('call_outcome', 'other', 'Something else (say what)', 10)
on conflict (list_key, value) do update
  set label = excluded.label, sort_order = excluded.sort_order, is_active = true;
