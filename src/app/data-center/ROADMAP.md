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

## Phase 3: Table 1, browsable at capacity : DONE

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

## Phase 4: Table 2, the call centre layer : DONE

- [x] The four-state switch, as the workbook actually uses it.
- [x] `call_outcome` separate from the verification outcome, registry-backed.
- [x] **Call attempts as rows, not three columns.** The workbook had three dates
      and one outcome, so it could not say which attempt produced which result.
      A fourth attempt is now a click rather than a migration. Verified.
- [x] Corrected phones alongside the originals, plus corrected name, address,
      state and LGA. Ward and landmark, which the sales schema cannot hold.
- [x] The correction loop as state: requested, reason, note, resolved. "Waiting
      on Sales" is a queue rather than an inference from a changed phone number.
- [x] The questionnaire rendered from `field_defs`, answers in jsonb.
- [x] Conditions (`visible_when`) and validation in the registry, enforced on
      the server as well as in the form.
- [x] Optimistic concurrency. A save carrying a stale version is refused, not
      merged.
- [x] Direct entry through `data-center-write`, with tier-2 and org scope
      enforced server-side.
- [x] Queue presets that match how the desk works: never called, still to
      verify, chased three times, waiting on Sales.

Proven rather than asserted: a question was added to the running system with two
INSERT statements and no deploy. The form went from 13 questions to 14, arrived
with its choices and its condition, and the server began enforcing that
condition immediately. Written up in `CHANGING-THE-CALL-TABLE.md`.

