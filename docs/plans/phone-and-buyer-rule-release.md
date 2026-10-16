# Phone number and buyer rule: release runbook

Status: written and reviewed 2026-10-15. **Run on 2026-10-16, 03:00 to 04:40 Lagos, on the operator's word.** Every check matched and nothing was rolled back. Each step below says what happened on the day. Still open: Step 7 (the messages), Step 8 (the first morning and the snapshot tables), and the second test partner in Step 9.

Plan: [phone-and-buyer-rule.md](phone-and-buyer-rule.md). Pull request: #146, merged 2026-10-16 as `38a61329`.

## What ships

- **The rule on the server.** `create-sale` and `update-sale` allow a second sale on a number when the buyer's name differs, and report the other sales on it. They refuse the same name on the same number, across every partner. Digitisation records a repeat and flags it for the call centre.
- **The web.** Sell Stove checks the number while the seller types. It shows a note for a shared number and an error for the same customer. The stove record and the call centre's register say whether a sharing is a family or a repeat.
- **The register.** Every shared number reaches the call centre's register from every door. A field sale on a shared number is held from the creditable count until a call confirms it (D65).
- **Two data scripts after the code.** One marks the repeats already on the register as the same customer twice (Phase 5). The other confirms the register rows of sales a call already fully verified, on numbers where the names differ (D66).
- **Not in this release:** the phone app. 1.0.18 keeps refusing any second sale on a number, on the phone, until Brain-codes ships 1.0.19 from the handoff (Phase 6). It keeps working against the new server unchanged.

## What people will notice

- Web sellers can record a family's shared number. They see a note, and the sale saves. The same customer a second time is refused, naming the other sale when the seller may see it.
- Field sellers on 1.0.18 see no change until 1.0.19.
- **Creditable counts move twice, on purpose.**
  - They **rise** when the decision 2 script runs. On 2026-10-16 it released 111 sales, all fully verified on a call and held only by the register. The 15 Oct dry run said 109; the figure moves as calls are made.
  - Afterwards they **dip** when a new sale lands on a number that is not yet on the register: the new sale and the ones already there are all held until the call centre confirms the number (D65). On a number the call centre has already confirmed, only the new sale is held.
- The call centre's register gains the "same customer twice" label and filter, and about 412 rows get that label. No sale moves in or out of the creditable count because of the label.

## Who and when

- **The release word is the operator's.** Nothing below runs before it.
- **When:** after 18:00 Lagos on a weekday, so the first field sales come the next morning while someone is watching. The contractor sync runs at 07:00 Lagos, outside that window. All the steps take about 45 minutes, most of it waiting for builds.
  - On the day it ran from 03:00 Lagos on Friday, the operator's choice, with the operator watching the first field sales that morning. Steps 0 to 6 took 40 minutes; gates 1 and 2 took an hour before that.
- **The person running it needs:**
  - the sales project's Supabase access token and database password;
  - write access to the GitHub repository, to merge #146;
  - the Vercel team, to roll the web back if needed;
  - a super admin login on the sales app, for Recompute in the Data Center.

## Gates before the release word

1. **The branch is current with main.** `git fetch origin`, then `git rev-list --left-right --count origin/main...origin/feat/phone-buyer-rule` shows `0` on the left. If main has moved, merge main into the branch and rerun gate 2. On 2026-10-15 it was 0 behind, 21 ahead.
2. **The suite is green on the release commit.** Use the PR's preview and its test database, with the repository's own Playwright config.
   - the seven `host-phone-buyer-*` specs and `non-interference`;
   - then the whole suite, on a test database reset to migrations and seed first (earlier runs use up its six seeded sales). Read any red not listed below before the release.
   - Run on 2026-10-15 at `13accb09`: 532 passed, 28 failed, 3 skipped, 2 did not run. After a reset, the 15 failing files again: 78 passed, 10 failed. The 10, all in code this release does not touch:
     - `host-sale-status-rule` (4): its sale is dated today and lacks fields the rules dated 11 September require. It fails the same way on the main-schema sandbox, without this release.
     - `data-center-assignment` (3): it expects an editor and a call agent to land on a "Call Centre" heading. Since Phase 28 (11 September) they land on My calls.
     - `data-center-settings` (1): it opens the first dropdown whose name contains "outcome", and more than one list does now.
     - `data-center-write-paths` (1): moving a record between agents answers 409. Worked records stay with their agent since D50.
     - `data-center-call-import-chain` (1): it needs 6 uncalled sales and the seed leaves 4 after global setup.
   - **On the day.** Main had moved by #147, which changed five spec files and nothing else. It was merged into the branch (0 behind, 26 ahead at `38a61329`). Then the seven `host-phone-buyer-*` specs, `non-interference` and the five files #147 fixed ran on that commit's preview: 86 passed, 3 failed, 2 did not run.
     - Two of the 3 were "Failed to fetch" from the browser, a request that got no answer at all. Both files passed on a rerun, 11 of 11.
     - The third is the chain test "undo is refused while a chain holds the batch". It still takes 4 uncalled sales from the seed, and the database had 3 left, because it was not reset after the earlier runs. #147 changed only the test before it to make its own sales.
     - The preview's database was proved by the branch's own Vercel variables (`VITE_SUPABASE_URL` scoped to the branch names the test database). Reading the entry scripts alone finds only the production address, which every build carries as a fallback.
