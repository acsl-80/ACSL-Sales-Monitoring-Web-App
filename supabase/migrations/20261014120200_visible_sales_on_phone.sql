-- Phone number and buyer rule, Phase 2: the Sell Stove form's live check.
--
-- Plan: docs/plans/phone-and-buyer-rule.md.
--
-- public.visible_sales_on_phone(p_tail, p_exclude)
--   The live sales on one phone tail that the CALLER may read, with the names
--   the buyer key is built from. The form calls it once per typing pause and
--   compares names in the browser, so it can say "shared number" (a note) or
--   "same customer" (an error) before the seller submits.
--
--   Security invoker, on purpose: the caller's own row rules on public.sales
--   decide what comes back, so it shows nothing the caller could not already
--   read with a select on sales. It is the old browser check, made exact (the
--   index expression rather than an ilike scan) and given the names.
--   sales_sharing_phone stays server only: it reads across every partner, and
--   create-sale is the one place that rule is applied across partners.

set lock_timeout = '5s';

create or replace function public.visible_sales_on_phone(p_tail text, p_exclude uuid default null)
returns table (
  id uuid,
  transaction_id text,
  end_user_name text,
  end_user_first_name text,
  end_user_surname text
)
language sql
stable
security invoker
set search_path = public
as $$
  select s.id, s.transaction_id, s.end_user_name, s.end_user_first_name, s.end_user_surname
  from public.sales s
  where p_tail ~ '^[0-9]{10}$'
    and right(regexp_replace(coalesce(s.phone, ''), '[^0-9]', '', 'g'), 10) = p_tail
    and s.is_archived is not true
    and (p_exclude is null or s.id <> p_exclude)
  order by s.created_at
  limit 50;
$$;

comment on function public.visible_sales_on_phone(text, uuid) is
  'Live sales on one 10-digit phone tail that the caller may read (security invoker, row rules apply), with buyer names. The Sell Stove live check. Phone and buyer rule, docs/plans/phone-and-buyer-rule.md.';

revoke all on function public.visible_sales_on_phone(text, uuid) from public, anon;
grant execute on function public.visible_sales_on_phone(text, uuid) to authenticated, service_role;

-- Proof it landed (expect: invoker = true, anon = false, authenticated = true):
--   select not p.prosecdef as invoker,
--          has_function_privilege('anon', p.oid, 'execute') as anon,
--          has_function_privilege('authenticated', p.oid, 'execute') as authenticated
--     from pg_proc p where p.proname = 'visible_sales_on_phone';
