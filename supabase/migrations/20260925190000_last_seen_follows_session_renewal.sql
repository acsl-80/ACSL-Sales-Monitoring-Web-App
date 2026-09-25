-- CR-0012: User Management's "Last Seen" showed when a person last typed their password, not when
-- they last used the app. A signed-in session renews itself about once an hour without a new
-- sign-in, so someone who uses the app every day could show as last seen weeks ago (on 25 September,
-- 18 of the 25 people active that week).
--
-- profiles.last_login now also moves forward whenever one of a person's sessions renews
-- (auth.sessions.refreshed_at), from the web app or the field app. A sign-in still moves it, as
-- before (on_auth_user_login). It only ever moves forward, and nothing else in profiles changes, so
-- the triggers that follow a role change do not fire.
--
-- The trigger sits on the session-renewal path, so its function never fails or holds up a renewal:
-- it waits at most 100ms for a person's profile row, an error is logged and swallowed, and the worst
-- case is a stale "Last Seen", which is where this started. It names no column in its trigger
-- definition, so it never stops Supabase's own auth upgrades from changing auth.sessions.
--
-- Undo: drop trigger if exists on_auth_session_refreshed on auth.sessions;
--       drop function if exists public.sync_last_seen();
-- (the values brought forward stay; they are true.)
--
-- Proof after applying (expect 1, then 0):
--   select count(*) from pg_trigger where tgname = 'on_auth_session_refreshed' and tgrelid = 'auth.sessions'::regclass;
--   select count(*) from public.profiles p
--     join (select user_id, max(refreshed_at at time zone 'UTC') seen from auth.sessions group by user_id) s on s.user_id = p.id
--    where p.last_login is null or p.last_login < s.seen;

set local lock_timeout = '3s';

create or replace function public.sync_last_seen()
returns trigger
language plpgsql
security definer
set search_path = ''
set lock_timeout = '100ms'
as $$
begin
  if new.refreshed_at is not null and new.refreshed_at is distinct from old.refreshed_at then
    update public.profiles
       set last_login = new.refreshed_at at time zone 'UTC'
     where id = new.user_id
       and (last_login is null or last_login < new.refreshed_at at time zone 'UTC');
  end if;
  return null;
exception when others then
  raise log 'sync_last_seen skipped for %: % %', new.user_id, sqlstate, sqlerrm;
  return null;
end;
$$;

revoke all on function public.sync_last_seen() from public, anon, authenticated;

create or replace trigger on_auth_session_refreshed
  after update on auth.sessions
  for each row execute function public.sync_last_seen();

-- The people already using the app, brought forward once.
update public.profiles p
   set last_login = s.seen
  from (select user_id, max(refreshed_at at time zone 'UTC') as seen
          from auth.sessions
         where refreshed_at is not null
         group by user_id) s
 where s.user_id = p.id
   and (p.last_login is null or p.last_login < s.seen);
