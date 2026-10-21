-- Undo 20261022090000_create_sale_in_one_transaction.
-- Run ONLY after create-sale has been redeployed from a commit that does not
-- call create_sale_tx; the current create-sale cannot save a sale without it.
-- The ledger row stays, so a later fix returns as a new migration.

set local lock_timeout = '5s';
drop function if exists public.create_sale_tx(jsonb, jsonb, jsonb);
drop function if exists public._insert_row_from_json(regclass, jsonb);
