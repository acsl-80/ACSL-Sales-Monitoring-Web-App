-- Stove records are written by the server only, and read only by people signed in (2026-09-24).
--
-- Found the same evening as the role guard, proven on production in a transaction forced to roll back:
-- anyone holding the public key could delete or rewrite any stove record. The view public.stove_ids
-- runs with its owner's rights (no security_invoker), so it skips stove_ids_base's row security, and
-- anon held INSERT, UPDATE and DELETE on it. Anon could also read all 24,067 stove records through it.
-- Separately, every signed-in user held UPDATE on stove_ids_base under a policy that allows any row.
--
-- Nothing in the web app or the field app writes stove records directly. Every function that does
-- (create-sale, delete-sale, external-sync, external-csv-sync, manage-organizations,
-- manage-stove-ids, upload-stove-ids-csv) uses the service role, which this file does not touch.
-- Signed-in screens keep reading as they do today.
--
-- REVERSAL:
--   grant insert, update, delete on public.stove_ids to anon, authenticated;
--   grant select on public.stove_ids to anon;
--   grant insert, update, delete on public.stove_ids_base to anon, authenticated;

begin;

revoke insert, update, delete on public.stove_ids from anon, authenticated;
revoke select on public.stove_ids from anon;
revoke insert, update, delete on public.stove_ids_base from anon, authenticated;

do $$
begin
  if has_table_privilege('anon', 'public.stove_ids', 'DELETE')
     or has_table_privilege('anon', 'public.stove_ids', 'SELECT')
     or has_table_privilege('authenticated', 'public.stove_ids', 'UPDATE')
     or has_table_privilege('authenticated', 'public.stove_ids_base', 'UPDATE') then
    raise exception 'Stove records are still writable or readable from outside the server';
  end if;
  if not has_table_privilege('authenticated', 'public.stove_ids', 'SELECT') then
    raise exception 'Signed-in screens lost their read of stove records';
  end if;
  raise notice 'Stove records: server writes only, signed-in reads kept';
end $$;

commit;

-- PROOF (expected: false, false, false, true, true):
--   select has_table_privilege('anon', 'public.stove_ids', 'DELETE'),
--          has_table_privilege('anon', 'public.stove_ids', 'SELECT'),
--          has_table_privilege('authenticated', 'public.stove_ids_base', 'UPDATE'),
--          has_table_privilege('authenticated', 'public.stove_ids', 'SELECT'),
--          has_table_privilege('service_role', 'public.stove_ids', 'UPDATE');
