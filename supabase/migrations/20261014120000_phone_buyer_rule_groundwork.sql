-- Phone number and buyer rule, Phase 0: groundwork. No behaviour changes.
--
-- Plan: docs/plans/phone-and-buyer-rule.md. Nothing calls either object below
-- until Phase 1; this migration only puts them in place.
--
-- 1. public.sales_sharing_phone(p_tail, p_exclude)
--    The live sales on one phone tail (the last ten digits), with the names the
--    buyer key is built from. It filters on exactly the expression and the
--    predicate of idx_sales_phone_tail, so it reads the index instead of the
--    whole table, and it leaves cancelled (archived) sales out, as the rule
--    means "a live sale". create-sale and update-sale will call it as the
--    server in Phase 1, replacing an ilike scan that runs as the caller and so
--    cannot see other partners' sales.
--
--    Server only: execute is revoked from signed-in users, because it returns
--    names and numbers across every partner.
--
-- 2. data_center.shared_phones.kind
--    'shared_number' (a number shared by different names) or 'same_buyer' (the
--    same name on more than one stove, a repeat from digitisation). The default
--    keeps both existing inserts (data-center-import, data-center-write) working
--    unchanged; every existing row reads 'shared_number' until Phase 5 sets it.
--    The analysis funnel reads only `confirmed`, so crediting does not move.

set lock_timeout = '5s';

create or replace function public.sales_sharing_phone(p_tail text, p_exclude uuid default null)
returns table (
  id uuid,
  transaction_id text,
  organization_id uuid,
  phone text,
  end_user_name text,
  end_user_first_name text,
  end_user_surname text,
  created_at timestamp
)
language sql
stable
set search_path = public
as $$
  select s.id, s.transaction_id, s.organization_id, s.phone,
         s.end_user_name, s.end_user_first_name, s.end_user_surname, s.created_at
  from public.sales s
  where p_tail ~ '^[0-9]{10}$'
    and right(regexp_replace(coalesce(s.phone, ''), '[^0-9]', '', 'g'), 10) = p_tail
    and s.is_archived is not true
    and (p_exclude is null or s.id <> p_exclude)
  order by s.created_at
  limit 200;
$$;

comment on function public.sales_sharing_phone(text, uuid) is
  'Live (not archived) sales on one 10-digit phone tail, with buyer names, read through idx_sales_phone_tail. Server only. Phone and buyer rule, docs/plans/phone-and-buyer-rule.md.';

revoke all on function public.sales_sharing_phone(text, uuid) from public, anon, authenticated;
grant execute on function public.sales_sharing_phone(text, uuid) to service_role;

alter table data_center.shared_phones
  add column if not exists kind text not null default 'shared_number';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'shared_phones_kind_check'
      and conrelid = 'data_center.shared_phones'::regclass
  ) then
    alter table data_center.shared_phones
      add constraint shared_phones_kind_check check (kind in ('shared_number', 'same_buyer'));
  end if;
end $$;

comment on column data_center.shared_phones.kind is
  'shared_number: different buyers on one number. same_buyer: the same buyer name on more than one stove (a digitised repeat), for the call centre to confirm.';

-- Proof it landed (run after applying; expect one row each):
--   select has_function_privilege('authenticated', 'public.sales_sharing_phone(text,uuid)', 'execute') as authenticated_can_run,  -- false
--          has_function_privilege('service_role',  'public.sales_sharing_phone(text,uuid)', 'execute') as server_can_run;         -- true
--   select kind, count(*) from data_center.shared_phones group by kind;                                                           -- shared_number | 954 (or today's count)
