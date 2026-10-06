# Recovery decisions

The why behind choices that are not obvious from the code. The rulings Orezi
gave on 2026-10-06 are recorded in the recovery project
(`acsl-stove-recovery/work-process/decisions.md`) and carried into `PLAN.md`;
they are not repeated or reopened here.

## R-D1. The module carries its own plan (2026-10-06)

Orezi: "yes, start R1". The settled plan was carried in as `PLAN.md`, with build
rules in `CLAUDE.md` modelled on the Data Center's, before any code. Prime rule:
the sales app must not notice the module exists unless it is switched on.

## R-D2. Access levels are named apart from the role (2026-10-06, open to overruling)

The new sales-app role is `recoverer`, Orezi's word, in `public.profiles.role`.
The levels inside Recovery are `viewer`, `recovery_agent` and `data_manager`,
in `recovery.module_access`. They are different things: the role says what
kind of account a person holds, the level says what they may do inside
Recovery, and an ACSL agent can hold `recovery_agent` too. Calling the level
`recoverer` as well would have put one word on two facts. The caller level
comes with R3, when there are calls to work and a key to separate them.

## R-D3. The one change R1 makes in public: a recoverer holds no organisation (2026-10-06)

The sales app scopes rows by organisation, and neither
`scope_organization_ids()` nor the older row rules on `sales`, `sales_history`
and `organizations` ask the role first. A `recoverer` with an organisation
would read that organisation's sales. Without one it reads none of them. The
profile guard stops a signed-in person setting an organisation, but the server,
the dashboard and `handle_new_user()` (from app_metadata) all can.

So `public.profiles` gains one CHECK: `role is distinct from 'recoverer' or
organization_id is null`. Added NOT VALID, then validated. No row, column,
policy or function changes. Its own migration,
`20261006120100_recoverer_holds_no_organisation.sql`, so it can be judged
separately. Rejected: editing `scope_organization_ids()` and the three row
rules to exclude the role. That is four changes to the sales app's core scope
where one constraint holds the same line.

## R-D4. Holes that are open today, found while proving R1 (2026-10-06, awaiting Orezi's ruling)

Mapping where an unknown role fails open turned up doors that are already open
to every signed-in account, and some to the public anon key. They are not
caused by R1 and are not fixed by it, because each is host-app code that the
outside firms also work in:

- Four views (`user_roles`, `user_org_context`, `super_admin_agent_organizations`,
  `super_admin_agent_states`) are plain views granted to `anon` and
  `authenticated`. Row security does not apply to a plain view, so they list
  every account's role and organisation and every agent assignment.
- Definer functions with no revoke, so any signed-in account can call them:
  `get_sales_history(org, ...)` (any organisation's history, with performer
  names and emails), `get_table_count`, `check_profile_email_exists`,
  `add_custom_sales_history`.
- Edge functions that check only that the token is valid:
  `get-end-user-phones` (every phone number in `sales`), `get-google-keys`
  (the Places and Maps keys), `upload-image`.

Found in the repository's migrations and function code. The live project could
not be checked from this machine: no Management API token here, and the
Supabase connector in this session is signed in to a different account. The
SQL proof lists every callable definer function on whatever database it runs
against, and the spec's view test names every view that answers.

Recommended: a separate hardening change, on its own branch, before any
`recoverer` account is created on production. It touches the host app, so it
waits for Orezi's word.

## R-D5. Where a recoverer lands after signing in (2026-10-06, awaiting Orezi's ruling)

Every account lands on `/dashboard`, which requires a sales role, so a
recoverer is sent on to "Page Not Found". That fails closed, which is the safe
direction, and it is not usable. Sending them to `/recovery` means a few lines
in `src/app/login/page.jsx` and `src/app/page.jsx`, reading a home route from
`permissions.ts`. Those are outside the two files this module may edit, so not
done without his word.

## R-D6. Reference tables a recoverer may read (2026-10-06, open to overruling)

The proof's rule is "zero rows from every table in public". Five tables answer
every signed-in account by design and hold no personal or sales data: the
states, the LGAs, the sale form's field rules, active payment models and app
releases. The proof names them in a fixed list and treats any other table with
rows as a failure, so a new table cannot slip through under a wildcard.

## R-D7. The module reuses the Data Center's connection helper (2026-10-06)

`recovery-read` opens Postgres through `_shared/data-center-db.ts`. A second
copy of that file's one-connection-per-request rule is how the database was
exhausted the first time. It is the only thing the two modules share, and only
on the server.