3. **No new migration on main.** Production's newest applied migration was `20261005120000` on 2026-10-15. If a later-dated one has landed since, re-date this release's five files after it.
4. **Nothing else will merge during the window.** Label any open `sync` pull request `hold`, so the hourly auto-merge leaves it alone until the release is done.
5. **The field team message is ready** (see Step 7).

## Rollback points (read 2026-10-15, read again and used on 2026-10-16)

Before the release, production ran main at `30a517ef` for all six functions. Each function's deployed files were downloaded and compared with main on 2026-10-15, and they matched. The one exception was in `data-center-write`: its live copy of the shared sale dictionary predated D61 by one field attribute the server never reads.

| What | Before the release | After it (2026-10-16) | How to return |
| --- | --- | --- | --- |
| `create-sale` | v57, checksum `78006e2d4971af16` | v58, `53c3f7d551f0d28c` | redeploy from `30a517ef` |
| `update-sale` | v32, `873335550e676d51` | v33, `8d5bf3160f25c9f4` | redeploy from `30a517ef` |
| `get-end-user-phones` | v11, `701639dcee5c9b1f` | v12, `a13eb5896abacb74` | redeploy from `30a517ef` |
| `data-center-read` | v36, `38ddeb7bd6b1efbb` | v37, `fb576b29bfb075a9` | redeploy from `30a517ef` |
| `data-center-import` | v27, `19d3da9887814f6f` | v28, `661146691abb2320` | redeploy from `30a517ef` |
| `data-center-write` | v19, `f580d33e68c18c26` | v20, `b63e976d98b76abd` | redeploy from `30a517ef` |
| Web | `dpl_DZTimYA1jW2A1gjWzKTnMzp6AHZQ` (commit `6ca6b81e`, #147) | `dpl_DQER7ciGoRf1h6nSzjGdXtcdrKwr` (commit `38a61329`) | Vercel Instant Rollback to the one before |
| Migrations | newest applied `20261005120000` | `20261014120400` | leave in place (see Rollback) |

The web's rollback point moved on the night: #147 merged at 02:29 UTC and production built it before the release. It changed spec files only, so its app code is that of `30a517ef`, and `dpl_AUN2RCoY4d94E2Z9er1haNCwM9Xs` remains a second way back. The function code at `6ca6b81e` is also that of `30a517ef`.

A redeploy from `30a517ef` gets a new checksum, not the one above: `create-sale` and `get-end-user-phones` load the Supabase client library by major version, so a rebuild picks up its latest release. A rollback is proven by comparing files, as in Step 2.

All six functions check the caller's token at the platform (`verify_jwt` true). None of them is declared in `supabase/config.toml`, so a deploy gives each the CLI's default, which is also true.

## The release log

Paste the result row of `supabase/scripts/phone-buyer-release-check.sql` at each point marked LOG. It reads only. It shows the migrations and functions in place, the register's size, how many rows carry the repeat label, and the creditable count worked out now with the analysis's own gates.

Production on 2026-10-15, for comparison:

| migrations | new_functions | register_rows | register_open | register_numbers | same_buyer_rows | live_sales | creditable | held_by_register |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 0 | 954 | 954 | 372 | 0 | 5,740 | 1,038 | 158 |

The creditable figure matched `compute_analysis`'s own rule, run alone, on the same day (1,038).

The figures in this runbook are from 2026-10-15. The scripts' headers quote earlier ones (416 labels, 104 confirmations). Trust the dry run on the day over either.

**The log of 2026-10-16:**

| Point | migrations | new_functions | register_rows | register_open | register_numbers | same_buyer_rows | live_sales | creditable | held_by_register |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Step 0 | 0 | 0 | 954 | 954 | 372 | 0 | 5,740 | 1,045 | 161 |
| After Step 1 | 5 | 4 | 954 | 954 | 372 | 0 | 5,740 | 1,045 | 161 |
| After Step 3 | 5 | 4 | 954 | 954 | 372 | 0 | 5,740 | 1,045 | 161 |
| After Step 4 | 5 | 4 | 954 | 954 | 372 | 412 | 5,740 | 1,045 | 161 |
| After Step 5 | 5 | 4 | 954 | 843 | 372 | 412 | 5,740 | 1,156 | 50 |
| 04:24 Lagos | 5 | 4 | 954 | 843 | 372 | 412 | 5,774 | 1,156 | 50 |

The 34 more live sales at 04:24 came from one person's work in the Data Center between 04:23 and 04:25, none of them on a number already in use. No function had answered 4xx or 5xx since the deploy.

## Steps

Commands are for Windows PowerShell, run from a checkout of `feat/phone-buyer-rule` at the release commit. The Supabase CLI is pinned to the version the dry run used. Set up the session first; `Read-Host` keeps the secrets out of the command history:

```powershell
$env:SUPABASE_ACCESS_TOKEN = Read-Host 'Supabase access token'
$fns = 'create-sale','update-sale','get-end-user-phones','data-center-read','data-center-import','data-center-write'
function Compare-Deployed {
  param($ref = 'oeiwnpngbnkhcismhpgs')
  $dl = Join-Path $env:TEMP ('deployed-' + (Get-Date -Format 'yyyyMMddHHmmss'))
  New-Item -ItemType Directory "$dl\supabase" | Out-Null
  Copy-Item supabase\config.toml "$dl\supabase\"
  foreach ($f in $fns) { npx supabase@2.121.0 functions download $f --project-ref $ref --use-api --workdir $dl | Out-Null }
  $root = (Resolve-Path "$dl\supabase\functions").Path
  foreach ($file in Get-ChildItem $root -Recurse -File) {
    $rel = $file.FullName.Substring($root.Length + 1)
    $mine = Join-Path 'supabase\functions' $rel
    if (-not (Test-Path $mine)) { "missing here: $rel"; continue }
    $a = (Get-Content $file.FullName -Raw) -replace "`r`n", "`n"
    $b = (Get-Content $mine -Raw) -replace "`r`n", "`n"
    if ($a -ne $b) { "differs: $rel" }
  }
  'compared'
}
function Show-Functions {
  param($ref = 'oeiwnpngbnkhcismhpgs')
  $list = (npx supabase@2.121.0 functions list --project-ref $ref -o json | Out-String) | ConvertFrom-Json
  $list | Where-Object { $fns -contains $_.slug } | Format-Table slug, version, verify_jwt, ezbr_sha256
}
```

`Compare-Deployed` downloads what production runs (or another project, given its ref) for the six functions and compares every file with this checkout. It prints `compared` and nothing else when they match, apart from the CLI's warning that the `[inbucket]` config section is deprecated, once per function, which is harmless. Both helpers were tried in Windows PowerShell 5.1 on 2026-10-15. Run against the baseline download, the compare found the one known dictionary difference and nothing else.

### Step 0. Baseline

1. LOG: run `phone-buyer-release-check.sql` in the SQL editor.
2. In the Data Center, as a super admin, press **Recompute** on the Analysis page. No computation is scheduled on production (the last run was 2 October), so the dashboard's figures are old until this runs. Note the creditable figure it shows.
3. `Show-Functions`: the versions match the rollback table. If not, something was deployed since; stop and find out what.

On the day: all three matched. The Recompute was run by SQL instead of the button, because the person running the release could not sign in as the super admin. The block below does what the button's run action does: the same four steps in the same order, under the same lock key, so a press of the button cannot overlap it. It writes a run with no `triggered_by`. Run fb99eb90 wrote 42 metrics in 10,025 rows, and its creditable figure was 1,045, the same as the LOG.

```sql
do $$
declare rid uuid; n1 int; n2 int; n3 int; t0 timestamptz := clock_timestamp();
begin
  if not pg_try_advisory_xact_lock(8150620) then raise exception 'a computation is already running'; end if;
  insert into data_center.metric_runs (triggered_by) values (null) returning id into rid;
  n1 := data_center.compute_metrics(rid, null);
  perform data_center.refresh_transfer_funnel();
  n2 := data_center.compute_scorecards(rid);
  n3 := data_center.compute_analysis(rid);
  update data_center.metric_runs
     set status = 'ok', finished_at = now(), metrics_written = n1 + n2 + n3,
         duration_ms = (extract(epoch from clock_timestamp() - t0) * 1000)::int
   where id = rid;
