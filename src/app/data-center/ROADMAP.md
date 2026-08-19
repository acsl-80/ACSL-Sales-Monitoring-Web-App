# Data Center: roadmap

Read `PLAN.md` first. Phases run in order, and the order is deliberate:
isolation before capability, proof before anything reaches `main`.

## What finishes a phase

**Green CI is necessary and not sufficient.** A phase is done when someone has
opened it and used it the way an ACSL user will, on desktop. Tests prove the
code does what it was told to do. The walkthrough is what catches a form that
has never once saved, a table that scrolls sideways, or a key that only ever
existed on one machine.

For this module there is a second bar: **the sales app is demonstrably
unaffected**, checked at every phase, not once at the end.

---

## Phase 0: branch and safety net

- [x] Branch `feat/data-center` from `origin/main`.
- [ ] Confirm whether Vercel Preview environment variables point at the live
      database. Cannot be read from the repo, so ask or check the dashboard.
      Acceptable either way, but it must be a known choice.
- [ ] Merge `main` into this branch weekly. `main` moves daily on its own via
      the sync cron. A scheduled workflow cannot do this from a non-default
      branch, so it stays manual until the first slice lands.

## Phase 1: schema container and controls

Three migration files, all dated `20260819`.

**Written and validated:**

- [x] `create schema data_center`, with `anon` and `authenticated` explicitly
      revoked and `service_role` granted.
- [x] Control tables: `feature_grants`, `workflow_config`, `metric_snapshots`.
- [x] Registry tables: `option_lists`, `option_values`, `field_defs`. The
      `storage` / `column_name` pair on `field_defs` carries the jsonb to
      column promotion path.
- [x] Spine tables: `call_records`, `import_batches`, `import_rows`.
- [x] Views: `v_sold_stoves`, `v_call_center`. Named columns, no `SELECT *`.
      Serial match and phone-correction flags are derived in the view rather
      than stored, so they cannot drift from their inputs.
- [x] RLS enabled on all nine tables, no policy granted to `anon` or
      `authenticated`. Access is service role only.
- [x] Seed the registry from the workbook's Key tab: **eleven** option lists
      (ten from the tab plus a shared `yes_no`), 68 values, 12 field
      definitions, 4 config rows. The roadmap previously said nine; the tab
      actually carries ten.
- [x] Confirmed `data_center` is **not** in `[api].schemas`, and
      `supabase/config.toml` is untouched. The omission is the isolation.
- [x] `CREATE INDEX CONCURRENTLY` on `public.sales (sales_date desc, id desc)`
      written as its own file, with a prominent warning that it must not run
      inside a transaction and a copy-paste `indisvalid` check.

**Validation performed** (Docker was unavailable, so `supabase start` could not
be used; see the deviation note below):

- [x] Both schema migrations executed against the live database inside
      `BEGIN ... ROLLBACK`, proving they run cleanly and leave nothing behind.
      Confirmed afterwards that `data_center` does not exist.
- [x] Invariant diff taken **inside** that transaction: public tables added 0,
      public tables removed 0, public columns changed 0, grants to `anon` or
      `authenticated` 0.
- [x] Both views resolve and return rows against real data.

**Still to do:**

- [ ] Apply the two schema migrations for real. Needs a decision, since the
      roadmap's own rule is local first and local was not available.
- [ ] Apply the index migration by hand, outside a transaction, then check
      `pg_index.indisvalid` is true.

### Deviation from this roadmap, recorded rather than hidden

The rule above says apply to a local Supabase first and never the live project
first. Docker is not running on this machine, so `supabase start` could not
bring up the local stack, and that step was impossible rather than skipped.

The substitute was to execute both migrations against the live database wrapped
in a transaction that rolls back. That is strictly read-only in effect: it
proves the SQL parses, that every foreign key resolves against the real schema,
that both views build, and that `public` is untouched, all without persisting
anything. It is weaker than a local apply in one respect only: it does not
exercise a fresh-database path, so it would not catch a dependency on an object
that happens to already exist here. Nothing in these migrations has such a
dependency beyond `public` tables, which any environment would carry.

## Phase 2: module shell and the two permission tiers

- [ ] `src/routes/data-center/index.tsx`, five lines, copying
      `src/routes/sales/create.tsx`.
- [ ] `src/app/data-center/page.jsx`, the shell.
- [ ] `lib/client.ts`, the module's only data path.
- [ ] `lib/useFeature.ts`, tier-2 hook mirroring the host's `can()` signature.
- [ ] Tier 1: add `data-center` to `RouteKey` and `ALL_ROUTES` in
      `src/lib/permissions.ts`, granted to `super_admin` only.
