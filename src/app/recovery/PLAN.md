# Recovery: plan

Carried in from the settled plan of 2026-10-06
(`acsl-stove-recovery/work-process/PLAN-recovery-module.md`, in the recovery
project), with the rulings Orezi gave that day. Those rulings are not reopened
here. What this file adds is how the plan lands in this codebase.

## What we are building

A module inside the sales app, beside the Data Center and not inside it, for
rebuilding the records of stoves sold from 2022 to 2025 that never reached the
sales app. Recovered stoves end up as sales and call records in this database,
which is why the module lives in the same app and database rather than its own.

The ask, verbatim:

> "You've rightly outlined for recovered stoves to be integrated it has to be
> transfered from the ERP, remember the recovery build has sales data. We need
> to be able to export the sales data with series so we can import on the ERP
> and transfer. Once this happens recovery records need to sync, count as sales
> on the sales app and then even call center records. We should be able to
> differentiate the ones called and not. The input form robust enough and
> versatile enough for people to type one after the other or bulk import like
> the digitalization bench and also enrichment like the call center records.
> These must all work in sync and not break. It also must be easy so it does
> not corrupt the data, it must be standalone but integrateable. We should also
> have a count for recovered stoves with details from whom, where and number
> etc"

> "this module is fully detached, with clear rls to operate just like we did
> the data center"

> "we would be moving this to supabase so you might want to check the best
> configuration to make this work how we handle duplicates, stove ids are
> unique no two in the system, so we have unique stove id, unique name but
> there can be the same phone number. Flag when the phone number now is
> attached to more than one stove but do not prevent entry or saving"

## Where it lives

- **Same app and database**, because a recovered stove becomes a sale and a
  call record here. A separate app would hold two copies of names and phones
  and a sync that can fail halfway.
- **Separate everything else.** Its own schema (`recovery`), route
  (`/recovery`), access tables, edge functions and switch. Switched off or
  removed, the sales app and the Data Center are exactly as they were.
- **Access as tight as the Data Center's.** The `recovery` schema is not exposed
  to the browser: usage revoked from `anon` and `authenticated`, row security
  on with no policies, every read and write through the module's edge
  functions, which check the caller's grants on each request. A super admin
  grants access case by case.
- **Four named seams, and no others.** The ERP export file (out); the handover
  into a sale through the existing sale-creation path; call records through the
  existing call import; the shared phones list. Nothing writes to
  `public.sales` any other way.

## One vocabulary: the sale dictionary

Every column means one thing everywhere. The module names its columns by the
keys in `supabase/functions/_shared/sale-dictionary.json`, so handing a stove
over as a sale is a copy, field for field, and the engine reads back the same
names. **Amount paid is the total paid to date** (ruled 2026-10-06).

## The record and its life

Tables in `recovery`, by slice:

| Table | What it holds | Slice |
|---|---|---|
| `module_access` | Who may enter Recovery, at what level | R1 |
| `feature_grants` | Keys granted to one person on top of their level | R1 |
| `change_log` | Every change, who made it and when, written by trigger | R1 |
| `sales` | One row per sale to a partner in a state, as the sales books hold it | R2 |
| `stoves` | One row per stove sold; the recovery stove ID is the key; one owner per stove | R2 |
| `calls`, `call_attempts` | The call centre sheet for a stove not yet a sale | R3 |
| `batches`, `batch_rows` | Bulk imports with dry run, commit and rollback | R4 |
| `assignments` | Who works which partner in which state | R4 |

**Status, one per stove, only moving forward:** recovered, exported to the
ERP, transferred, a sale in the app. Called or not called shows beside it at
every step. A stove with no serial counts as recovered and waits there.

**Duplicates.** A stove ID twice is impossible (primary key). A serial twice is
refused in the module and flagged against the sales app's stock. A phone or a
name on more than one stove, recovered or sold, is flagged on the row and the
save goes through (ruled 2026-10-06: one owner per stove).

**Never corrupted.** One save path for typing, bulk import and enrichment. A
version number on every stove refuses a stale save. A bulk import is a batch:
dry run, commit, roll back as a unit. Each field has one owner. Nothing is
deleted.

## Who sees what

Two kinds of account (Orezi, 2026-10-06):

- **Recovery-only accounts** hold a new sales-app role, `recoverer`. Its only
  pages are Recovery and the person's own profile. The sales app's tables are
  scoped by role since 26 September, and a role with no scope reads no sales,
  partner, address or payment rows, through the pages or by querying the
  database directly. R1 proves this.
- **Staff** keep their own role and are granted Recovery on top, as Data Center
  access is granted.

