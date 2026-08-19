# Archived migrations

These 31 files are the project's migration history up to 2026-08-19. They are
kept for the record and are **not executed**. The single file in
`supabase/migrations/` is the executable history now.

## Why they were archived rather than kept in the run path

This project was built through the Supabase dashboard, not the CLI, so these
files were never a reliable description of the database. Three findings settled
it, all verified rather than assumed:

1. **They cannot rebuild the schema.** None of them creates `sales`,
   `organizations`, `profiles`, `stove_ids_base`, `addresses` or `uploads`.
   Every migration that alters those tables would fail on an empty database.
2. **They contradict the current schema.** `20260224_create_super_admin_agent_organizations.sql`
   creates `super_admin_agent_organizations` as a table and indexes it. In
   production that name is a **view**, over the `acsl_agent_organizations`
   table. Running the history after the baseline fails with
   `cannot create index on relation ... This operation is not supported for
   views`. That is the error that prompted this change.
3. **At least one of them cannot ever have run.** The same file, line 32,
   reads `SELECT 1 FROM profilesli` inside a policy. There is no such relation.
   A history containing a migration that cannot execute is not a history.

`supabase_migrations.schema_migrations` in production held zero rows, which is
consistent with all of the above: these were applied by hand, in part, or not at
all.

## What replaced them

`supabase/migrations/00000000000000_baseline_schema.sql`, an introspection of
the live schema covering extensions, tables, constraints, indexes, RLS policies,
functions, views, auth triggers and storage. It rebuilds the database from
nothing, which is what Supabase branching and a fresh local stack both require.

This is the equivalent of `supabase migration squash`, and of the
`supabase db pull` step in Supabase's own "Preparing your Git repository"
guide, which this project skipped.

## Reading them

They remain the best record of *why* the schema looks the way it does. Consult
them for intent. Do not move one back into `supabase/migrations/` expecting it
to run: the baseline already contains its outcome.

## If a contractor's sync re-adds one

The upstream repositories still carry these files. If a sync merge restores one
into `supabase/migrations/`, move it back here. Re-running it would at best be a
no-op and at worst reintroduce the view-versus-table conflict above.