One capacity fix this phase forced, kept because the number is the argument:
"called three times and still not verified" took **25.8 seconds** at 500,000
rows. It now takes about 40 ms. Two changes got it there, both measured:
`attempt_count` became a real column maintained by a trigger, and every read
became two statements (pick the page's ids, then hydrate them) because no single
query could be persuaded into a good plan.

**The decision left open in the plan is now taken.** "Never called" and "called,
no conclusion" are no longer the same thing: the first has no call record at
all, the second has one with `not_verified`. The queue can tell them apart
(`hasCallRecord: false` against `verificationOutcome: not_verified`) without a
fifth state, because the attempts table already carries the difference.

## Phase 5: bulk import : DONE

Not optional. 359 serials in one week's workbook against 38 rows in the whole
sales app.

- [x] Upload and stage into `import_batches` and `import_rows`, raw payload
      retained so a rejected row can be explained.
- [x] Per-row validation with a reason written for a data clerk, not a
      developer.
- [x] Stove ID matched against `stove_ids_base`, case-insensitively, and the
      canonical spelling carried downstream so a match cannot become a refusal.
- [x] Exceptions queue with inline correction. This is the normal path: a
      correction that does not resolve the problem stays an exception with the
      new reason rather than failing later at commit.
- [x] Dry run reporting exactly which stoves would move, writing nothing.
- [x] Commit through `create-sale`, never around it, in bounded slices.
- [x] Batch-level rollback through `delete-sale`, which frees the stock.
- [x] Two concurrent imports cannot both take one stove.

Verified end to end against the 500,000-row database: 20 valid, 2 exceptions,
2 rejected; dry run reported 20 stoves; one exception corrected; 21 committed,
0 failed; 21 rolled back and stock returned to 2,000 available, 0 sold.

The race was tested rather than reasoned about. Two batches holding the same
serial, committed at the same instant: one sale created, the other refused with
"Another import is already committing this stove".

**A defect in the sales app that this surfaced and did not fix.** `create-sale`
checks a stove's status, inserts a sale, then marks the stove sold with no guard
on the update, so two callers can both pass the check. The import closes this
against itself by claiming in `data_center.import_claims` first, but it cannot
close it against the Sell Stove form. Written up in `IMPORT.md`; fixing it is a
one-line change to a live shared function and therefore a decision.

## Phase 6: computation and dashboards : DONE

- [x] `data-center-compute`, aggregating into `metric_snapshots` through
      `data_center.compute_metrics()`. On demand, super admin only, never on
      page load.
- [x] Dashboards read `v_current_metrics` and nothing else. The rule is
      checkable: grepping the read function for `count(*)`, `sum(` or
      `group by` returns one line, and it is the comment stating the rule.
- [x] The module's own completeness definition, driven by `workflow_config`
      and built as validated column predicates rather than pasted config.

Measured at 500,000 sales:

    compute    74 metrics in 5.2 s
    read       2.3 ms, because it never touches sales

The completeness gap is now a number rather than a note: 480,000 sales are
complete by this module's rule, 120,000 by the sales app's, a disagreement of
**360,000**. The dashboard shows it rather than hiding it.

Two things this phase got wrong first and fixed:

- The completeness rule as a per-row jsonb lookup took **73 seconds**. As plain
  column predicates, 549 ms. Same answer.
- The one-run-at-a-time guard was check-then-act, and a test showed two
  concurrent runs both getting through. It is `pg_try_advisory_lock` now.

Written up in `DASHBOARDS.md`.

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

## Phase 8: transfers and reconciliation: DONE

What was sold has to be known before what was recovered can mean anything.

- [x] `v_transfers`, `v_transfer_stoves`, `v_transfer_funnel` over
      `public.stove_transfer_history`. A view, not a sync: the records are
      already in this database. 497 transfers, 14,564 stoves, 278 partners,
      23 sales reps in production today.
- [x] `record_consignments` for the Received stage, a count per consignment
      rather than a row per record.
- [x] `transfer_funnel` action on `data-center-read`, scoped
      through the existing `buildScopeSql`.
- [x] Import hardening, moved to Phase 8b below and completed there.

Verified on the preview, three transfers at different stages. All three
reconcile, including one carrying a 22-record typing backlog. Written up in
`RECONCILIATION.md`, including the four failed attempts at querying the funnel
live and why it became a computed table.

## Phase 8b: an import that cannot fail quietly: DONE

Each of these was a silent failure, which is the worst kind an import has. A
rejected row is visible. A row that imported against nothing, or imported
twice, is not.

- [x] **Auto-link to the parent transfer.** Resolved at validate through
      `v_transfer_stoves`, the same chain the funnel counts, so a record and
      Partner Records can never disagree about which consignment a sale came
      from. Nullable: about one serial in twelve matches nothing, which is an
      exception a human works, not a reason to refuse the row.
- [x] **Header mapping.** `inspect` reports which columns are understood, which
      are not, and which required fields nothing feeds. The step appears only
      when there is something to decide, because a confirmation nobody can fail
      is a click that trains people to click.
- [x] **Duplicate detection inside a file.** A repeated serial becomes an
      exception naming the row it repeats. It used to import twice and fail at
      commit as a stove-already-sold error, which reads as a stock problem
      rather than the typing one it is.
- [x] **Duplicate upload detection.** SHA-256 over the parsed rows, so
      re-saving a spreadsheet still matches. A warning, never a block: a
      partner can legitimately return the same serials after a correction.
- [x] **Manual single-record entry.** A batch of one through the same
      validator, stock check, exceptions queue and audit trail. A second write
      path is how the two drift apart.
- [x] **The row cap, stated.** Read from `import.max_rows`, shown with the
      file's own count before staging rather than discovered after it.

Migration `20260821020000_data_center_import_hardening.sql`. Applied to the
preview branch and recorded in its migration history.

Verified: `e2e/data-center-import.spec.ts`. Six tests hold the surfaces, and
three run against the real server on the preview branch: the same serial twice
in one file names the row it duplicates, a valid row reports as matched to its
transfer, and the same file uploaded twice warns with a way to proceed. Every
test file carries a unique marker, because the duplicate check hashes the
parsed rows and a fixed file would match the previous run.

## Phase 9: Explore, and one page per area: DONE

The module is one long scrolling page today. It becomes a hub.

- [x] `Explore` card grid at `/data-center`, one card per area, a locked card
      shown locked rather than hidden.
- [x] Child routes for dashboard, call centre, partner records, stove records
      and import.
- [x] `DataCentreShell` carrying breadcrumbs and back navigation, reusing
      `src/components/ui/breadcrumb.tsx`, which already exists.
- [x] No change to `DashboardLayout.tsx`: `deriveCurrentRouteFromPath` already
      falls through to `segments[0]`, so the sidebar stays highlighted.

Verified: `e2e/data-center-explore.spec.ts` covers the cards, the routes,
breadcrumbs, back navigation, sidebar highlighting on every child, the locked
card, the refusal page when a locked route is reached by URL, and the funnel
being read rather than counted.

## Phase 10: the call agent role, and a fifth outcome: DONE

- [x] `call_agent` added to `module_access.access_role`. A widened CHECK, so no
      existing row changes.
- [x] `unreachable` added to `verification_outcome`, in the Phase 8 migration.
      Existing rows untouched: nothing becomes unreachable without an agent
      saying so.
- [x] `call_agent_profiles` for enablement and per-agent capacity. Separate
      from `module_access` because holding the role is a permission question
      and being on shift today is a scheduling one, and they change on
      different days for different reasons.
- [x] **F1 fixed.** `ROLE_FEATURES` was copied verbatim into three edge
      functions. It now lives in `_shared/data-center-roles.ts` and is
      imported, so a fourth level cannot disagree with itself.
- [x] **F2 fixed.** Two of `data-center-write`'s five actions are reads, and
      all five were gated on `call_records.edit`. `form_schema` and
      `call_record` re-gate to `call_records.view`, so a viewer can open a
      record instead of meeting a 403 that reads as the module being broken.
- [x] The access manager offers three levels with a line each on what they
      mean, and a select rather than a two-way toggle.
- [x] `assignment.*` settings written, so Phase 11 has them from its first run.

The call agent's set is deliberately not a superset of editor and not a subset
either. Read the records, edit the call records, see the dashboard, import
nothing: a person paid to make calls has no reason to move stock, and
`import.upload` is one step from `import.commit`.

Verified: `e2e/data-center.spec.ts`. A call agent is admitted, is offered the
call centre, and finds import locked; `data-center-import` refuses their token
and names the grant it wants, which is the part a locked card cannot prove.
`data-center-write` accepts it, which is what shows the level reached the
server rather than only the browser.

Two more hold F2 from both sides: `form_schema` answers a viewer, and saving
still refuses one. The existing read-only test never caught the bug, because
the manager account has no assigned organizations, so its queue is empty and
the assertion behind the row guard never ran.

The seed gains a fourth partner nobody is assigned to. Without it the only
editor account holds every partner, so there was nothing out of scope to reach
for and the staging scope check had nothing to prove itself against.

## Phase 11: the assignment engine: DONE

- [x] `assignment_batches` and `assignment_items`, with a partial unique index
      on `(sale_id) where is_active`. That index is what makes two agents
      ringing the same buyer impossible rather than unlikely.
- [x] One partner per batch, enforced by a trigger rather than by the engine,
      because the engine will not be the only thing that ever writes here.
- [x] `assign_batches()`: agent-first, since capacity is the binding
      constraint. The agent's last partner wins while it still has callable
      records, then the biggest backlog. Advisory lock 8150621, beside the
      metrics run's 8150620.
- [x] `reclaim_stale_batches()`: quiet past the configured age, or the agent
      stopped taking work. Staleness measures from `last_activity_at`, touched
      by attempts and record saves, so steady work never looks quiet.
- [x] `v_callable_records`: the one definition of outstanding work. Nothing
      concluded, attempts left under `callback_limit`, not already assigned.
- [x] Batch size, capacity, stale age and per-partner overrides read from
      `workflow_config` at run time.

Verified against the preview database directly: one run hands the 5 callable
records to the enabled agent, a second run assigns nothing, disabling the agent
reclaims the batch and returns all 5 to the pool, and the same-partner trigger
refuses a stray item with a check violation.

## Phase 12: the assignment and call log: DONE

- [x] `v_assignment_log`: one row per assigned record, joined to the latest
      attempt through a lateral, with outcome ids resolved to labels through
      the registry like the call centre view does.
- [x] An `assignment_log` action on `data-center-read`, keyset paginated on
      `(assigned_at, batch_id, position)`, filterable by partner, agent, batch
      state, outcome and date, all server-side. Gated on `records.view` and
      scoped through `buildScopeSql` like the queue.
- [x] `data-center-assign`: `run` and `reclaim` for super admins, `status` for
      dashboard holders, `my_batches` scoped to the caller's token with no
      parameter for asking about anyone else.
- [x] `AssignmentLog.jsx` on the Call Centre page: the log, CSV export, and
      the two levers for admins, answering in the same table they act on.

Verified: `e2e/data-center-assignment.spec.ts`. The log renders the engine's
work, the levers appear only for admins and the endpoint refuses a non-admin
regardless, a call agent reads their own single-partner batch, and no log
request carries an offset.

## Phase 13: the metric engine and five scorecards: DONE

One engine and one component, parameterised by dimension. Five separate
implementations would be five places for the same number to disagree.

- [x] `compute_scorecards()` writes seven metrics per dimension, the dimension
      as data: `{by, key, label}` in the snapshot jsonb. Called by the compute
      run after the funnel refresh, same run id, so the dashboard swaps to a
      new set atomically. Adding a sixth dimension is one row in a VALUES list.
- [x] Two sources, stated in the migration: partner, location and sales rep sum
      `transfer_funnel` (what was shipped); call agent and manager count
      assigned records (what was handed out), reclaimed batches excluded.
- [x] One `Scorecard` component, five instances on the dashboard.
- [x] Drill-through as a URL: a status cell links to the call centre queue with
      the dimension and status as search params. The route validates them, the
      page translates them to the new server filters (`outcomeGroup`,
      `partnerState`, `transferSalesRep`, `assignedAgent`, `agentManager`),
      and the queue names what narrowed it. Back restores the dashboard
      because nothing was component state to begin with.
- [x] CSV export on every scorecard; the queue it drills into already has one.

§3.4 holds by construction: `unresolved` is defined as the remainder, so the
four statuses always sum to the reconciling column, digitalised for shipments
and issued for people. Proven against the preview across all five dimensions,
and asserted row by row in `e2e/data-center-scorecards.spec.ts`.

The brief asked the statuses to reconcile to Received; they reconcile to
Digitalised, and RECONCILIATION.md says why the difference is a real number
(the typing backlog) rather than an inconsistency.

Still open here: capacity at 500,000 was proven for the funnel refresh and the
metric reads in Phases 6 and 8; the scorecard pass itself is sums over the
funnel table and one pass over assignments, and should be re-measured against
the 500k local set before merge.

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

## Phase 14: the UI overhaul: DONE

The module worked and looked like scaffolding. Eleven different jobs were
eleven identical white cards with gray borders, the olive identity was
hardcoded 123 times, eight dashboard figures and five breakdowns led nowhere,
the record editor was a hand-rolled panel clipped by the card it rendered
inside, two irreversible actions asked window.confirm, and twelve responsive
utilities covered 3,936 lines.

- [x] **One palette, five accents.** `theme.css` holds every colour as a
      `--dc-*` token on `:root`, and a `data-area` attribute on the shell gives
      each area its own hue from its Explore card through to its pages. On
      `:root` rather than the wrapper because portaled dialogs render outside
      it. Written up in `DESIGN.md`.
- [x] **Every dashboard figure is a door.** Eight cards, four breakdowns and the
      disagreement callout link to the rows they counted, as URLs, through
      filters the server already accepted. Stove Records gained the drill
      machinery the call centre had; the call centre route gained `preset` and
      `verificationOutcome`. Stock by status stays plain: no surface lists
      stoves that way, and a link that lands close enough is worse than none.
- [x] **Real overlays.** The record editor is a centred dialog at 90% of the
      viewport, portaled, with Escape, focus trap and scroll lock from the
      primitive. The two import confirmations are centred and content-sized:
      a two-button question stretched to 90% reads as an error. The access
      search results are a popover, which no ancestor can clip.
- [x] **A phone can use it.** The two virtualized tables render each record as
      a card below `sm`, driven by the same breakpoint the classes use, because
      a virtual window is arithmetic over a row height. The three real tables
      pin their first column. Scrollers are `maxHeight: clamp(320px, 62dvh,
      560px)`, so five rows do not sit above 340px of white.

Verified: the full Playwright suite, 71 tests, green before and after. The
mechanical detector went 7 findings to 1, and that one pairs a resting text
colour with a hover background the same hover recolours. Two screenshot rounds
at 1280x900 and 390x844 across all six surfaces plus both dialogs; the finish
review ran inline from the skill's degraded reference, because the shipped
reviewer agent is not registered here.

`PRODUCT.md` and `src/app/data-center/DESIGN.md` are written.

## Phase 15: Settings, and assignment a person can direct: DONE

Three things the module claimed and could not do, plus the surface to put them
on.

- [x] **Settings is the sixth Explore card.** Access and the change log were
      two panels below the hub's grid, so everyone opening the module on their
      way to a queue scrolled past a user list and an audit log to get there,
      and the two surfaces that most need room to read had the least. Its own
      route, its own graphite accent, gated on `grants.manage`.
- [x] **The log reads as a log.** It rendered the audit table as it is stored:
      an action word, a table name and a primary key. The category is derived
      in the query and the changed field names come from the diff between the
      two snapshots the trigger already kept, so a line now says who did what
      to what and which fields moved. Filter chips per category, grouped by
      day, and it exports.
- [x] **The call form is editable.** `field_defs` and `option_values` have
      driven the renderer since the first migration, and nothing could add a
      row to either: adding a question took a migration written by someone who
      writes migrations, which is not who knows what to ask. Settings edits
      both, gated on `registry.manage`, which existed from the start and was
      enforced nowhere. Nothing deletes; a question retires and a choice
      deactivates, because records point at both.
- [x] **"Something else" is an outcome.** The nine seeded ones came from the
      workbook's Key tab, which is a closed list, and the July data shows what
      an agent does when a call does not fit one: RESPONDED, REPONDED and NO
      PHONE NUMBER were typed straight into a constrained column. Choosing it
      makes `call_attempts.note` required, which is the column that was always
      there.
- [x] **The variables are variables.** `workflow_config` held batch size,
      callback limit and staleness precisely so they would never be hard-coded,
      and twenty was as fixed as if it had been. The panel reads the input type
      off the stored jsonb rather than a list of key names, so a setting added
      by a later migration appears without being named in two places.
- [x] **Features tick on per person.** `feature_grants` existed with no UI. The
      access list opens each person to the nine keys; the level is the baseline
      and a tick is an addition. Ticking `grants.manage` is how somebody who is
      not a super admin comes to see Settings at all.
- [x] **Assignment can be directed.** The engine handed work out well and
      nobody could see it or overrule it. `assign_batch_manual`,
      `unassign_batch` and `unassign_item` are a second door onto the engine's
      own tables under the same advisory lock: a record cannot be in two
      batches because that is a partial unique index, not a rule each new
      function has to remember. The console lists agents with their load,
      drills agent to partner to serial to record, and assigning twice is how
      one agent ends up with ten of one partner and ten of another.
- [x] **Pagination and a column picker.** `usePaged` plus a `Pagination`
      component for the lists that are read a screenful at a time; the two
      genuinely large tables stay keyset-paginated and virtualized and never
      come through it. `ExportButton` takes columns with all/none, because an
      export that is the input to something else has to be able to leave
      columns out.

Verified against the preview database and the deployed functions rather than
locally: `unassign_batch` released 5 into the pool, `assign_batch_manual` took
3 and then 2 more to the same agent past a configured capacity of 1,
`unassign_item` returned one and reclaimed nothing it should not have, and
`agent_detail` reported 4 items across 2 batches with serials and numbers for
the drill. On the registry side, adding a question returned 200 and it appeared
in the next read, retiring it kept the row and stamped `retired_at`, a key the
database cannot live with was refused, a dropdown naming no list was refused,
and an invented setting key was refused. The change log attributed every one of
them to the right person with the right changed fields.

## Phase 17: a register you narrow, a history you page, a path you can follow

Four surfaces, one theme: half a million records has to be navigable without
scrolling through it, and a job with a step outside the app has to say so.

| Surface | Was | Is |
|---|---|---|
| Stove record | every audit row it was handed, and it was handed fifty | the newest five with the total beside them, paged on a keyset cursor; calls and imports collapse the same way |
| Call brief | five white blocks | five blocks each carrying the accent of the area its facts come from, solid headers rather than tints |
| Stove Records | search, two statuses, two dates | eleven filters, every value picked from a list, every active one a chip that comes off on its own |
| Bulk Import | opened at "choose a file" | three numbered steps, starting with the prepared sheet that used to live only in Partner Records |

### Two defects found while proving it

- **The sales-rep filter could never have matched.** It compared a sale's
  `transaction_id` with a transfer's. Same column name, different reference, no
  overlap - so the sales-rep scorecard's drill-through opened an empty table
  every time, and an empty table is what "no results" looks like too.
- **The "Sold by" list filtered on a hand-written list of roles.** Two of the
  roles named do not exist, and the role that had recorded every sale on the
  preview was not on it.

### And two the fresh-eyes pass found in this phase's own work

- **The change cursor lost its microseconds** to the driver's `Date`, which
  would have skipped every audit row sharing a millisecond. See CLAUDE.md.
- **A date typed into the panel half-overrode the period control**, keeping the
  period's other bound and leaving the control displaying a range the table was
  not on.

### Before this merges

Run `supabase/manual/20260822_records_filter_indexes_concurrently.sql` against
production first, alongside the three earlier manual index files. The migration
builds the same indexes without `CONCURRENTLY`, which takes a lock on
`public.sales` - harmless at eleven live sales, not harmless later, and the
statements are `if not exists` so the migration finds them already built.

### Still open in this phase

- **Neither big table exports.** `CLAUDE.md` requires that every table a
  scorecard drills into exports CSV, and neither Stove Records nor the call
  queue does. It is not a twenty-line addition: with a 5,000-row display
  ceiling over a 12,000-row match, "export what is loaded" is a file that
  quietly omits half the answer. The honest version streams the filter
  server-side, and that is its own slice.
- **`record_facets` costs about 2.5 s** on the preview against ~1.8 s for the
  single-query dashboard. Six statements on one connection are serial, not
  parallel. Acceptable for a once-per-mount call; worth folding into one
  statement if it is ever asked for more often.

## Phase 18: work that survives being interrupted

Two surfaces, one observation: the people using this module are interrupted
constantly, and both of the places they type into lost work when they were.

### A call that cuts off

The call form keeps itself as the agent types - two seconds after typing stops,
and again on a deliberate close. Reopening puts the answers back with a banner
saying whose they are and that nothing has reached the record. The agent's own
dashboard ranks unfinished calls above stoves nobody has rung.

`data_center.call_drafts` is its own table rather than a column on
`call_records`, and the reason is load-bearing: `has_call_record` is literally
`(cr.sale_id is not null)`, so creating that row to hold a draft would have made
every half-typed form read as a record the call centre had worked. Full
reasoning in CHANGING-THE-CALL-TABLE.md.

Keyed by the sale, not the agent, because records move between agents and a
draft keyed to whoever typed it would be stranded on every reassignment.

### A bench somebody types forty receipts at

The consignment now sits beside the form: every stove ID at a glance, a search
that matches anywhere in the ID, a progress bar, one click to switch, and
**Save and next** - which is the old back-find-click-wait sequence as one
button. Ctrl+S saves a draft, Ctrl+Enter finishes and opens the next.

The consignment's stoves are fetched once when it opens and shared by the table
and the rail, so moving between records costs no round trip.

### What the tests nearly missed

The bench spec's helper clicked `tbody tr` through three tables that share that
selector, raced the render, and returned false - so all four tests skipped.
Four green skips proving nothing, while the feature went unchecked. The helper
now waits on something that exists at exactly one depth.

## Phase 19: a send-back that reaches somebody

The correction loop existed and told nobody. It now routes, notifies and
closes, and the routing is configuration rather than code.

| | |
|---|---|
| **Settings** | choose the standing recipients; link each ERP rep name to an account |
| **Routing** | recipients always; the mapped rep as well, when there is one |
| **Banner** | above every page in the module, summary only, opens the list |
| **List** | rep → partner → stove ID, each ID a link into the record |
| **Closing** | a note first, which the call centre reads before ringing again |
| **Level** | new `sales_rep` access role, one key, nothing else reachable |

### The finding that shaped it

`stove_transfer_history.sales_rep` is free text. In production, 11 of 23 names
match an app profile and the three largest by volume do not. Four values are
not people. Name-matching would have routed most of the volume to nobody in
silence, so the link is made by hand and the gap is a visible row.

### Still open

- **No email.** In-app only, by decision. A real send needs a service, a
  from-address, bounce handling and a digest rule so twenty send-backs are not
  twenty emails — its own slice, worth doing after the in-app path is proven.
- **A rep must still be granted the `sales_rep` level by hand** after being
  linked. Deliberate: a routing screen that granted module access would be a
  door that does not look like one. Settings reports the gap rather than
  closing it silently.

### Deliberately not done

- **Promoting a question to a real column.** The registry supports it and
  Settings does not perform it: a column has to exist before anything can be
  written to it, so offering that as a button would be offering a failure. It
  stays a migration.
- **Capacity enforcement on a manual assign.** `assignment.max_open_batches`
  binds the engine and not a supervisor, because overriding the engine is what
  manual assignment is for. Proven: a second batch landed on an agent already
  at a capacity of 1.

## Phase 16: the stove record, and one period for every surface: DONE

The module could describe populations and could not describe one stove. Every
surface answered a question about a group - which partners are behind, which
agents are busy, what arrived on Tuesday - and the question people actually
walk over and ask is "what happened to this one?". Answering it meant opening
Partner Records for the transfer, Stove Records for the sale, the call queue
for the verification and the import history for who typed it, then joining four
screens by eye.

- [x] **`/data-center/stove/<id>`, the record.** Nine sources gathered on one
      page: the register that issued the serial, the consignment that sent it
      to a partner, the sale it became with every field the Sell Stove form
      collects, the file or the bench that typed that sale up, what the call
      centre added on top, every call anybody made, and every field anybody has
      edited since. Read together in one round trip, because a person holding a
      serial is asking one question.
- [x] **A journey strip.** The module's own reconciliation funnel, restated for
      one stove: issued, transferred, paper back, sold, typed up, called,
      verified. It lives in `journey.js` rather than in the component, because
      the partner scorecards count exactly these stages across a batch and a
      page that invented its own stage names would be a second definition.
- [x] **Every name that is a thing is a door.** The partner opens Partner
      Records at that partner, the rep opens their records, the agent opens
      their queue, and a neighbour on the same consignment opens its own
      record. Nothing on the page is a private copy of another surface.
- [x] **The finder.** One box taking either of the two things written on paper:
      the serial off the label or the reference off the consignment note. An
      exact serial navigates rather than listing a result of one; a partial
      serial is a shortlist, because half a number read off a scuffed label is
      the normal case; a reference opens the consignment.
- [x] **One period control, everywhere.** Days, weeks, months, quarters, half a
      year, whole years picked several at a time, or a custom range. This year
      by default. Held in the URL like every other narrowing here, so back
      restores it and a filtered view can be sent to somebody. Partner Records
      gained a server-side date filter to take it.
- [x] **The one-stove-one-owner rule, made visible.** Both halves were already
      enforced at the only door a sale comes through, and the phone comparison
      already ignores the country code. What was missing was any way to see it
      from a record; the stove page asks, and says so loudly if a number turns
      up on another sale.

Verified against the deployed function rather than locally: `stove_detail`
returned all nine sections for a real serial with 56 sale fields, 150 stoves on
its consignment and two change-log entries; `stove_search` resolved an exact
serial to a record, a five-character prefix to 25 candidates, a transfer
reference to its consignment and a nonsense string to a stated nothing;
`period_bounds` reported the register's true earliest date; and the funnel
returned 2 of 3 consignments for July. The period boundaries were checked
against a fixed date by hand, including the two that cross a year: last month
in January is December of the previous year, and last six months in January
starts in August.

### A question for the owner, not taken here

**Should `public.sales` carry a unique index on the phone comparison key?**

Today the rule is enforced in `create-sale`, which every writer goes through -
the Sell Stove form, the digitalisation workbench and the bulk import all
commit that way, so all three inherit it. A unique index would make the rule
impossible to break rather than merely refused, which is stronger.

It is also a change to how the *sales app* fails. Every other writer would
begin seeing a raw Postgres constraint error in place of create-sale's sentence
naming the sale that already holds the number, and any legacy row that already
violates it would fail the migration. Production holds no violations today, but
production holds eleven live sales; that is the rule holding for want of data,
not the rule being enforced by the database.

`supabase/manual/20260821_sales_phone_tail_concurrently.sql` carries the check
to run against production before trusting any page that reports on this.

### Deliberately not done

- **A period control on the Dashboard.** The scorecards read precomputed values
  from `metric_snapshots`, which is what makes them load at 500,000 rows. A
  date filter there is not a filter, it is a recompute per range, and offering
  a control that silently did nothing would be worse than not offering one.
  Ranged metrics are a compute change, not a UI one.

  **Partly overturned by Phase 20**, and worth reading as a correction rather
  than a reversal. The reasoning holds exactly: it IS a compute change, and
  Phase 20 made it. Every Analysis metric is filed at month grain, so any range
  is a sum of months and the control narrows something real. What the entry got
  right and Phase 20 kept is the refusal to offer a control that does nothing -
  which is why the month grain went into compute rather than a date picker into
  the UI. The Dashboard scorecards themselves are still unranged and still
  offer no period, for the original reason.
- **A period control on the stove record.** The timelines on that page are one
  record's own history. A filter there would hide calls somebody made, which is
  the opposite of what a complete record is for.

## Phase 20: Analysis, the seventh area

Six areas collect. None of them said what the collection meant. The Dashboard
counts states - 40% unverified - and says nothing about why, who, or where.
Meanwhile `baseline_stove` and `current_stove` had been collected on every call
since Phase 4 and had never once been aggregated.

Analysis is the area that turns the data into decisions. Slice 1 is the two
questions the owner named: which partner is sitting on stock, and how much of
what was sold is actually usable.

### What it computes

`data_center.compute_analysis(p_run_id)`, a third function beside
`compute_metrics` and `compute_scorecards`, called inside the same run id, the
same connection and the same advisory lock, so Analysis and the Dashboard can
never disagree about as-of-when.

| Metric | Shape | Answers |
|---|---|---|
| `analysis.stock_age` | partner or state x age band | Which stock is past the line, and who holds it |
| `analysis.absorption` | partner x (eligible, within window) | Whether a partner is slow by habit rather than by circumstance |
| `analysis.velocity` | partner x days-to-sell band | How long stock takes to move, as a distribution |
| `analysis.yield_funnel` | partner x gate | How much of what was sold survives every gate |
| `analysis.yield_leak` | partner x reason | What stops the rest, one reason per record |

**Creditable** is the point of the second half. Verified is not the finish
line: a record also has to be complete on the module's own definition (never
`sales.status`), have its stove ID confirmed, not be flagged as a second Save80
in a household already counted, not be waiting on a correction, and not share a
phone number with another sale nobody has confirmed.