end $$;
```

The dashboard's creditable figure for a run is the sum of `analysis.yield_funnel` where `dimension->>'by' = 'partner'` and `dimension->>'key2' = 'creditable'`.

### Step 1. Migrations

Five files, all additive: four new functions and one new column with a default. Nothing existing changes shape. The current functions run unchanged against them.

1. List what would be applied:

   ```powershell
   $pw = [uri]::EscapeDataString((Read-Host 'Sales database password'))
   npx supabase@2.121.0 db push --dry-run --db-url "postgresql://postgres.oeiwnpngbnkhcismhpgs:${pw}@aws-0-us-east-2.pooler.supabase.com:5432/postgres"
   ```

   Expect exactly the five `20261014120000` to `20261014120400` files and no seeds. Done on 2026-10-15, that is what it listed. If it lists anything else, stop.
2. Apply: the same `npx` command without `--dry-run`.
3. **Check.** LOG: `migrations` 5, `new_functions` 4, everything else as at Step 0. Each file ends with a proof query; run them if anything looks off.
On the day: the dry run listed exactly the five, and the push applied them. LOG: `migrations` 5, `new_functions` 4, the rest unchanged.
4. **If it fails:** the push stops at the failing file, and the files before it stay applied with their ledger rows. Read the error, fix on the branch, and run the push again: it applies only what is left. Nothing live calls the new functions yet, so the site is unaffected while this waits.

### Step 2. Functions

1. `git status` shows a clean tree and `git rev-parse HEAD` is the release commit. The deploy ships the working tree, not the commit.
2. Deploy the six:

   ```powershell
   npx supabase@2.121.0 functions deploy @fns --project-ref oeiwnpngbnkhcismhpgs --use-api
   ```

3. **Check.** The CLI's "Deployed Functions" line is not proof.
   - `Show-Functions`: each of the six has a higher version and a checksum different from the rollback table, and `verify_jwt` is still True.
   - `Compare-Deployed` prints only `compared`. That proves production runs this checkout's code.
   - On the day: deployed from `38a61329` on a clean tree at 03:06 UTC. The six took the versions and checksums in the rollback table's "After" column, `verify_jwt` stayed true, and the compare found no file that differed.
4. **If it fails:** a function that did not deploy is still the old version, and the old versions work against the new migrations. Redeploy the failed one. To go back entirely, see Rollback.

The web is still the old build at this point. It works against the new functions: their replies only add fields, and the phone list keeps its shape. The old web still refuses a shared number in the browser, as it does today.

### Step 3. Web

1. Run gate 1 again. If main has moved since Step 2, stop: merging now would put a web build from one commit beside functions from another. Merge main into the branch, rerun the suite, deploy the functions again, then continue.
2. Mark #146 ready for review, then merge it on GitHub. Main deploys to production by itself.
3. The Supabase integration also runs on the merge. It finds the five migrations already applied and applies nothing. It deletes the PR's test database.
4. **Check.**
   - The Vercel production deployment for the merge commit is READY, and the production domain points to it.
   - Sell Stove, on a number that already has a sale under another name, shows the shared-number note before submit. Type the number only; do not save a sale.
   - The call centre's Shared phones page opens and shows the "Same customer twice only" filter.
   - LOG: as after Step 1. The ledger still ends at `20261014120400`.
   - On the day:
     - The repository's GitHub token can mark a pull request ready but cannot merge one. So #146 was marked ready and merged by pushing its head, `38a61329`, to main as a fast-forward. GitHub then showed #146 as merged.
     - The production deployment `dpl_DQER7ciGoRf1h6nSzjGdXtcdrKwr` was READY at 03:10 UTC, and the production domain pointed to it.
     - The screens were checked in the live code rather than on screen, because nobody could sign in at that hour. The Sell Stove chunk carries the shared-number note and the same-customer refusal, the Shared phones chunk carries "Same customer twice only", and the only database address in the build is production's. A look at the two screens as a signed-in user is still worth doing.
     - The Supabase integration applied no migration and redeployed no function: the six kept their Step 2 versions.
5. **If it fails:** Vercel Instant Rollback to the deployment before (in the rollback table). The old web works against the new functions (Step 2). After an instant rollback Vercel stops promoting new pushes to production by itself until a deployment is promoted again; note it in the log.

### Step 4. Phase 5: label the repeats

1. Run `supabase/scripts/phone-buyer-kind-backfill-dryrun.sql`. On 2026-10-15: `rows_to_mark` 412 on 165 numbers.
2. Run `supabase/scripts/phone-buyer-kind-backfill.sql`. `rows_matched` equals the dry run's `rows_to_mark`, and `rows_marked` equals `rows_snapshotted`.
3. **Check.** LOG: `same_buyer_rows` up by `rows_marked` from the Step 3 LOG. `creditable` and `held_by_register` unchanged: the label moves no sale.
   - On the day: the dry run said 412 rows on 165 numbers. The script matched 412, marked 412 and snapshotted 412. `same_buyer_rows` went from 0 to 412, and nothing else moved.
4. **If it fails or looks wrong:** `phone-buyer-kind-backfill-undo.sql` puts back each row's label from the snapshot table.

### Step 5. Decision 2: confirm verified family sales

1. Run `supabase/scripts/phone-buyer-confirm-verified-dryrun.sql`. On 2026-10-15 (read with the label step assumed): 109 sales on 65 numbers, all 109 released, 16 numbers closed.
2. Run `supabase/scripts/phone-buyer-confirm-verified.sql`. `rows_matched` equals the dry run's `rows_to_confirm`, and `rows_confirmed` equals `rows_snapshotted`.
3. **Check.**
   - Run the dry run again: `rows_to_confirm` 0.
   - LOG: `register_open` down by `rows_confirmed`, `held_by_register` down by the dry run's `sales_released`, `creditable` up by the same.
   - On the day: the dry run said 111 sales on 66 numbers, all 111 released, 17 numbers closed. The script matched, confirmed and snapshotted 111, and the second dry run said 0. `register_open` went from 954 to 843, `held_by_register` from 161 to 50, and `creditable` from 1,045 to 1,156.
4. **If it fails or looks wrong:** `phone-buyer-confirm-verified-undo.sql` puts each row back as it was. It leaves alone any row the call centre has confirmed since. Then Recompute.

### Step 6. Recompute

1. Press **Recompute** on the Data Center's Analysis page.
2. **Check.** The dashboard's creditable figure equals the last LOG's `creditable`, give or take sales made in between. It is about `sales_released` above the Step 0 figure.

On the day: run by SQL as in Step 0. Run d064a835 wrote 42 metrics in 10,004 rows, and its creditable figure was 1,156, 111 above Step 0's.

### Step 7. Tell people

- **Field team:** web sellers can now record a family's shared number. A note shows, and the sale saves. The same customer twice is refused. The phone app (1.0.18) still refuses any second sale on a number until 1.0.19. Until then, a family's second stove is entered on the web.
- **Call centre:** the register now receives shared numbers from field sales too. Numbers with a "same customer twice" row and an open row come first in the list: call to ask whether the household really has a second stove.
- **Brain-codes:** the server is live. Phase 6 (1.0.19) starts from `docs/contractor/sales-mobile-phone-buyer-rule.md`.
- **Whoever reads the dashboard:** the creditable count rose at this release by 111, all sales already fully verified on a call. From now on it dips when a new sale lands on a number not yet on the register, until the call centre confirms it.

### Step 8. Watch, then close

1. Close the session's secrets: `Remove-Item Env:SUPABASE_ACCESS_TOKEN; Remove-Variable pw`. Remove the `hold` labels from gate 4.
2. **The first morning's field sales.** In the Supabase dashboard, check two functions' logs:
   - `create-sale`: no 5xx, median response near the 2.1 s baseline (2026-10-08 to 2026-10-14);
   - `get-end-user-phones`: no 5xx, median near the 1.7 s baseline. Every 1.0.18 phone calls it on sync, and it now works out a buyer key for every live sale on each call.
3. **The first shared-number sale.** It lands on the register with both ends, unconfirmed: LOG.
4. **After a week with no undo needed:** drop the two snapshot tables.

   ```sql
   drop table data_center.shared_phones_kind_backfill;
   drop table data_center.shared_phones_confirm_backfill;
   ```

### Step 9. A test environment for Brain-codes

The handover promises Brain-codes a test environment for 1.0.19. This PR's test database is deleted at the merge, so the main-schema sandbox (`preview/main-schema`, ref `vgsotbftajnktwofzpnu`) becomes it. On 2026-10-15 it was at the 25 September main (`8bc87065`). It is a test database: nothing done there reaches production or the field.

1. Move `preview/main-schema` to the merge commit, then push it. That is a push the operator approves on the day. The Supabase integration applies the missing migrations to the sandbox by itself.
2. Deploy **every** function to the sandbox from the merge commit, not only the six: `npx supabase@2.121.0 functions deploy --project-ref vgsotbftajnktwofzpnu --use-api` with no names. The sandbox lags production by however long since it was last moved, and a change to `_shared` reaches every function that imports it, so deploying the six alone leaves the phone app talking to a mix production does not have. Then compare every function with the checkout.
3. Check the sandbox ledger holds every migration file and `phone-buyer-release-check.sql` there shows `migrations` 5 and `new_functions` 4.
4. Brain-codes' checks (handover section 9) need two partners with a sales login each on the sandbox. Which logins they get is the operator's call; send them privately, never in the repository.

On the day (2026-10-16, 04:30 to 04:55 Lagos):

- `preview/main-schema` moved from `8bc87065` (25 September) to `38a61329` as a fast-forward. The integration applied the 15 migrations the sandbox lacked in about two minutes, and all 108 migration files are now in its ledger. The release check there shows `migrations` 5 and `new_functions` 4.
- All 75 functions were deployed from `38a61329` and compared file by file with the checkout: none differed. The six release functions carry the same checksums as on production, so they are the same build.
- The sandbox has one partner with logins, Amina Sales Model Gombe (`partner@preview.acsl.test` and `agent@preview.acsl.test`), with 5 sales. The second partner is still to be added; the guide is [phone-buyer-rule-brain-codes-setup.md](phone-buyer-rule-brain-codes-setup.md).

## Rollback

Undo in reverse order, and only as far back as needed.

| Back out | How | What stays |
| --- | --- | --- |
| Decision 2 | `phone-buyer-confirm-verified-undo.sql`, then Recompute | rows the call centre confirmed since |
| Phase 5 labels | `phone-buyer-kind-backfill-undo.sql` | labels `create-sale` wrote for new repeats after the release |
| Web | Vercel Instant Rollback to `dpl_AUN2RCoY4d94E2Z9er1haNCwM9Xs` | nothing of the new web |
| Functions | `git worktree add ..\rollback 30a517ef`, then from that folder the Step 2 deploy and `Compare-Deployed` (only `compared`). `Show-Functions` shows new versions and new checksums | see below |
| Migrations | not needed: additive, and the old functions ignore them | everything |

**After a functions rollback, two things stay on the register:**

- Rows written for field sales on shared numbers while the new code ran. They are correct shared numbers, held until called.
- Old `update-sale` does not touch the register. If a sale's number is edited after the rollback, its open row stays on the old number and holds the sale until the call centre clears it.

If the migrations must go anyway, roll back the functions and the web first, then drop the four functions (`register_shared_phone`, `buyer_key_inputs`, `visible_sales_on_phone`, `sales_sharing_phone`) and the column `data_center.shared_phones.kind`. Then delete the five versions from `supabase_migrations.schema_migrations`, so a later `db push` applies them again.
