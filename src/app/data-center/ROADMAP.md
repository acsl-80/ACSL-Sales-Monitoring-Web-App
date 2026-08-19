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

# Environment strategy

The intended shape, agreed 2026-08-19:

1. A **Supabase branch** carrying the `data_center` schema, so the module can be
   exercised against a real, isolated Postgres with realtime, rather than only
   locally.
2. The matching **Vercel preview deployment** of `feat/data-center`, pointed at
   that branch's credentials.
3. Merge both to production together when the module is proven.

This is a better shape than what the plan originally assumed, because it removes
the awkward choice between testing locally and applying to a live database.

**It also changes nothing about mobile.** A Supabase branch is a separate
instance with its own credentials. `sales-mobile` points at production and is
never repointed. The module stays out of PostgREST regardless, so even on the
branch there is nothing for the Flutter app to reach.

## Blocker: the migration history cannot build a branch

Verified 2026-08-19, and this stops the approach until it is fixed.

Supabase builds a preview branch by running the migrations in
`supabase/migrations` against a **fresh, data-less** database (step 5 of its
deploy workflow, `Migrate`). If that step fails, seeding is skipped and the
branch comes up broken.

This repository's migration history cannot do that:

- `supabase_migrations.schema_migrations` in production contains **0 rows**. The
  schema was built through the dashboard, never through the CLI.
- No migration ever creates `sales`, `organizations`, `profiles`,
  `stove_ids_base`, `addresses` or `uploads`. Only `payment_models`,
  `organization_payment_models`, `installment_payments`, `app_releases`,
  `sync_logs`, the `super_admin_agent_*` tables and the `purge_archive` copies
  are created by migrations.
- So every migration that alters those core tables would fail on a fresh
  database. `20260609_partner_purge_part2` would fail outright on
  `CREATE TABLE purge_archive.s_sales (LIKE public.sales)`.
- The `data_center` migrations would fail too, since they carry foreign keys to
  `public.sales` and `public.profiles`.

The full schema exists only in `schema-baselines/sales_public_baseline.sql`,
which is an introspection snapshot, not part of the migration history.

## Prerequisite: the documented setup step this project skipped

Confirmed against Supabase's own GitHub-integration guide, under "Preparing
your Git repository". Their required setup is:

1. `supabase init`
2. **`supabase db pull --db-url <connection string>`**, which captures the
   existing production schema as a migration
3. Commit the `supabase` directory, with their suggested message
   "Initial migration"

Step 2 was never done here. That is the whole blocker, stated in their words
rather than mine: branching reads the schema from the repository's migration
history, and this repository has no migration that creates the core tables.
"Data-less" in their docs refers to rows, not schema.

So the fix is their documented command, not a hand-rolled one:

1. Run `supabase db pull` against production to generate a baseline migration.
   This is better than pasting `schema-baselines/sales_public_baseline.sql`,
   because the CLI also writes the migration history correctly.
2. Confirm the remaining 31 migrations are recorded as applied, since
   production's `supabase_migrations.schema_migrations` currently has 0 rows.
   `supabase migration repair --status applied` is the tool. This is the step
   that must not be got wrong: repairing marks a migration as done **without
   running it**, which is what protects production.
3. Prove it by resetting a local database from migrations alone and diffing the
   result against the baseline snapshot, before any branch is created.

**This is host-app work, not Data Center work.** It touches `supabase/`, which
the sync workflow classifies as high risk, and it benefits the whole repository
rather than this module: today no environment can be stood up from this repo at
all, and the local stack is already missing the auth triggers as a result. It
deserves its own branch and its own review rather than riding inside this one.

### Why no branch was created to test this

The question was whether a Dashboard-created branch might sidestep the missing
history by pulling schema from production. The documentation answers it: it does
not, and `supabase db pull` is the prescribed setup precisely because the
history is what branches are built from.

Creating a branch would therefore have failed at the `Migrate` step, skipped
seeding, and cost money to learn nothing. The org is on the **Pro** plan, so
branching is available whenever the prerequisite is done.

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