### Every metric carries a month, and that decided the rest

Analysis has to answer a month, a quarter, six months, one year, and one year
against another. Precomputing each named period multiplies both the rows and
the passes over `sales` by the number of periods offered, and still cannot
answer a range nobody thought to list.

So every metric is filed by month and every range is a sum of months. Quarters,
halves, years, rolling windows and year-on-year all fall out for free with no
compute change, and "year on year" needed no feature of its own: count the
months in the range and step back that many.

The price is that **every stored measure must be summable**. A sum of monthly
counts is the range's count; a sum of monthly medians is nothing at all. That is
why `velocity` stores a histogram rather than a median and p90, and why
`absorption` stores two counts rather than a percentage - a stored rate carries
no denominator and cannot be re-aggregated, so the client divides.

### The reconciliation the whole area rests on

Three properties, proved against the preview before any durable test was
written and now asserted by `e2e/data-center-analysis.spec.ts`:

- The stock bands sum to the unsold count, and the partner cut equals the
  location cut. They would not if a band had a gap, which is why band floors
  are derived with `lag()` from the top edge above them rather than stated, and
  why the run raises rather than starting without an open top band.
- The yield funnel never widens as it goes down, because each stage's filter
  contains the one before it.
- The leak reasons sum to sold minus creditable, because every non-creditable
  sale is charged to exactly one reason - the first gate it failed. Overlapping
  tags would turn a decomposition into a word cloud that adds to more than the
  problem.

