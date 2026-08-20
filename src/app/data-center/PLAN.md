# Data Center: plan

## What we are building

A computation tool with dashboards, living inside the ACSL sales web app as its
own self-contained module. It pulls the records of sold stoves, layers the call
centre's verification work on top of them, and computes over the result.

Today that work happens in a weekly Excel workbook: one tab per call agent,
44 columns, aggregated by hand. The module replaces the workbook, not the
process.

Web only. It never reaches the `sales-mobile` Flutter app.

## Who it is for

ACSL staff, in Nigeria, on desktop. Three groups with different needs, which is
why the module has its own feature-level permissions rather than one on/off
switch:

- **Call centre agents** work a queue of records and record call outcomes.
- **Data upload team** run bulk imports and clear the exceptions queue.
- **Managers** read dashboards and need nothing else.

## Constraints that shaped every decision

The host app is live and moves without us:

- A push to `main` deploys to production. There is no manual promotion step.
- A daily cron auto-merges contractor work into `main` with no human review.
- Aged sync PRs self-merge after 24 hours unless labelled `hold`.
- Of the CI checks, only `build` blocks. Lint and typecheck are advisory.
- One Supabase project, live, with no staging database.

So the module is built to be invisible until deliberately switched on, and
detachable in one command.

## MVP slice

1. **The rig.** Branch, `data_center` schema, both permission tiers, module
   shell, seed script, and a demonstrated proof that the sales app is unaffected.
2. **Table 1 at capacity.** Sold stove records, browsable, keyset paginated,
   server-side filter and sort, virtualized, proven against 500,000 seeded rows.
3. **Table 2.** The call centre layer: four-state verification switch, separate
   call outcome, three call dates, corrected phone numbers, and the survey
   questions rendered from the registry.
4. **Bulk import.** With a dry run, batch rollback, and an exceptions queue.

Import is in the MVP because of what the data showed. See Evidence below.

## Later

Computation and dashboards, then widening the route grant past `super_admin`,
then whatever further tools the dashboards prove necessary.

## Non-goals

Recorded so this work does not quietly absorb them:

- Replacing or refactoring the host app's permission system.
- Creating a call-centre role. That waits until the users are defined.
- A parallel copy of sale records inside `data_center`.
- Historical migration as a project. Import is an ongoing path, not a backfill.
- Touching the ERP or `sales-mobile` in any way.
- Fixing `calculate_sale_status()`. It is a real host-app defect, but repairing
  it belongs to the sales app. This module works around it and flags it.

## Stack

Fixed by the host. Not a choice this module gets to make.

| Layer | Choice | Why |
|---|---|---|
| UI | React with Vite, TanStack Router | The host app is this, and a second framework in one deployable is not defensible |
| Data | Supabase Postgres, `data_center` schema | Isolation without losing the join to `public.sales` |
| Access | Service-role edge functions | Keeps the schema out of PostgREST, which is what stops the mobile app seeing it |
| Auth | Inherited from the host | Retires the hashing, authentication and brute-force blocks entirely |
| Hosting | Vercel, existing project | Branch pushes produce preview deployments |

## Data

Table 1 is a view and owns nothing. Table 2 adds facts and never copies them.

| Object | Kind | Holds |
|---|---|---|
| `v_sold_stoves` | view | `public.sales` joined to addresses, organizations, stock. This is Table 1 |
| `call_records` | table | Spine columns plus `answers` jsonb, keyed `sale_id` |
| `v_call_center` | view | Table 1 joined to `call_records`, so an operator sees one wide table |
| `import_batches`, `import_rows` | tables | Staging, per-row validation results, raw payload retained |
| `field_defs`, `option_lists`, `option_values` | tables | The registry that replaces the workbook's Key tab |
| `feature_grants` | table | Tier-2 per-user feature grants |
| `workflow_config` | table | Verification criteria, callback limit, completeness definition |
| `metric_snapshots` | table | Precomputed dashboard values |
| `v_transfers` | view | `public.stove_transfer_history` joined to organizations. What was sold TO a partner |
| `v_transfer_stoves` | view | One row per serial in a transfer. The spine that ties a sale back to its transfer |
| `record_consignments` | table | Paper records physically returned by a partner. A count, not a row per record |
| `v_transfer_funnel` | view | Issued, received, digitalised, verified, per transfer |
| `assignment_batches`, `assignment_items` | tables | Call centre work, twenty records of one partner at a time |
| `v_assignment_log` | view | Who was given what, who called whom, and what came of it |
| `call_agent_profiles` | table | Which users are call agents, and whether they are taking work |

