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
would remove live logic**, so do not run `supabase functions deploy` on either
without deciding what to do about it first.

### `create-sale` (production v41, deployed 2026-08-15)

The repository's copy last changed 2026-08-02. Production carries a rule the
repository has never seen: a non-installment sale is treated as paid in full,
coercing `total_paid` up to the sale amount and forcing `payment_status` to
`fully_paid` rather than deriving it.

Deploying the repository's copy would make outright sales record as
`partially_paid` again whenever the two figures disagree.

### `update-sale` (production v20, deployed 2026-08-15)

306 lines here, 351 in production. Production validates `amountReceived`, and
keeps `total_paid` and `payment_status` coherent when an edit moves the money,
while deliberately leaving historical rows alone when the edit touches
something else. None of that exists here.

---

## This repository is ahead of production

### `manage-organizations/read-operations.ts`

A fix that was committed and never deployed. Inside a quoted PostgREST value
the `ilike` wildcard is `*`, not `%`; a `%` there matches a literal percent
sign. Production still runs the `%` version, so **partner search by name or
partner ID is silently returning the wrong set today**.

Deploying `manage-organizations` fixes it. That is a change to a live function,
so it belongs in its own deliberate step, not bundled with anything else.

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