Measured on the preview: 425 unsold stoves, bands summing exactly, 148 in the
15-29 band, 199 in 30-59 and 78 in 60-89.

### One ordering that is load-bearing

`never_called` is tested before `not_verified`. `not_verified` is the column's
DEFAULT, so a record created the moment an agent opened it carries that value
having never been dialled; only `attempt_count` separates "we rang and got
nowhere" from "we have not rung". The preview surfaced this directly - three
call records, all `not_verified`, none with a single attempt. Reversed, the
chart would report the call centre as having failed on work it has not been
given.

### The frame, and why it is a component rather than a habit

`ChartFrame` makes render, drill and export one contract. This ROADMAP has
carried "no drill-down from a chart" as a standing gap since the dashboard bars
shipped twice without one, and CLAUDE.md already requires that every scorecard
exports and that drill-through is a URL. A chart showing a number nobody can
open and nobody can take away is a picture of an answer.

It throws in development when a chart has neither, and the e2e spec checks the
contract from the outside so it also holds for charts nobody has written yet.

It also renders an `sr-only` list of the same cells as real links, because an
SVG `<Bar onClick>` is neither focusable nor nameable. That makes every mouse
drill reachable by keyboard, and it lets specs assert by role instead of
clicking SVG paths.

### Charts: recharts for axes, DOM for grids