Inside the module, the access level decides what a person can do (below), and
from R4 an assignment decides where a recoverer works. Recoverers can search
every recovery record and the phones of stoves already sold, and change only
their assignment's records (ruled 2026-10-06). Every search is logged.

### Two words that look alike and are not

- **`recoverer`** is a *sales-app role*, in `public.profiles.role`. It says what
  kind of account this is: one recruited only for recovery. It decides which
  sales-app pages exist for the person, which is Recovery and Profile.
- **An access level** (`viewer`, `recovery_agent`, `data_manager`) is a
  *Recovery* setting, in `recovery.module_access`. It says what the person may
  do inside Recovery. A `recoverer` account and an ACSL agent can both hold
  `recovery_agent`.

A `recoverer` with no `module_access` row can open `/recovery` and is told they
have no access yet. Holding the role grants nothing inside the module.

### Feature keys

Resolved on the server, per request, in
`supabase/functions/_shared/recovery-roles.ts`:

| Key | Lets the person | viewer | recovery_agent | data_manager |
|---|---|---|---|---|
| `recovery.view` | Read Recovery records and counts | yes | yes | yes |
| `recovery.edit` | Record and correct a household, a call | | yes | yes |
| `recovery.import` | Run bulk imports | | | yes |
| `recovery.assign` | Hand out assignments, settle conflicts | | | yes |

A super admin holds every key without a row. Keys granted in `feature_grants`
add to a level and never subtract. A key the server does not know is ignored.
The caller level comes with R3, when calls exist to work.

## Slices

Each slice is its own branch and preview, with a branch database and made-up
households only. It merges after 18:00 Lagos. Migrations are written for Orezi
to run, each with the query that proves it landed.

1. **R1, the rig.** Schema, access, grants, the `recoverer` role, an empty
   Recovery page behind the switch. Proof: the sales app and the Data Center
   behave as before; the schema cannot be reached from the browser; a
   recovery-only account reads nothing outside Recovery.
2. **R2, seed and browse.** A TBCN Kano workbook as the seed; its 9,340 stoves
   listed with what was held for each; counts tie to the workbook.
3. **R3, one record and its call.** Find a stove, record the household, record
   the call; versions refuse a stale save; shared phones flagged; history on
   the record.
4. **R4, many hands.** Bulk import with dry run and rollback; assignments;
   search across every record for duplicates; conflicts listed for a data
   manager.
5. **The move.** Laptop records in once; the laptop intake turns read-only.
   Point-in-time backups must be on first.
6. **R5, counts and read-back.** The Recovery page's counts; the engine reads
   the module.
7. **R6, a recovered stove becomes a sale**, through the existing sale-creation
   path, with its call through the call import.
8. **R7, the map and paths on the page**, drawn from the engine's checked
   export, matching the laptop dashboard exactly.
9. **R8, the engine as a job** in a private acsl-80 repository, on GitHub
   Actions, triggered by the app.

Later, and not before Orezi picks it up: E1 the ERP export, E2 the ERP import.

## R1 in this codebase

**Database.** One additive migration creates the `recovery` schema with
`module_access`, `feature_grants` and `change_log` (and its trigger), on the
pattern of `20260819010000_data_center_schema.sql` and
`20260819040000_data_center_module_access.sql`. `recovery` is not added to
`[api].schemas`. The migration also teaches `public` the one thing it must know,
that `recoverer` is a role an account may hold: see "What R1 changes in public"
below.

**Server.** `supabase/functions/recovery-read` answers one action, `access`:
does this caller have Recovery, at what level, with which keys. It opens its own
Postgres connection through `_shared/data-center-db.ts`, because the schema is
not reachable through supabase-js.

**Client.** `src/app/recovery/` holds the page, `lib/client.ts`, `lib/access.tsx`
and `lib/useModuleAccess.ts`. `src/routes/recovery/index.tsx` is the route stub.
`permissions.ts` gains the `recoverer` role and the `recovery` route key;
`Sidebar.jsx` gains one entry, shown when the role map allows it or the person
has been granted access.

**What R1 changes in public.** One CHECK on `public.profiles`: a `recoverer`
holds no organisation, because the sales app scopes rows by organisation
without asking the role. Its own migration
(`20261006120100_recoverer_holds_no_organisation.sql`) and decision R-D3.

**Proof.** `e2e/recovery-r1.spec.ts` (browser and REST, as the recoverer) and
`src/app/recovery/proof/r1-recoverer-reads-nothing.sql` (the same question
asked inside the database, rolled back after).