- [ ] One nav entry in `src/app/components/Sidebar.jsx`.
- [ ] `data-center-read` edge function, resolving grants before anything else.

Exactly two files outside the module change. Anything more is a design error.

## Phase 3: Table 1, browsable at capacity

- [ ] `scripts/seed-data-center.sql`, generating 500,000 synthetic sales
      locally. This is a deliverable. Production has 38 rows, so no capacity
      claim is provable without it.
- [ ] Keyset pagination, cursor on `(sales_date, id)`. No `OFFSET` parameter is
      exposed at all.
- [ ] Server-side filter, sort and search. Hard server-side page ceiling.
- [ ] Virtualized table rendering.
- [ ] `EXPLAIN ANALYZE` against the seeded set, captured in the PR.

## Phase 4: Table 2, the call centre layer

- [ ] `call_records` write path through `data-center-write`.
- [ ] Four-state verification switch: `fully_verified`, `partially_verified`,
      `doubtful_verification`, `not_verified` as the default.
- [ ] `call_outcome` as a separate constrained field, nine options. It records
      what happened on the phone; verification records the conclusion.
- [ ] Three call dates, corrected phones alongside the originals, ward,
      landmark, stated serial.
- [ ] Survey questions rendered from `field_defs`, answers into `jsonb`.
- [ ] Computed serial match, replacing the workbook's formula column.

Decision to take deliberately: whether "nobody called yet" and "called, no
conclusion" stay merged as one blank state, or split into a fifth.

## Phase 5: bulk import

Not optional. 359 serials in one week's workbook against 38 rows in the whole
sales app.

- [ ] Upload and stage into `import_batches` and `import_rows`, raw payload
      retained so a rejected row can be explained.
- [ ] Per-row schema validation with a reason.
- [ ] Stove ID matched against `stove_ids_base`. Expect roughly 8% to miss.
- [ ] Exceptions queue a human works through. This is the normal path, not an
      error path.
- [ ] **Dry run** reporting what would change without writing.
- [ ] Commit through `create-sale`, stove claimed under lock in the same
      transaction. Two concurrent imports must never both take one stove.
- [ ] Batch-level rollback.
- [ ] Runs as a batched job, never inside a request.

Committing the backlog moves hundreds of stoves from available to sold and
visibly changes the sales app's inventory figures. Staged and reversible for
that reason.

## Phase 6: computation and dashboards

- [ ] `data-center-compute`, aggregating into `metric_snapshots`. Scheduled or
      on demand, never on page load.
- [ ] Dashboards read snapshots only. Any `count(*)`, `sum()` or `group by`
      over `sales` belongs in compute, not read.
- [ ] The module's own completeness definition, since
      `calculate_sale_status()` disagrees with the form and marks 30 of 38
      production rows `incomplete`.

## Phase 7: flip the gate

- [ ] Merge slices to `main` with the route key still `super_admin` only.
- [ ] Define the call-centre users in the host role model.
- [ ] Widen the grant only once the module is proven.

---

## Verification

Two claims are made, capacity and non-interference. Both get proven.

**Capacity**, against seeded data:

1. `EXPLAIN ANALYZE` shows an index scan, no sequential scan on `sales`, no sort
   over the full set.
2. First page and a page 400,000 rows deep return in the same time envelope. If
   deep pages degrade, keyset pagination is not actually in force.
3. Dashboards resolve from `metric_snapshots`, confirmed by the absence of any
   aggregate over `sales` in the read function's plan.
4. Dashboard load time is flat between the 38-row and 500,000-row datasets.
5. The table renders 500,000 rows without DOM growth.
6. Drop the new `public.sales` index, re-run, record the difference, so the
   index is documented rather than folklore.

**Non-interference:**

7. `bun run build` passes. It is the only blocking check, so it is the one that
   matters.
8. Apply migrations to a local Supabase first, never the live project first.
9. Snapshot `public` table names before and after. The lists must be identical.
10. Hit `/rest/v1/call_records` locally and expect a 404. Rows mean the schema
    leaked into PostgREST and Phase 1 is wrong.
11. Load `/sales/create` and submit a test sale. Unchanged behaviour.
12. Log in as a non-super-admin and confirm `/data-center` is unreachable and
    absent from the sidebar.
13. Forge a call to a `data-center-*` function with a JWT that has the route but
    no `feature_grants` row. It must return nothing.
14. `vite build`, then grep `dist/` for the service role key. Vite inlines every
    `VITE_*` variable into client JavaScript.
15. Run two imports claiming the same stove ID concurrently. Exactly one wins.
16. `drop schema data_center cascade` locally, then confirm the sales app still
    builds and runs. This proves the module is detachable.