recharts was already a dependency at `^2.15.4` with a wrapper at
`src/components/ui/chart.tsx` that nothing imported, so the standing
hand-rolled-visuals policy - which exists to avoid `package.json` and
`bun.lock` churn in the daily contractor merge - does not bite here.

The heatmap is a real `<table>` regardless. recharts has no heatmap mark, and
the scatter-of-squares workaround gives cells that do not tile and fragile
hit-testing. As a table it is keyboard navigable, readable by a screen reader,
its cells are already anchors so drill-through needs no click handler, it
prints, and a test can sum it - which is how the margin reconciliation above is
actually checked rather than asserted in a comment.

### A new surface, because the drill had nowhere to go

`/data-center/stock`, over `public.stove_ids_base`. No filter could ever have
reached this population: `records`, `call_queue` and every other list is built
on `v_sold_stoves`, which begins `from public.sales`, and a stove that has not
been sold has no row in any of them. A different set, not a narrower one.

Its band filter is a **code**, resolved server-side against the same
`data_center.age_bands` function compute bucketed with, so the list cannot come
to mean something the chart did not, and re-grading a band in Settings moves
both together.

### Permission

A new key, `analysis.view`, held by `data_manager` and nobody else. Not
`dashboard.view`, which every level in the module holds: Analysis crosses what
a buyer told an agent on the phone with the partner and the place they bought
in, and the module already keeps Table 1 and Table 2 as separate grants for
exactly that reason.

