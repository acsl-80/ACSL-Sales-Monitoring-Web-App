-- ===========================================================================
-- A level for somebody who only owes an answer
-- ===========================================================================
--
-- Records come back from the call centre asking the sales rep who moved that
-- consignment a question: the phone number does not work, the stove ID does
-- not match, this looks like a duplicate. The rep has to be able to see the
-- question and answer it.
--
-- The tempting shortcut is to give them `viewer`, which is the smallest level
-- that already exists. It is not small: viewer carries records.view,
-- call_records.view and dashboard.view, so making eleven records answerable
-- would hand somebody every sold stove record in their scope and the whole
-- dashboard with it.
--
-- `sales_rep` carries one key, `corrections.fix`, and what that key can see is
-- narrowed again at read time to send-backs routed to this person. One rep
-- learns nothing about another rep's stoves.
--
-- Rollback:
--   update data_center.module_access set access_role = 'viewer'
--    where access_role = 'sales_rep';
--   alter table data_center.module_access
--     drop constraint module_access_access_role_check,
--     add constraint module_access_access_role_check
--       check (access_role in ('viewer','editor','call_agent','data_manager'));
-- ===========================================================================

alter table data_center.module_access
  drop constraint if exists module_access_access_role_check;

alter table data_center.module_access
  add constraint module_access_access_role_check
  check (access_role in ('viewer', 'editor', 'call_agent', 'data_manager', 'sales_rep'));

comment on column data_center.module_access.access_role is
  'viewer reads; call_agent works the phone; editor types and imports; data_manager runs the module; sales_rep answers the send-backs from their own consignments and sees nothing else. The server holds the feature list in _shared/data-center-roles.ts and is the authority.';


-- ---------------------------------------------------------------------------
-- While we are here: the module says Stove ID everywhere else
-- ---------------------------------------------------------------------------
--
-- This is the label a call agent picks when the number on the stove does not
-- match the record, and it is the one place left calling it a serial.

update data_center.option_values
   set label = 'Stove ID does not match'
 where list_key = 'correction_reason'
   and value = 'wrong_serial'
   and label <> 'Stove ID does not match';