### Validation: applied locally first, as the rule requires

All three migrations were applied to the local Supabase stack
(`postgres://…@127.0.0.1:54332`), which carries the 25 baseline `public` tables
and had no `data_center` schema. Every claim below was executed, not reasoned
about.

**Isolation**

- [x] `data_center` unreachable through PostgREST. `/rest/v1/call_records`,
      `/rest/v1/option_values` and `/rest/v1/v_call_center` all return **404**.
      This is the check that proves `sales-mobile` can never see this data, and
      it is the single most important guarantee in the design.
- [x] Control: `/rest/v1/sales` still returns **200**. The existing API is
      untouched.
- [x] Nine of nine tables have RLS enabled, **zero** policies, **zero** grants
      to `anon` or `authenticated`.

**`public` untouched**

- [x] Column-level diff before and after: 0 added, 0 removed. No `ALTER TABLE`,
      no triggers, no new tables.

**It works**

- [x] Fixture exercised the full join: `v_call_center` resolved end user,
      partner state, sale agent name and stock status across five `public`
      tables.
- [x] Registry labels resolve through the option-value foreign keys.
- [x] Both derived columns correct: `serial_matches` true on a match, and
      `phone_was_corrected` true when the call centre reached a different
      number from the one the sale was recorded with.
- [x] `answers` jsonb readable.

**Reversible and repeatable**

- [x] `drop schema data_center cascade` leaves `public` at 25 tables and the
      sales API at 200. The module is genuinely detachable.
- [x] Both migrations re-apply cleanly after a drop.
- [x] The seed is idempotent: 68 option values after running it twice.

**The index**

- [x] Applied outside a transaction. `pg_index.indisvalid` is **true**.
- [x] Confirmed it survives `drop schema data_center cascade`, which is correct
      and is why its rollback is documented separately in its own file.

### Found while testing

`public.stove_ids_base` carries a check constraint,
`stove_ids_sale_id_check`, requiring that a stove with `status = 'sold'` also
has a `sale_id`. It rejected a fixture that set the status without the link.

This matters for Phase 5: an import cannot mark a stove sold before the sale
row exists, which reinforces that the stove claim and the sale write must share
one transaction rather than being two steps that can half-complete.

**Still to do:**

- [ ] Apply to production. Needs an explicit decision, since production is live
      and this has only ever run locally.
- [ ] Apply the index to production by hand, outside a transaction, then check
      `indisvalid`.

## Phase 2: module shell and the two permission tiers

- [x] `src/routes/data-center/index.tsx`, eight lines, copying
      `src/routes/sales/create.tsx`.
- [x] `src/app/data-center/page.jsx`, the shell. Renders each future surface as
      a card that is locked or unlocked by its tier-2 key, so the gate is
      visible rather than theoretical.
- [x] `lib/features.ts`, the nine feature keys. `import.upload` and
      `import.commit` are separate on purpose: preparing an import and landing
      one are different privileges, because landing it moves stock.
- [x] `lib/client.ts`, the module's only data path. Explicit timeout, response
      shape validated, errors logged in full and surfaced calmly.
- [x] `lib/access.tsx`, tier-2 provider and `useFeature().can()`, mirroring the
      host's `usePermissions().can()` signature. **Fails closed**: a lookup that
      errors grants nothing.
- [x] Tier 1: `data-center` added to `RouteKey` and `ALL_ROUTES` in
      `src/lib/permissions.ts`. No other role array lists it, so it is
      `super_admin` only.
- [x] One nav entry in `src/app/components/Sidebar.jsx`.
- [x] `data-center-read` edge function with the `access` action, resolving
      grants from the caller's JWT before anything else.

### Verified

- [x] `bun run build` passes. `bunx tsc --noEmit` reports no errors in the
      module.
- [x] Route registered: `/data-center/` present in the generated route tree.
- [x] Block 07: every JWT in the built client bundle decodes to `"role":"anon"`.
      No service-role key reached the browser.
- [x] Hand-edited files outside the module: exactly two.

### The tier-2 gate, proven end to end

