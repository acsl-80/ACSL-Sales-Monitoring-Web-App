# Edge functions

Source for every edge function the SALES Supabase project runs
(`oeiwnpngbnkhcismhpgs`). One directory per function, matching the deployed
slug.

## Twelve functions were recovered here on 2026-08-19

Production ran 62 edge functions. This repository held source for 50 of them.
The missing twelve had been deployed from somewhere other than this repository
(the dashboard, or a working copy that was never committed), so the repository
could not rebuild the project and nobody reading it would know the functions
existed:

| Function | Known caller |
|---|---|
| `upload-image` | Sell Stove photo and agreement upload (`adminSalesService.jsx`) |
| `assign-sale-to-agent` | sale assignment |
| `check-user-exists` | pre-auth account check |
| `create-agent` | agent creation |
| `create-agent-user` | agent account creation |
| `create-sales-history` | sales audit trail write |
| `get-sales` | sales list |
| `get-sales-activities` | activity feed |
| `get-sales-advance-two` | advanced sales query (7 files) |
| `get-sales-history` | per-sale audit trail |
| `manage-branches` | partner branch CRUD (8 files) |
| `upload-stove-ids-csv` | stove ID bulk upload |

They were recovered with `supabase functions download <slug> --project-ref`,
which unpacks the deployed ESZIP bundle back to source. The recovery is
faithful, not approximate: downloading three functions that this repository
already tracks returned bytes identical to the committed copies for
`manage-profile` and `geo-data`.

Nothing was deployed to produce this commit. The bundles were read from the
preview branch project, which carries clones of the same function versions, so
production was never touched.

## What the Supabase GitHub integration actually does

Both of these were measured on this project, not assumed, because `main` is
registered as a Supabase branch pointing at the **production** project. A push
to `main` runs the integration against the live database.

**It never deletes.** A full integration deploy ran against the preview branch
project on 2026-08-19 while the repository held 53 functions and the project
held 64. Nothing was removed. There is no prune step, so a function that exists
only in production stays there.

**It does not deploy functions from this directory.** Across pushes that added
`data-center-read` and `data-center-admin`, the integration deployed neither.
Both had to be deployed by hand. The only functions it has ever touched are the
two declared as `[functions.*]` blocks in `supabase/config.toml`, and only at
branch creation.

So adding source here changes nothing that is running. It makes the repository
honest about what exists. **A new function still has to be deployed by hand:**

```bash
supabase functions deploy <slug> --project-ref <ref>
```

## Before you deploy anything from this directory

Check the deployed copy first. This repository has been behind production
before, and `supabase functions deploy` overwrites without warning:

```bash
supabase functions download <slug> --project-ref oeiwnpngbnkhcismhpgs
```

Run that into a scratch directory and diff it against the copy here. See
`DRIFT.md` for the functions where the two are known to disagree.