The same commit reconciled a drift it would otherwise have deepened. The server
`FeatureKey` typed `access.manage`, which no level granted and no UI could
offer, while the admin function's own gate, the Settings page, the Explore
card, two specs and the `data_manager` comment all used `grants.manage`, which
was not in the type at all. There was only ever one permission there.

### Three defects found while building, all real

- **The funnel time series was stacked.** Its stages are nested subsets, so
  stacking counted the same record up to five times and the top edge of the
  chart was a number describing nothing.
- **The heatmap footer summed every row while the body drew the first twenty.**
  The visible table did not add up to its own total, which would have failed
  the margin test against correct data.
- **`p()` returned `1` where it meant `$1`.** Every filter it built landed in
  the SQL as a bare integer. The unfiltered list worked and so did
  `organizationId`, because that parameter comes from `buildTransferScopeSql`
  rather than from the helper - which made a typo look like a filter problem.
  Found by probing one filter at a time against the deployed function.

### Still open

- **Boards 3 to 7 are designed and not built:** data integrity by partner and
  rep, fuel and baseline displacement, sales-model performance, call centre
  throughput, and audit exposure. Slice 1 was the owner's two stated priorities
  plus the machinery the rest will reuse.
- **`baseline_stove` and `current_stove` are still jsonb.** They graduate to
  real columns when Board 4 lands, per the module's own rule. Note the
  transition trap: `splitPayload` routes new writes to the column while old
  rows keep the value only in `answers`, so compute must coalesce until the
  backfill lands or the chart shows a cliff on the flip date.
