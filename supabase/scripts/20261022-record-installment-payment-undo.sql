-- Undo 20261022100000_record_installment_payment.
-- Run ONLY after installment-payments has been redeployed from a commit that
-- does not call record_installment_payment. The ledger row stays.

set local lock_timeout = '5s';
drop function if exists public.record_installment_payment(uuid, numeric, text, uuid, date, uuid, text, text);
