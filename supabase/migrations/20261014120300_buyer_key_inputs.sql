-- Phone number and buyer rule, Phase 3: what the phone app's buyer keys are
-- built from.
--
-- Plan: docs/plans/phone-and-buyer-rule.md.
--
-- public.buyer_key_inputs()
--   The phone and the name parts of every live sale the CALLER may read, as
--   one JSON array of [phone, first name, surname, joined name]. The function
--   get-end-user-phones calls it with the caller's own login and turns each
--   entry into a buyer key (_shared/buyerKey.ts), so the phone app can tell
--   offline that the same customer is being entered again.
--
--   Security invoker: the caller's row rules on public.sales decide which
--   sales are included, exactly as for visible_sales_on_phone. A repeat on a
--   sale the caller cannot read is still refused by create-sale at sync.
--
--   One row, one round trip: a JSON aggregate is not cut at PostgREST's row
--   cap, so the function needs no paging (5,740 live sales on 2026-10-14).

set lock_timeout = '5s';

create or replace function public.buyer_key_inputs()
returns json
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(
    json_agg(json_build_array(s.phone, s.end_user_first_name, s.end_user_surname, s.end_user_name)),
    '[]'::json
  )
  from public.sales s
  where s.phone is not null
    and s.is_archived is not true;
$$;

comment on function public.buyer_key_inputs() is
  'Phone and name parts of every live sale the caller may read (security invoker, row rules apply), as one JSON array. get-end-user-phones turns them into buyer keys. Phone and buyer rule, docs/plans/phone-and-buyer-rule.md.';

revoke all on function public.buyer_key_inputs() from public, anon;
grant execute on function public.buyer_key_inputs() to authenticated, service_role;

-- Proof it landed (expect: invoker = true, anon = false, authenticated = true):
--   select not p.prosecdef as invoker,
--          has_function_privilege('anon', p.oid, 'execute') as anon,
--          has_function_privilege('authenticated', p.oid, 'execute') as authenticated
--     from pg_proc p where p.proname = 'buyer_key_inputs';