`call_records` spine columns: `verification_outcome` (`fully_verified`,
`partially_verified`, `doubtful_verification`, `unreachable`, `not_verified`),
`call_outcome`,
`call_agent`, `call_date_1..3`, corrected primary and alternative phone, ward,
landmark, stated serial.

## Endpoints

All under `supabase/functions/`, all service role, all resolving feature grants
from the caller's JWT before doing anything else.

| Function | Job |
|---|---|
| `data-center-read` | Serves Table 1, Table 2 and dashboards. Read only |
| `data-center-write` | Direct entry against `call_records` |
| `data-center-import` | Upload, validate, dry run, commit, rollback |
| `data-center-compute` | Aggregates into `metric_snapshots`. Scheduled, never on page load |
| `data-center-admin` | Registry and grant management |
| `data-center-assign` | Runs the batch engine, reclaims stale batches, serves an agent their queue |

## Evidence behind the plan

Measured against the live database and one week's call centre workbook, not
assumed.

**Capacity is a target, not current state.** `public.sales` holds 38 rows, 15 of
them live. The 500,000 figure is what the design must survive, so capacity is
proven against seeded synthetic rows or it is not proven at all.

**The call centre is ahead of the app.** Of 359 distinct serials in one week's
workbook, 329 exist in `stove_ids_base`, 328 of those are still marked
`available`, and exactly 1 appears in `public.sales`. The call centre verifies
roughly 500 sales a week that the sales app has no record of. That is why bulk
import is in the MVP rather than deferred, and why committing it needs a dry run
and a rollback: it will move hundreds of stoves from available to sold, which is
correct and visible.

**Constrained lists are not a theoretical benefit.** The workbook's Call Outcome
column already contains `RESPONDED` (30 rows), `REPONDED` (a typo of it) and
`NO PHONE NUMBER`, none of which are in its own Key tab list.

**Four verification states, not three.** Fully Verified 54, Partially Verified
61, Doubtful Verification 24, and Not Verified as a blank. Doubtful is a real
distinct judgement.

## Building blocks applied

The six carrying real risk here:

| # | Block | How it shows up |
|---|---|---|
| 35 | Race conditions | Two concurrent imports must not both claim one stove ID. Claim under lock in the same transaction as the sale write |
| 15 | Data modeling | Sale facts live in `public.sales` only. This module stores facts about sales |
| 07 | Secrets | Vite inlines `VITE_*` into the client bundle, so the service role key must never be one |
| 22 | Input validation | Bulk import is the widest new input boundary in the app |
| 36 | Background jobs | A large import cannot run inside a request |
| 29 | Authorization | Route key AND feature grant AND organization scope, server-side |

Also applied: 01, 02, 03, 04, 06, 08, 09, 11, 12, 13, 14, 16, 17, 18, 19, 21,
23, 25, 31, 32, 34, 37, 38, 39, 40, 41, 42, 43, 46.

Not applicable, recorded so the calls are reviewable: **05** (JS stack), **20**
(relational, uniformly shaped data), **26** (nothing fetches a user-supplied
URL), **27, 28, 30** (auth inherited, not hand-rolled), **44** (domain and TLS
inherited). **24** is near-N/A because Supabase authenticates with bearer tokens
rather than cookies, but this module must not introduce a cookie-authenticated
write.

## Decisions

Recorded so they are not re-argued. Everything here is settled.

