-- ===========================================================================
-- The transfer remembers the sales model the ERP named for it (D19, D28;
-- slice F2b). Host lane: three additive columns on public.stove_transfer_history.
--
-- The ERP CSV names an "Order Sales Model" per consignment. Until now the
-- sync turned it into a partner entitlement and dropped it, so nothing could
-- say which model a stove was sent out under. Both syncs now write it here,
-- as the name and duration the ERP sent and, when the name resolves, the
-- payment model it is. Past transfers cannot be backfilled: the CSVs were
-- not kept. The workbench says "not sent with this transfer" for those.
-- ===========================================================================

alter table public.stove_transfer_history
  add column if not exists order_payment_model_id uuid references public.payment_models (id) on delete set null,
  add column if not exists order_sales_model_name text,
  add column if not exists order_sales_model_duration integer;

comment on column public.stove_transfer_history.order_payment_model_id is 'The payment model the ERP''s Order Sales Model resolved to at sync time; null when it named no model or the name matched none.';
comment on column public.stove_transfer_history.order_sales_model_name is 'The Order Sales Model exactly as the ERP sent it.';
comment on column public.stove_transfer_history.order_sales_model_duration is 'The Order Sales Model duration in months as the ERP sent it.';

create index if not exists stove_transfer_history_order_model_idx
  on public.stove_transfer_history (order_payment_model_id)
  where order_payment_model_id is not null;
