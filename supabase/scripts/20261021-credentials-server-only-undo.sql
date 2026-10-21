-- Undo for 20261021180000_credentials_server_only. Puts back the two signed-in
-- rules and the table rights exactly as they were on 2026-10-21.

-- Before: anon and authenticated held arwdDxtm (all rights) on the table.
grant all on table public.credentials to anon, authenticated;

create policy "Admins can view all credentials" on public.credentials
  for select to authenticated
  using (
    exists (
      select 1 from profiles
      where profiles.id = auth.uid()
        and profiles.role = any (array['admin'::text, 'super_admin'::text])
    )
  );

create policy "Super admins can delete credentials" on public.credentials
  for delete to authenticated
  using (
    exists (
      select 1 from profiles
      where profiles.id = auth.uid()
        and profiles.role = 'super_admin'::text
    )
  );