Executed against the local edge runtime on 2026-08-19 with real users and real
JWTs, not reasoned about:

| Case | Result |
|---|---|
| Holds the route, holds **no** grant | `200 {"features":[],"isSuperAdmin":false}` |
| Same user after granting two keys | `200 {"features":["records.view","call_records.edit"]}` |
| Super admin | `200 {"isSuperAdmin":true}` |
| Unknown action | `400 unknown_action` |
| Body is not JSON | `400 bad_body` |
| Disallowed origin | `403 bad_origin` |
| No Origin header (server to server) | `200`, correctly permitted |

The positive case matters as much as the negative one: a gate that always
returned an empty list would pass the first test and be broken. Granting two
keys and getting back exactly those two is what proves the table is read.

### A real defect this testing found

The CORS allowlist did not work as originally written. The Supabase API gateway
(`via: kong/2.8.1`) **overwrites** `Access-Control-Allow-Origin` with `*` on the
way out, so omitting the header achieved nothing: a request from
`https://evil.example` came back with `*`.

Fixed by enforcing the allowlist in the **status code** rather than only the
header. A proxy can rewrite a header; it cannot turn a `403` with no payload
into data. Requests with no `Origin` at all are still permitted, since those are
non-browser callers authenticated by bearer token.

This is exactly the class of thing that only surfaces by running the code.

### Local environment gap, worth knowing before the branch work

The local database has **no `on_auth_user_created` trigger**, so creating a user
does not create a `profiles` row. The trigger lives in
`schema-baselines/sales_supplemental_baseline.sql`, which was never loaded
locally; only the public-schema baseline was.

That is the same missing-history problem described under Environment strategy,
seen from another angle: the local stack is not a faithful reproduction of
production either. The baseline migration work fixes both.

### How edge functions actually reach a Supabase branch

Found by review on 2026-08-19, because the hosted branch's `data-center-read`
returned nothing: **it was never deployed there.**

- A branch project starts with a **copy of the parent's deployed functions**,
  all 62 of them, orphans included. Not the repo's 52.
- The integration deploys a repo function to the branch only when a **push
  changes that function**. A push touching only `src/` deploys nothing.
- Consequence for every later phase: after adding `data-center-write`,
  `data-center-import` or `data-center-compute`, either push a commit that
  touches them or deploy by hand:
  `supabase functions deploy <name> --project-ref <branch-ref>`.

Also settled by test on the hosted branch: OPTIONS preflight without an
Authorization header returns 200 (the gateway exempts preflight from JWT
verification), and hosted Kong echoes the allowed origin rather than
overwriting it with `*` the way local Kong does. The status-code enforcement
stays regardless, since it protects against both behaviours.

### An architectural consequence worth recording

Because `data_center` is deliberately absent from `[api].schemas`, PostgREST
does not expose it, so `supabase.from(...)` and `.schema(...)` **cannot reach
it**. The `data-center-*` edge functions therefore open their own Postgres
connection via `SUPABASE_DB_URL`, and use supabase-js only for the two things
that live in `public`: verifying the JWT and reading the caller's role.

This is a feature, not a workaround. It means there is no configuration change
that could accidentally expose the module through the public API, and it is the
same property that keeps `sales-mobile` out.

`data-center-read` also declares an explicit CORS origin allowlist rather than
the `*` used elsewhere in this repo, because its responses are gated on a bearer
token and a permissive origin makes any page the user visits a potential caller.

## Next step

**Blocked pending a decision.** See "Prerequisite: adopt a baseline migration"
above. Until the migration history can rebuild the database from nothing, a
Supabase branch cannot be created, so the branch-plus-preview workflow cannot
start.

Once unblocked, in order:

1. Adopt the baseline migration on its own branch, and repair production's
   migration history so nothing re-runs there.
2. Create the Supabase branch for `feat/data-center` and let it build.
3. Point the Vercel preview for that branch at the branch's credentials.
4. Start the local edge runtime and prove the tier-2 gate end to end: a user
   holding the route but no grant must get nothing back from
   `data-center-read`. This is untested today, because the local
   `supabase_edge_runtime` container is stopped.
