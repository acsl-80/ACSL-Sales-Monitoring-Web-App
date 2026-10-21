-- credentials.password may be empty.
--
-- WHAT THIS DOES
--
-- Drops NOT NULL from public.credentials.password. From this release no edge
-- function stores a password: new logins and resets show the password once
-- in their reply, and a reset or a user's own change clears the stored copy.
-- The column itself is emptied and dropped in a later release, once nothing
-- has read it for a week.
--
-- ORDER
--
-- This runs before the functions of the same release are deployed: they
-- write null into this column, which the old constraint refuses.
--
-- CHECK: select is_nullable from information_schema.columns
--        where table_schema = 'public' and table_name = 'credentials'
--          and column_name = 'password';   -- expect YES
-- UNDO:  alter table public.credentials alter column password set not null;
--        (only while no row holds null)

set local lock_timeout = '5s';

alter table public.credentials alter column password drop not null;
