-- Phase 28, S2: a client key per attempt, so a lost response and a second
-- press of Save call cannot log the same call twice (D42). Nullable: the
-- import and the repair write none; the form mints one when an outcome is
-- picked and sends it with the save.
alter table data_center.call_attempts
  add column if not exists client_key uuid;

create unique index if not exists call_attempts_client_key_uniq
  on data_center.call_attempts (sale_id, client_key)
  where client_key is not null;

comment on column data_center.call_attempts.client_key is
  'Minted by the call form when an outcome is picked and sent with Save call. The same key on the same sale writes one attempt, however many times the save is sent (D42).';

select count(*)::int as with_key from data_center.call_attempts where client_key is not null;
