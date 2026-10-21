-- The credentials table is read and written by the server only.
--
-- WHAT THIS DOES
--
-- Drops the two rules that let a signed-in user read or delete rows of
-- public.credentials ("Admins can view all credentials" and "Super admins can
-- delete credentials"), and takes back every table right anon and
-- authenticated held on it. The two service-role rules stay; the service role
-- bypasses row rules in any case.
--
-- WHY NOTHING BREAKS
--
-- Every reader and writer of the table is an edge function using the service
-- role: manage-credentials, manage-profile, manage-users, manage-agents,
-- manage-organizations, super-admin-agents, external-sync and
-- external-csv-sync. No screen in the web app, nothing in the phone app
-- (v1.0.19), nothing in erp-web and no database function or view reads it as
-- a signed-in user (checked 2026-10-21). The credentials screens keep working
-- exactly as before, because they go through manage-credentials.
--
-- CHECK: supabase/scripts/20261021-credentials-server-only-check.sql
-- UNDO:  supabase/scripts/20261021-credentials-server-only-undo.sql

set local lock_timeout = '5s';

drop policy if exists "Admins can view all credentials" on public.credentials;
drop policy if exists "Super admins can delete credentials" on public.credentials;

revoke all on table public.credentials from anon, authenticated;
grant all on table public.credentials to service_role;