- **No index yet supports the ageing scan.** `stove_ids_base` indexes
  `factory`, `is_archived` and `sales_reference` only. A
  `CREATE INDEX CONCURRENTLY` file is needed in `supabase/manual/` before this
  meets production volume.
- **`call_records` has no `verified_at`**, so "verified in month M" is a cohort
  (sold in M, now verified), not an event. Stated wherever it is drawn.
- **Not measurable, because not collected:** fuel spend, household size,
  cooking time, and usage over time. The highest-value additions to the call
  form are household size, fuel spend or collection time, and a `verified_at`
  timestamp.

## Phase 21: getting the call centre's own backlog in, and merge preparation

Two pieces of work that both came out of asking what has to be true before this
branch merges.

### The call sheet

`import_batches.source` has permitted `call_center` since the first migration
and nothing ever wrote it. Agents kept their own spreadsheets, one week of the
workbook holding 359 stove IDs, and the only way in was the call form one
record at a time.

Built on the existing batch machinery rather than beside it, but with its own
actions rather than by branching the receipt path: entangling the two would
have put the thing that already works and is tested at risk for a feature that
shares nothing with it but the table it stages into. The write goes out through
`data-center-write`, which is the receipt import's own rule (never touch
`public.sales` directly, always go through `create-sale`) applied on this side.

The detail that decided the shape: the call dates have to become
`call_attempts`, or every imported record reads `attempt_count = 0` and
Analysis reports the backlog as `never_called`. Phase 20 had already found that
`not_verified` is the column's default and means nothing on its own; this is
the same trap arriving from the other end.

Proved on the preview with a six-row sheet covering every case. 2 valid, 3
exceptions, 1 rejected. Excel serial 46234 read as 2026-07-31, `05/07/2026` as
day-first. Attempts landed as 3 and 1. Rollback removed both call records and
left both sales standing.

### The rollback guard

Rolling back a receipt import deletes each sale through `delete-sale`, and six
`data_center` tables cascade off that. `IMPORT.md` described this as something
rollback "cannot undo", which reads as a limitation and was a deletion: a
rollback after agents had started calling destroyed their work with no warning.

It now counts first and refuses with the number named. A clean batch still
rolls back exactly as before, which is asserted alongside the refusal, because
a guard that turned every rollback into a refusal would be its own defect.

Also released the import claim on successful commit. It is a lock held while a
batch commits, and leaving it behind quietly made an import once-ever. Preview
still carries two such claims from 21 August, both on committed batches, which
is the condition this prevents.

### Deliberately not done

- **A bulk exception fix.** Resolving an exception is still one corrected
  serial at a time. On a 359-row week that is roughly 30 rows, which is an
  afternoon rather than a project, and every one of them is a judgement about a
  specific receipt.
- **Reconciling the refusal status.** `data-center-import` reports a missing
  feature grant as 400 through its own `BadRequest`; `data-center-read` reports
  the same condition as 403 with `code: "no_feature"`. The import one is wrong
  - the caller's request was not malformed, they were not allowed - but it runs
  through every action in that function, and changing it during merge
  preparation would be a wide blast radius for a cosmetic gain. The call-import
  spec asserts "refused, and names the grant" rather than pinning either
  number, so reconciling it later will not break a test.

---

## Phase 22: production, ahead of the merge: DONE (2026-08-23)

The database and the functions went to production **before** the merge, so the
step that auto-deploys to every user is last and depends on nothing that is not
already there. Nothing is merged; the route key is still `super_admin` only and
production carries zero access grants.

