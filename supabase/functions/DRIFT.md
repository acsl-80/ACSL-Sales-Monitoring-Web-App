# Where this repository and production disagree

Audited 2026-08-19 by downloading all 62 deployed edge functions and diffing
them against the source here. Line endings normalised before comparing.

**52 of 63 compared functions are identical.** The rest are listed below.

Re-run the audit with:

```bash
supabase functions download <slug> --project-ref oeiwnpngbnkhcismhpgs
```

into a scratch directory, then diff. Reading a function body does not deploy
anything. The audit above read from the preview branch project, which carries
clones of the same versions, so production was never contacted.

---

## Production is ahead of this repository

Someone deployed these from outside the repository. **Deploying the copy here
would remove live logic**, so do not run `supabase functions deploy` on it
without deciding what to do about it first.

### `create-sale`: RESOLVED 2026-08-20

Production had carried a rule this repository never saw: a non-installment sale
treated as paid in full, coercing `total_paid` up to the sale amount and forcing
`payment_status` to `fully_paid`. Deploying the repository's copy would have
made outright sales record as `partially_paid` again.

PR #9 resolved it by building the stove-claim fix **on production's source**
rather than on the older copy here, so this repository now carries both. It is
safe to deploy.

Note that safe is not the same as deployed. `create-sale` has no
`[functions.*]` block in `config.toml`, so merging PR #9 did not put it live.
Check the version before assuming:

```bash
supabase functions download create-sale --project-ref oeiwnpngbnkhcismhpgs
```

### `update-sale` (production v20, deployed 2026-08-15)

306 lines here, 351 in production. Production validates `amountReceived`, and
keeps `total_paid` and `payment_status` coherent when an edit moves the money,
while deliberately leaving historical rows alone when the edit touches
something else. None of that exists here.

---

## This repository is ahead of production

### `manage-organizations/read-operations.ts`: RESOLVED 2026-08-20

Deployed to production on 2026-08-20 (v58), so the repository and production
now agree.

**The impact claimed for this one was wrong, and the correction matters more
than the drift did.** This file previously said that inside a quoted PostgREST
value a `%` matches a literal percent sign, so production's `%` form was
"silently returning the wrong set". That came from a code comment written on
2026-07-21 and was repeated here without being tested.

Tested against production on 2026-08-20, searching "Abdu":

| | Rows |
|---|---|
| SQL `ilike '%Abdu%'` | 7 |
| PostgREST `partner_name.ilike."%Abdu%"` | 7 |
| PostgREST `partner_name.ilike."*Abdu*"` | 7 |
| SQL, `%` genuinely literal | 5 |

If `%` were literal, the second row would be 0. It is not. **Partner search was
never broken.** The two forms are equivalent on PostgREST 14.15, the deploy
aligned the repository with production and changed no behaviour, and the
misleading comment in `read-operations.ts` has been corrected.

Worth keeping as the lesson: a code comment is not evidence.

### `login-with-credentials`

Reformatted here (single quotes, different line wrapping) against production's
copy. No behavioural difference. Cosmetic only, recorded so a future audit does
not have to re-derive that.

---

## `verify_jwt` is not captured in `config.toml`

Six production functions run with `verify_jwt = false`. Only one of them
(`end-user-records-api`) is declared in `supabase/config.toml`, and the CLI
defaults an undeclared function to `verify_jwt = true`.

So deploying any of these five from the CLI would start rejecting the
unauthenticated calls they exist to serve:

| Function | What breaks |
|---|---|
| `login-with-credentials` | login itself, for every user |
| `check-user-exists` | the pre-auth account check |
| `external-sync` | ERP integration |
| `external-csv-sync` | ERP integration |
| `manage-app-release` | the mobile app's update check |

Adding `[functions.*]` blocks for them would record the setting, but it would
also be the first time those functions appear in `config.toml`, and the two
functions already declared there are the only ones the Supabase GitHub
integration has ever deployed. Changing that is a deploy-behaviour decision,
not a cleanup, so it is recorded here rather than done.

---

## Dead files

`authenticate.ts` in `manage-agents`, `manage-stove-ids` and `manage-users` is
not imported by anything and is absent from all three deployed bundles. It is
leftover from a refactor.