5. Then Phase 3.

## Phase 3: Table 1, browsable at capacity — DONE

- [x] `scripts/seed-data-center.sql`, generating 500,000 synthetic sales
      locally, plus a teardown that removes exactly what it wrote. Verified: the
      500k load takes about six minutes and every join in the view resolves.
- [x] Keyset pagination, cursor on `(sales_date, id)`. No `OFFSET` parameter
      exists in the request shape, so it cannot be reintroduced by a caller.
      Null dates carry an explicit branch in both directions.
- [x] Server-side filter, sort and search. Page ceiling of 200 enforced in the
      builder, not trusted from the caller.
- [x] Virtualized rendering, written in the module rather than taken as a
      dependency, so package.json and bun.lock stay untouched.
- [x] `EXPLAIN ANALYZE` captured in `RECORDS-PERFORMANCE.md`.
- [x] Scoping mirrors the sales app's own rule, so the module can never show a
      user a row the sales app hides.

Two things this phase changed from the plan, both with a measurement behind
them and both recorded in `RECORDS-PERFORMANCE.md`:

- **A second index on `public.sales`.** The design promised one. Search without
  a trigram index costs 1,089 ms at 500k, against 10.9 ms with it.
- **`v_sold_stoves` gained `sold_on_behalf_of`.** The scope rule needs it, and
  its absence broke every non-super-admin read.

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

## Phase 7: access management, under Settings

Requirement, 2026-08-19. Access is administered from a **"Data Center" section
on the Settings page**. An admin ticks a user there; next time that user signs
in to the sales web app, the Data Center module is visible to them. Admins have
access without being ticked.

- [ ] `Settings > Data Center`: list users, tick to enable the module, and grant
      individual tier-2 features from `features.ts`.
- [ ] `data-center-admin` edge function for granting and revoking, itself gated
      on `grants.manage`.
- [ ] Widen access only once the module is proven.

### Playwright proved the gap is live, not theoretical

The e2e suite (`bun run e2e`, 14 tests) was written expecting the seeded
`callcentre` account to demonstrate a partial grant. It cannot, and the failure
is the finding:

`callcentre` holds three tier-2 grants in the database, and `data-center-read`
returns exactly those three when called directly. But its role is
`partner_agent`, which carries no `data-center` route key, so **tier 1 stops it
at the door and the grants are never consulted.** The account sees "Page Not
Found".

The consequence, now asserted by a test rather than assumed:

> **No user can exercise a partial grant through the interface today.** The only
> role that reaches the module is `super_admin`, and `super_admin`
> short-circuits tier 2 entirely.

So tier 2 is proven at the function boundary and **unproven at the UI
boundary**, and will stay that way until the module-access work below lands.
That is not a reason to distrust the mechanism, but it is a reason not to claim
it is working end to end.

### This changes tier 1, and the change is not trivial

Tier 1 is currently the host's **static, compile-time** route map, granted to
`super_admin` only. That cannot express "this particular non-admin user has been
enabled", which is exactly what the requirement asks for. `usePermissions()`
resolves synchronously from a compiled object; there is nowhere for a per-user
flag to enter.

Three ways to close it, to be decided rather than drifted into:

1. **Module-access grant, read by the shell.** Add a reserved key, for example
   `module.access`, to `feature_grants`. Load it once after login and let the
   sidebar show the entry when `canRoute('data-center')` **or** the grant is
   held. Keeps the host permission system untouched, but the sidebar gains one
   asynchronous input, so it is slightly more than the "one nav entry" the
   current design promises.
2. **Widen the static map and gate inside.** List `data-center` for more roles
   and refuse at the page. Simplest, but every user in those roles sees a nav
   entry they cannot use, which advertises the module to people who do not have
   it.
3. **Carry the flag on the profile.** Cleanest to read, but `profiles` is in
   `public`, and adding a column there breaks this module's core invariant.

Option 1 looks right and option 3 is ruled out by the invariant, but this needs
a decision before Phase 7 starts. Recorded now so it is not discovered late.

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
