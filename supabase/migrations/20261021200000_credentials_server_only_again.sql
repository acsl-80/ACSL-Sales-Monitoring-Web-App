-- The credentials table is read and written by the server only, again.
--
-- WHY A SECOND TIME
--
-- 20261021180000 made this change on 21 Oct and was undone the same evening:
-- manage-credentials (every read and both resets) and manage-profile (the
-- profile's login details) still read the table with the signed-in user's
-- token, so the Credentials pages and password resets stopped working. That
-- migration stays in the ledger as applied; this one makes the same change
-- after those two functions were moved to the server client.
--
-- ORDER
--
-- Deploy the manage-credentials and manage-profile of this release first,
-- then run this. Every function that touches public.credentials now uses the
-- service role: manage-credentials, manage-profile, manage-users,
-- manage-agents, manage-organizations, super-admin-agents, external-sync and
-- external-csv-sync (client construction checked function by function,
-- 2026-10-21).
--
-- CHECK: supabase/scripts/20261021-credentials-server-only-check.sql (with
--        version 20261021200000 in its last column)
-- UNDO:  supabase/scripts/20261021-credentials-server-only-undo.sql

set local lock_timeout = '5s';

drop policy if exists "Admins can view all credentials" on public.credentials;
drop policy if exists "Super admins can delete credentials" on public.credentials;

revoke all on table public.credentials from anon, authenticated;
grant all on table public.credentials to service_role;