### What ran, in this order

1. **`supabase db push`** applied **31 migrations**. Not 30, which is what the
   plan said until the dry run counted them.
2. **`idx_stove_ids_unsold_age`** created separately. It is the one index in
   `supabase/manual/` with no migration counterpart, so `db push` does not make
   it and the stock ageing page would have run a sequential scan for ever
   without anything saying so.
3. **Seven edge functions deployed.** The six new `data-center-*` first,
   because nothing can call them, and `create-sale` last and alone.

### What the numbers say

| | before | after |
|---|---|---|
| `data_center` schema | absent | 24 tables, 11 views, 19 functions |
| migrations recorded | 1 | 32 |
| indexes on `public.sales` | 9 | 16 |
| **sales / stock / transfers / orgs / profiles** | **45 rows (17 live) / 15,498 / 497 / 398 / 523** | **unchanged** |
| public tables | 26 | 26 |

Registry seeded: 13 option lists, 82 option values, 13 field definitions, 28
workflow-config keys. `pg_trgm` installed. Zero rows in `module_access`,
`feature_grants` and `call_records`, which is the correct state for a module
nobody has been let into yet.

### The two things worth proving rather than asserting

**PostgREST cannot reach `data_center`.** Asking for it by name answers
`PGRST106: The schema must be one of the following: public, graphql_public`,
while the same request against `public.sales` answers 200. That is the
guarantee the whole module rests on, and it is now checked on production rather
than inferred from `config.toml`.

**`db push` does not run `seed.sql`.** Reported as `"seeds":[]` by both the dry
run and the real run. That file writes to `public` and carries a header warning
never to run it against production; it is reached by `db reset` and branch
creation, not by a migration push. Previously reasoned; now observed.

### Corrections this made to the written plan

- The manual index directory is **skippable on a first deploy** and was skipped.
  Seven of its eight indexes have migration counterparts and build in
  milliseconds on a table of 45 rows, so the write lock it exists to avoid
  never happens. It earns its place when `public.sales` is large, which is the
  situation it was written for and not the one it first met.
- `CREATE INDEX CONCURRENTLY` **cannot run through the Management API** at all:
  it cannot run inside a transaction block and `/database/query` opens one.
- `POST /v1/projects/{ref}/database/migrations` exists and **ignores the version
  you give it**, stamping its own timestamp. Applying migrations that way would
  leave production's history permanently out of step with the repo, so a later
  `db push` would try to re-run all 31 including the seeds. Tested on preview
  and rejected as a route.

### Still to do before the merge

Confirm `VITE_SUPABASE_URL` in the Vercel production environment. The value is
encrypted and could not be read from here; every other Supabase call in the app
already resolves through it, so the risk is small, but `manageProfileService`
now depends on it too.

---

## Phase 23: the money and the cancellation, told the same way twice

The Data Center lives inside the sales app and must never tell a different
story about the same stove. Two places where it currently can.

### What was actually found

**Cancellation is already carried.** `stove_detail` selects `cancelled_at`,
`cancel_reason` and the canceller's name, and the stove record renders a red
banner with all three. An earlier note in this file claiming a cancelled stove
"would show nothing" was wrong: it was reasoning from `cancelled_purchases`,
which is **cancelled ERP transfers** and holds zero rows. An end-user sale is
cancelled in place on `public.sales`.

**But the status pill is unreachable.** It tests `is_archived` first and
`cancelled_at` second. In production those are the same 28 rows, with zero
archived-and-not-cancelled, so the red "cancelled" pill can never render and
every cancelled sale reads as the grey "archived". The sales app says
cancelled; this says archived. That is the contradiction.

**Payments are not read at all.** 32 of the 45 rows are installment sales, and
`installment_payments` holds 36 rows nothing in the module has ever opened.

**And the two sources already disagree**, on 4 of 33:

| Sales | State |
|---|---|
| 29 | `sum(payments)` equals `total_paid` |
| 2 | installment sale marked `partially_paid`, **no payment rows** |
| 1 | payment rows on a sale **not flagged** installment |
| 1 | `sum(payments)` <> `total_paid` |

That is the whole argument for how this gets built. Showing a payment list
beside a summary total, with no reconciliation, puts two contradicting numbers
on one screen and lets the reader pick. About one installment sale in eight
would do it.

### What gets built

**Nothing is stored.** No migration, no new table, no column. Both are reads
over `public` tables the sales app already owns, which is the module's standing
rule: it holds facts *about* sales and never a second copy of one.

1. **Payment history on the stove record.** Date, amount, method, who recorded
   it, note, and the proof where one exists, newest first, under the money
   block that already shows the plan and the running total.

2. **A reconciliation line, always.** The sum of the payments against
   `total_paid`. When they agree it says so quietly. When they disagree it
   names both numbers and says which came from where. When a sale is flagged
   installment and has no payments it says that too, rather than drawing an
   empty list that reads like "nothing was paid".

3. **Cancelled reads as cancelled.** The pill tests `cancelled_at` first.
   `is_archived` stays as its own state for the archived-but-not-cancelled case
   that does not exist today and would otherwise silently reappear as the wrong
   word.

4. **The records table can tell them apart.** `cancelled_at` and
   `cancel_reason` join the column list, so a list of records distinguishes
   cancelled from archived, and both reach the export.

### What it does not change, verified

Cancelled sales are excluded from every count, queue, funnel and creditable
figure through `is_archived is not true`, consistently, in metrics, analysis,
assignment, transfers, records and send-back routing. This phase changes
presentation and traceability only. No number moves.

### The decision taken

Payment detail sits under `records.view`, the key that already exposes
`amount`, `total_paid` and `payment_status` on the same surface. Splitting the
running total from the payments that make it up would put two halves of one
fact behind two doors. A separate key is a one-line change if the proof images
later argue for one.
