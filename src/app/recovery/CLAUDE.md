# Recovery module: build rules

These rules apply to everything under `src/app/recovery/`,
`src/routes/recovery/`, `supabase/functions/recovery*`, and the `recovery`
Postgres schema. They are additional to the repo's own rules and to the Data
Center's (`src/app/data-center/CLAUDE.md`), which this module mirrors. Where two
rules differ, the stricter one wins.

Read `PLAN.md` before changing anything structural. `TASKS.md` says which slice
the work belongs to; `decisions.md` holds the rulings and the words they were
given in.

## The prime rule

**The sales app must not notice this module exists unless it is switched on.**
Switched off or removed, the sales app and the Data Center behave exactly as
they did before it. If a change would alter behaviour for a user who has no
Recovery grant, it is wrong however convenient it is.

The switch is two things, both on the server: a person is in Recovery only if
`recovery.module_access` holds a row for them (or they are a super admin), and
the `recovery` schema answers nobody but the service role. Dropping the schema
and deleting the route files takes the module out whole.

## Structure

- The module owns its data layer. Nothing under `recovery/` calls
  `getSupabase()` for data. Reads and writes go through `lib/client.ts`, which
  wraps the `recovery` edge function. The one exception is the session token,
  which `lib/client.ts` takes from the sales app's own client to sign each call.
- Layers stay separate: route file, page component, `lib/` data access, edge
  function, database. A component never builds a query; `lib/` never renders.
- One responsibility per file. Split at about 600 lines.
- **Files outside the module that may be hand-edited:** `src/lib/permissions.ts`
  (the `recoverer` role and the `recovery` route key) and
  `src/app/components/Sidebar.jsx` (one nav entry). Route stubs under
  `src/routes/recovery/` belong to the module. `src/routeTree.gen.ts` changes
  because route files were added and is never edited by hand. A migration that
  must touch `public` says so in its header and in `decisions.md`, by name.
  Anything beyond that is a design error: stop and revisit `PLAN.md`.
- The module does not import from `src/app/data-center/`, and the Data Center
  never imports from here. Two modules that share code cannot be switched off
  one at a time. Server-side, the shared Postgres connection helper
  (`_shared/data-center-db.ts`) is the one exception, because writing a second
  copy of the one-connection-per-request rule is how the database got
  exhausted the first time.

## Security

- Every action checks the caller's sales-app role, then their Recovery access,
  then the feature the action needs, all resolved from their token on the
  server, on every request. The UI gate is presentation only. A hidden button
  is not a permission.
- Feature keys and what each access level implies live in
  `supabase/functions/_shared/recovery-roles.ts`, imported, never copied.
  `lib/features.ts` holds labels only; if the two disagree, the server wins.
- **Never add `recovery` to `[api].schemas` in `supabase/config.toml`.** Keeping
  it out of PostgREST is what stops the browser and the Flutter app reaching it.
  Usage on the schema is revoked from `anon` and `authenticated`; row security
  is on with no policies. Three locks, and none of them is optional.
- **`recoverer` fails closed everywhere it is unknown.** It is a sales-app role
  with no routes, no features and no organisation scope. Any check written as
  "if not super admin then treat as partner" or any `else` that hands out rows
  is a hole for this role. When a new check reads a role, it names the roles it
  admits and refuses the rest.
- The service role key is never named `VITE_*`.
- Edge functions declare an explicit origin list. Never `*`.
- Imported spreadsheet content is untrusted input. Never render it with
  `dangerouslySetInnerHTML`.

## Data

- **Made-up households only** until the move (ruled by Orezi, 2026-10-06). Real
  records reach the live database once, at the move, through the module's own
  import with dry run, counts and undo.
- `public.sales` is the only place a sale lives. Recovery hands a stove over
  through the existing sale-creation path (R6) and never inserts into `public`.
- Four seams with the sales app, and no others: the ERP export file, the
  handover into a sale, call records through the existing call import, and the
  shared phones list.
- Every schema change is a versioned, additive migration under
  `supabase/migrations/`, written for Orezi to run, ending with the query that
  proves it landed. No `ALTER` on anything in `public` unless the migration
  names it and `decisions.md` records why.
- Columns that mean a sale field use the sale dictionary's keys
  (`supabase/functions/_shared/sale-dictionary.json`), so a handover is a copy.
- Nothing is deleted. A stove is closed, not removed; history stays in
  `recovery.change_log`, written by trigger and never by application code.
- Never `SELECT *`. Name the columns. Multi-step writes run in one transaction.

## Shipping

The Data Center's shipping rules apply here unchanged: parse the specs with
`bun run e2e -- --list` before a run, a green build does not mean a page
renders, a skipped test is not a passing test, migrations reach a database
through `supabase db push` only.

A slice ships the way a Data Center slice does, with these differences:

1. Each slice is its own branch and preview, with its own branch database and
   made-up data. It merges after 18:00 Lagos.
2. Migrations are written here and run by Orezi on the preview branch first,
   then on production at the merge, each with its proof query.
3. A push, a PR and a merge each wait for Orezi's word. A push to `main`
   deploys to production.
4. Before a slice is called shippable it is reviewed by a model from a
   different family from the one that wrote it.
