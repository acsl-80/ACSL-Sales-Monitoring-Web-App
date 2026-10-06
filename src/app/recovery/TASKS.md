# Recovery tasks

Flat, one line per slice, newest first. States: todo, spec red, green, in
review, merged, live. The why lives in `decisions.md`; the evidence on each PR.
This file is also the module's handover: whoever picks the work up next reads
the newest section first.

## R1, the rig (Orezi's ask 2026-10-06: "yes, start R1")

State: **written, not yet run on a preview.** Branch `feat/recovery-r1`, not
pushed. Owner: Claude (lead), review by Codex.

- [x] Plan and build rules carried in: `PLAN.md`, `CLAUDE.md`, decision R-D1
- [x] Schema `recovery` with `module_access`, `feature_grants`, `change_log` and
      its audit trigger; usage revoked from anon and authenticated, row security
      on, no policies, not in `[api].schemas`. Migration
      `20261006120000_recovery_schema.sql`, ends with a check that raises if any
      lock is missing
- [x] The one change in public: a recoverer holds no organisation. Migration
      `20261006120100_recoverer_holds_no_organisation.sql`, decision R-D3
- [x] Feature keys `recovery.view`, `.edit`, `.import`, `.assign`, resolved per
      request in `_shared/recovery-roles.ts`; edge function `recovery-read`
      answers `access`
- [x] Role `recoverer` (routes: Recovery, Profile) and route key `recovery` in
      `permissions.ts`; one sidebar entry; empty page at `/recovery`
- [x] Proofs written: `e2e/recovery-r1.spec.ts` (8 tests, all parse) and
      `proof/r1-recoverer-reads-nothing.sql`
- [ ] Orezi runs both migrations on a preview branch database and pastes the
      readbacks
- [ ] Deploy `recovery-read` to the preview branch by hand (the integration does
      not). Until it is deployed, every non-super-admin's sidebar makes one
      failing request, which `non-interference` will report as a console error
- [ ] Run on the preview: `recovery-r1`, `non-interference`, `host-pages-load`,
      `data-center-pages-load`, `data-center`; run the SQL proof
- [x] Cross-family review: Codex (gpt-6.1-sol) reviewed 3862f2e blind, with a
      Claude lane alongside. Eight issues confirmed, all fixed in da198cf
      (unknown level read as access, migration checks, profiles lock timeout,
      sidebar cache bound to the user, spec and SQL proof false greens,
      production guard). Coverage partial: Codex marked several atoms limited
      because live database state was not in its evidence, and two Claude lanes
      failed on a runtime error. Artifacts in `.local/review-artifacts/`
- [ ] Codex re-check of da198cf
- [ ] Orezi's rulings: R-D4 (open holes, hardening first), R-D5 (where a
      recoverer lands)

### What was checked, and what was not

Checked: the app builds, `tsc` is clean, lint is clean on every changed file
(one fast-refresh warning, the same one the Data Center's `access.tsx` has),
all 517 specs parse, and a blind cross-family review ran (above).

Not checked: nothing has run against a database. The local Supabase stack here
held a stale database from August, and applying the pending migrations to it
was held by the permission check without an answer, so it was stopped and left
as found. `recovery-read` has not been typechecked (no Deno on this machine).

### Expected red on the first run

`a recoverer reads zero rows from every view in public` should fail until the
hardening in R-D4 lands: four plain views answer every signed-in account. It
is left asserting the rule rather than skipped, because a skipped test is not
a passing one.

### Next, after R1

- The Data Center's own sidebar hook has the cache flaw Codex found in this
  one (not bound to the user). Flagged as its own task for the Data Center's
  lane; not touched here.
- Recoverer accounts are created by a super admin from the Supabase dashboard
  or SQL for now: `manage-users` holds a fixed role list and refuses
  `recoverer`. Adding it there is a host change, for its own slice.
- A grant screen inside Recovery (super admin only), on the Data Center's
  access-section pattern.
- R2, seed and browse.
