-- Recovery R1 proof: a recovery-only account reads nothing in public, and
-- nobody signed in reaches the recovery schema.
--
-- For a PREVIEW BRANCH DATABASE, after both R1 migrations have run. Paste the
-- whole file into the SQL editor and run it as one script. It changes nothing:
-- the made-up account it signs in as is created inside the transaction and
-- rolled back with it.
--
-- What it does, as the database sees it:
--   1. creates a made-up `recoverer` account the way an admin would, which
--      makes its profile through handle_new_user();
--   2. signs in as that account (role `authenticated`, its id in the JWT), the
--      same identity a browser request carries;
--   3. counts the rows it can read from every table, view and materialised
--      view in public, and tries every table in recovery;
--   4. lists the definer functions in public it could call, which run with
--      their owner's rights and so step around row security;
--   5. rolls everything back.
--
-- Reading the result (first query):
--   verdict 'nothing'         zero rows, or refused: what R1 needs everywhere
--   verdict 'reference data'  rows from a named list of public reference tables
--                             any signed-in account reads (states, LGAs, field
--                             rules, payment models, app releases)
--   verdict 'READS ROWS'      anything else with rows. R1 is not proven while
--                             any row says this.
-- The second query lists callable definer functions. Each is a door row
-- security does not guard; whether it leaks depends on its body.

begin;

-- 1. A made-up recoverer, no organisation.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin,
  confirmation_token, recovery_token, email_change_token_new, email_change
) values (
  '00000000-0000-0000-0000-000000000000', 'c0000000-0000-4000-8000-0000000000f1'::uuid,
  'authenticated', 'authenticated', 'r1-proof-recoverer@preview.acsl.test',
  '', now(), now(), now(),
  '{"provider":"email","providers":["email"],"role":"recoverer"}'::jsonb,
  '{"full_name":"R1 Proof Recoverer","role":"recoverer"}'::jsonb,
  false, '', '', '', ''
);

-- The proof means nothing unless the profile really is a recoverer, active,
-- with no organisation.
do $$
declare p record;
begin
  select role, status, organization_id into p
    from public.profiles where id = 'c0000000-0000-4000-8000-0000000000f1'::uuid;
  if p is null or p.role is distinct from 'recoverer' or p.status is distinct from 'active'
     or p.organization_id is not null then
    raise exception 'R1 proof set-up failed: expected an active recoverer with no organisation, got %', p;
  end if;
end $$;

create temp table r1_proof (schema_name text, relation text, kind text, row_count bigint, refused text)
  on commit drop;
grant all on r1_proof to authenticated;

-- 2. Signed in as the recoverer.
select set_config('request.jwt.claims',
  json_build_object('sub', 'c0000000-0000-4000-8000-0000000000f1', 'role', 'authenticated',
                    'email', 'r1-proof-recoverer@preview.acsl.test')::text, true);
set local role authenticated;

-- 3. Every relation in public, and every table in recovery.
do $$
declare
  rel record;
  n bigint;
begin
  for rel in
    select n2.nspname as s, c.relname as r,
           case c.relkind when 'r' then 'table' when 'p' then 'table' when 'v' then 'view'
                          when 'm' then 'materialised view' when 'f' then 'foreign table' end as k
      from pg_class c
      join pg_namespace n2 on n2.oid = c.relnamespace
     where (n2.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f'))
        or (n2.nspname = 'recovery' and c.relkind in ('r', 'p'))
     order by 1, 2
  loop
    begin
      execute format('select count(*) from %I.%I', rel.s, rel.r) into n;
      insert into r1_proof values (rel.s, rel.r, rel.k, n, null);
    exception when others then
      insert into r1_proof values (rel.s, rel.r, rel.k, null, sqlstate || ' ' || sqlerrm);
    end;
  end loop;
end $$;

reset role;

-- The verdict, one row per relation, worst first.
select schema_name, relation, kind, row_count, refused,
       case
         when coalesce(row_count, 0) = 0 then 'nothing'
         when schema_name = 'public'
              and relation in ('nigeria_states', 'nigeria_lgas', 'sale_field_rules',
                               'payment_models', 'app_releases') then 'reference data'
         else 'READS ROWS'
       end as verdict
  from r1_proof
 order by (coalesce(row_count, 0) > 0
           and relation not in ('nigeria_states', 'nigeria_lgas', 'sale_field_rules',
                                'payment_models', 'app_releases')) desc,
          schema_name, relation;

-- 4. Definer functions in public the account could call.
select p.proname as function_name,
       pg_get_function_identity_arguments(p.oid) as arguments
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.prosecdef
   and p.prokind = 'f'
   and has_function_privilege('authenticated', p.oid, 'execute')
 order by 1;

-- 5. Leave nothing behind.
rollback;
