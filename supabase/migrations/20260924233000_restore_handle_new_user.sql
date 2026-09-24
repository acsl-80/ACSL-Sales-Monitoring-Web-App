-- Put handle_new_user back as it was before 20260924230000 (2026-09-24, same evening).
--
-- 20260924230000 made the new-user trigger trust a new account's role and organisation only when the
-- account arrived already confirmed, on the belief that the admin API inserts confirmed accounts. It
-- does not: admin.createUser inserts the row first and confirms it in a later statement, so the
-- trigger saw every admin-created account as unconfirmed and gave it no role and no organisation.
-- Proven with a real admin.createUser on the PR's preview branch. No production account was created
-- in between (checked before and after).
--
-- This file restores the original function exactly. It is safe because public sign-up is now switched
-- off on the project (disable_signup), so only the admin API and the dashboard create accounts, and
-- they choose the role on purpose. The profiles guard from 20260924230000 stays: it is what stops a
-- signed-in person giving themselves a role. Do not switch sign-up back on while this trigger reads
-- the role from sign-up data; the lasting fix is for the admin functions to write role and
-- organisation themselves and for this trigger to stop reading them.
--
-- REVERSAL: none needed; this is the reversal of part of 20260924230000.

begin;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  user_role text := new.raw_user_meta_data->>'role';
  org_id uuid := nullif(new.raw_user_meta_data->>'organization_id', '')::uuid;
begin
  insert into public.profiles (
    id,
    email,
    full_name,
    role,
    organization_id,
    has_changed_password
  )
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name',
    user_role,
    org_id,
    case
      when user_role = 'admin' then true
      else false
    end
  );
  return new;
end;
$function$;

commit;

-- PROOF (expected: true): position('email_confirmed_at' in pg_get_functiondef('public.handle_new_user()'::regprocedure)) = 0