| # | Question | Decision | Basis |
|---|---|---|---|
| D1 | Sync direction for transfers | Live view, never a copy | Same database. The module's invariant is that it never copies a fact it can read |
| D2 | What ties a field record to its sale | `sales.stove_serial_no` to `stove_ids_base.sales_reference` to `stove_transfer_history.transaction_id` | The relationship already exists and two triggers keep it current |
| D3 | The dashboard's four statuses | `unreachable` becomes a fifth `verification_outcome` | An agent's judgement, recorded, not derived from a call outcome |
| D4 | What "Received" means | A count logged per consignment against a partner | Paper era. Direct digital entry has no paper stage, so received equals digitalised there |
| D5 | Call Centre Agent | A third `access_role` beside viewer and editor | One concept, one place to enable it |
| D6 | Who scorecard 4 measures | The same call agent | |
| D7 | The Partner Records surface | The reconciliation funnel, one row per transfer | |
| D8 | The Location axis | `stove_transfer_history.state` | Present on all 497 transfers. End-user state cannot fill the top line, because it does not exist until a record is digitalised |
| D9 | Sales representative | `stove_transfer_history.sales_rep` | 488 of 497 rows carry it |
| D10 | Manager rollup | `profiles.manager_id`, self-referencing FK, indexed | Exists already. Only 50 of 486 profiles carry one, so the scorecard reads sparse until that is filled in |
| D11 | Batch assignment | Twenty per batch, one partner, auto-assign the next partner on exhaustion, stale reclaim, an open-batch cap, per-partner size | |
| D12 | Time dimension | All-time by default, with an optional date range | Assumption, not an instruction |

### The five verification outcomes

The dashboard's four columns map onto them with no derivation, which is what
makes the consistency rule hold by construction rather than by arithmetic:

| Dashboard column | `verification_outcome` |
|---|---|
| Verified | `fully_verified` |
| Unverified | `partially_verified`, `doubtful_verification` |
| Unreachable | `unreachable` |
| Yet to be resolved | `not_verified` |

Mutually exclusive and exhaustive, so `Verified + Unverified + Unreachable +
Yet to be resolved` always equals the number received.

## Open questions

1. **Period-over-period on the scorecards.** All-time ships first.
   `metric_snapshots` keeps every run, so the history to compare against is
   already being collected.
2. **Can an ACSL agent report to more than one manager?** The schema says no,
   one `manager_id`. Worth raising only if the real org chart disagrees.
3. **The receipt file.** Import already accepts flexible headers and now has a
   mapping step, so this is no longer blocking. A real file would let the
   aliases be sharpened.

## Decided: call centre staff hold an ACSL role

**2026-08-19.** The module scopes what a user may see by mirroring
`computeOrgPlan` in `get-sales-advanced`, so it can never show someone a row the
sales app hides. Phase 3's tests made the consequence visible: a call centre
operator carrying a `partner_agent` role is scoped to their own sales, so a Data
Center grant admits them to a table with nothing in it.

Three ways out were weighed. The one taken is that **call centre accounts are
given an ACSL role (`acsl_agent` or `acsl_agent_manager`) with partner
assignments**, which is how the sales app already distinguishes ACSL staff from
partner staff.

Why this rather than the alternatives:

- Letting a Data Center grant carry its own wider scope would mean a
  `partner_agent` could read other partners' end-user names, phones and
  addresses. The sales app hides those deliberately, and a module that quietly
  reveals them is a privacy hole with a feature flag on it.
- A third access level beside viewer and editor would work, but it duplicates a
  distinction the host app already makes, and it has to be kept in step with the
  sales app's rule forever.

The cost is operational rather than structural: an administrator sets the role
and the partner assignments per person. Nothing in the module changes, which is
the point. If the sales app ever changes how it scopes ACSL staff, the Data
Center follows without an edit.

The preview seed models this: `callcentre@preview.acsl.test` is an `acsl_agent`
assigned to every seeded partner, and `e2e/data-center-records.spec.ts` asserts
it reads "assigned organizations" rather than "own sales".
