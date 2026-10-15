# Phone number and buyer rule: plan

Status: agreed 2026-10-14; mapped the same day; not started. The rule is the operator's of 2026-10-14. It replaces "one live sale per phone", parked on 2026-10-02 ("do not tighten the phone lookup as a side effect"); this plan is the planned piece that park asked for. Digitisation decided the same day: it records a repeat buyer and does not refuse, and the repeat is flagged for the call centre.

## The rule

1. **Same phone, different buyer name: allowed, and noted.** The sale saves. The other sales on that number are reported back to whoever is entering it, and the sharing is visible for review.
2. **Same phone, same buyer name: refused.** That is the same customer entered twice.
3. **It applies across every partner,** not only inside the seller's organisation.
4. **Digitisation is the exception.** A paper receipt records a stove already sold, so a repeat buyer there is saved, not refused, and flagged for the call centre to confirm on a call.
5. **One definition of "same name" is used everywhere:** the server, the web form and the phone app. It is written once, below, with test vectors all three must pass.

## Working rules for this build

- **Nothing breaks for a user between phases.** Each phase ships on its own, and the phone app already in the field (1.0.18) keeps working after every one of them.
- **Speed.** Lookups use the phone tail index; the web form never downloads the whole phone list; the phone app's list is fetched only when it changed; recording a note never makes the seller wait. `create-sale`'s response time is measured from the logs before and after.
  Baseline (production logs, 2026-10-08 to 2026-10-14, five of seven days readable): `create-sale` 78 successful calls, median 2.1 s, 90th percentile 2.7 s, slowest 5.6 s; `get-end-user-phones` 21 calls, median 1.7 s, 90th percentile 2.1 s.
- **Migrations are written as files with the query that proves they landed; the operator runs them.**
- **Nothing already stored is changed or deleted** except where a phase says so and the operator has approved it.

## What production holds (measured 2026-10-14)

- 5,765 sales. 375 numbers sit on more than one sale (964 sales). 220 of those numbers carry more than one buyer name.
- 188 groups where the same buyer and phone repeat (474 sales); 471 of those sales came through digitisation. By call: 48 groups fully verified on every stove, 28 partly, 58 called but not fully verified, 54 never called. In 27 groups a call corrected the name or phone, so the corrected values no longer match.
- The call centre's register (`data_center.shared_phones`) holds 954 rows, all from digitisation, none confirmed. Every live shared number is in it.
- **The register decides crediting.** `data_center.compute_analysis` leaves out of the creditable count any sale with an unconfirmed register row ("Phone shared, unconfirmed"). 951 live sales are held that way today: 467 same buyer, 482 different names. 291 of them are fully verified on a call but still held, because verifying a sale does not tick the register.
- Names: 1 of 5,765 carries a non-ASCII character. 64 carry bracketed aliases. Honorifics appear about 130 times.
- The phone app in the field is 1.0.18 (`app_releases`, not forced). `create-sale` is v57 (deployed 2026-10-14). `get-end-user-phones` is the July build (v11).

## The map (2026-10-14)

Four read-only passes, split by direction of flow, then the claims that change the plan checked by hand.

**Who writes a sale's phone or buyer name.** Only `create-sale` and `update-sale`. Digitisation reaches `create-sale` over HTTP with `allowSharedPhone: true`. The call centre stores corrected phones and names in `call_records` only; a person carries a correction into the sale through `update-sale`. The ERP never writes these fields here. No database constraint or trigger enforces phone uniqueness; the rule lives only in code.

**Defects in today's check, found by the map** (fixed in Phase 1 as part of the change):
- **A lost reply strands a phone sale.** `create-sale` checks the phone (line 304) before the transaction id (line 395). When the phone app retries a sale that did save, it gets the phone refusal, which it does not recognise as "already saved", so the sale stays queued and refused forever. The app keeps the same transaction id on every retry; the server never reads its `clientRequestId`.
- **The check runs as the caller,** so a partner cannot see other partners' sales and cross-partner repeats pass. `update-sale` checks globally: two scopes for one rule.
- **The lookup scans the table** (`ilike '%tail%'`, 7.5 ms today, growing), would miss a number stored with spaces or dashes (none on production today), and still counts cancelled sales, although the code comment says cancelling frees the number. The tail index already exists and leaves cancelled sales out. Measured on production: the two agree on 369 of 375 shared numbers; the other 6 differ only by the 13 cancelled sales on them, which stop counting.
- **A name-only edit is never checked** by `update-sale`.
- **A lookup error is ignored** and the sale goes through (fails open). Kept as is: refusing every sale when the lookup hiccups would be worse; the register catches the rare miss.

**What depends on the exact words or shapes** (each kept or changed on purpose):
- The phone app treats a 409 as "already saved" only if its message contains both "transaction id" and "already exists"; the Data Center import retries a refusal three times if it mentions "transaction id". New messages avoid both.
- The phone app reads `get-end-user-phones` as a list of 10-digit strings under `data`; that stays exactly as it is, and new fields are added beside it.
- `shares_phone_with` means two shapes today: `create-sale` returns `{ sale_id, transaction_id }`, the call record read returns `{ stove_id, buyer, sale_id }`. `create-sale` only adds `same_buyer`; the other shape is untouched.
- The web form clears its own error by matching the start of its message text; the Stove record page shows any second sale on a number as a red "one stove goes to one phone number" violation; the e2e spec `non-interference` pins the old 409 text; the user guide and three docs quote the old rule.

**Inside the database.** The name trigger (`sales_a_name_parts`) keeps the joined name equal to first name plus surname whenever the parts are present, so the key reads the same name either way. The register has no row policies; it is protected by the `data_center` schema being closed to signed-in users, and is reached by the Data Center functions over a direct connection. A new `kind` column needs a default, or both existing inserts break. A new `public` function is callable by signed-in users unless its execute right is revoked; the pattern is `sale_call_work`.

**In flight elsewhere.** Branch `fix/close-open-reads` (7 Oct, recovery work, no PR) changes the start of `get-end-user-phones` to refuse accounts outside the sales app; edits here stay clear of those lines. Three unmerged branches carry migrations dated 6 and 7 Oct, so new migrations are dated after them. No open PR, upstream sync or newer phone app collides.

## The buyer key

Defined once here; the code in each language follows it exactly.

- **Phone tail:** keep the digits only; fewer than 10 means no key; otherwise the last 10.
- **Name source:** first name and surname joined with a space when either is present, otherwise the joined `end_user_name`.
- **Name key:**
  1. Remove any text in square brackets or round brackets, brackets included (an alias, not the name).
  2. Lower-case A to Z only (ASCII).
  3. Turn whitespace, commas and slashes into a single space.
  4. Delete every other character that is not a to z or a space (so `Mu'azu` is `muazu`, `Ade-Bayo` is `adebayo`).
  5. Split on spaces, drop empty words and any word on the title list, sort the words, join with one space.
  An empty name key means the name check does not run; only the shared-number note can apply.
- **Title list** (configuration, served by the server, not typed into any client): `mr mrs miss ms dr alhaji alhaja hajia hajiya malam mallam chief madam`. "Mama" and "Baba" are kept, because they are often the name a person goes by.
- **Buyer key:** the first 16 hex characters of SHA-256 over the UTF-8 text `<tail>|<name key>`. The phone app compares keys, so a device never holds a list of customer names.
- **Corrections.** Where a call recorded a corrected phone or name, the register and the backfill use the corrected value, because the call is the fact.

Test vectors (every implementation must produce these):

| First name | Surname | Joined name | Phone | Tail | Name key | Buyer key |
|---|---|---|---|---|---|---|
| Aisha | Bello | | 08031234567 | 8031234567 | aisha bello | a98b6aac661bef64 |
| BELLO | aisha | | +2348031234567 | 8031234567 | aisha bello | a98b6aac661bef64 |
| `  Aisha ` | ` Bello` | | 234 803 123 4567 | 8031234567 | aisha bello | a98b6aac661bef64 |
| | | Aisha Bello | 8031234567 | 8031234567 | aisha bello | a98b6aac661bef64 |
| | | Bello, Aisha | 0803-123-4567 | 8031234567 | aisha bello | a98b6aac661bef64 |
| Mrs Aisha | Bello | | 08031234567 | 8031234567 | aisha bello | a98b6aac661bef64 |
| Aisha | Bello [Mama Ade] | | 08031234567 | 8031234567 | aisha bello | a98b6aac661bef64 |
| Alhaji Musa | Bello | | 08031234567 | 8031234567 | bello musa | 144af3b241a14237 |
| Mu'azu | Ade-Bayo | | 08031234567 | 8031234567 | adebayo muazu | d8e61139c2a48191 |
| Mama | Ngozi | | 08031234567 | 8031234567 | mama ngozi | c6681ebc3ee3a674 |
| Aishat | Bello | | 08031234567 | 8031234567 | aishat bello | e43a70e6f911b57f |
| Aisha | Bello | | 07031234567 | 7031234567 | aisha bello | 73d241344030ad83 |
| (empty) | (empty) | (empty) | 08031234567 | 8031234567 | (empty) | (none) |
| Mrs | (empty) | | 08031234567 | 8031234567 | (empty) | (none) |
| Aisha | Bello | | 803123 | (none) | aisha bello | (none) |

The vectors live in one file, `supabase/functions/_shared/buyer-key-vectors.json`, which the tests read and which is handed to the phone app as is.

## Phases

Each phase is one PR, proven on a preview branch, live before the next starts. After every phase the web app, the Data Center and phone app 1.0.18 all keep working.

**Phase 0. Groundwork, no behaviour change.** Built 2026-10-14 on #146; its spec failed on a database without the migration and passes on #146's test database (4 of 4).
- `_shared/buyerKey.ts` and its test over the vectors file.
- Migration A: a server-only function `public.sales_sharing_phone(p_tail text, p_exclude uuid)` returning the live (not archived) sales on a tail with their names, read through the tail index; execute revoked from signed-in users. `data_center.shared_phones` gains `kind text not null default 'shared_number'` (check: `shared_number`, `same_buyer`), so both existing inserts keep working.
- Baseline: `create-sale` median and slowest response times from the logs.
- Proof: the vectors test; the function returns what the old query returns on a sample of real tails, minus cancelled sales; a signed-in account calling it is refused; existing register writes still succeed on the branch.

**Phase 1. The rule on the server.** Built and tested 2026-10-14 on #146's test database (not released). `host-phone-buyer-rule` 12 of 12 and `non-interference` 7 of 7 pass; against today's functions 9 of the 12 fail as predicted (including a retried, already-saved sale refused as "already used on sale" its own id), and the 3 that pass on both are the plain first sale, the cross-partner case today's caller-scoped check cannot see, and the disconfirming case. Speed on the test database: a successful sale 1.9 s median against 2.1 s for today's code; a refusal 1.3 s against 0.6 s, because the customer check now runs after the stove and payment checks. The first run also found that a database built from the migrations alone gave the server no read on `sale_field_rules`, so every server-side sale insert failed there; `20261014120100` grants it (a no-op on production, which already has it).
- `create-sale`: the transaction id check moves before the phone check (a retried sale that already saved is recognised again); the phone lookup goes through the new function, globally. Same buyer: 409 with `code: "SAME_BUYER_SAME_PHONE"` and the message below. Shared number with another name: saves, and `shares_phone_with` lists the other sales with `same_buyer: false`. Digitisation (`allowSharedPhone`): never refused; `same_buyer` marks the repeats.
- `update-sale`: the same rule when the phone or the name changes, excluding the sale itself.
- The message, written to be read on the phone app's pending card as it is today: "Not saved: this customer (same name and phone number) is already registered on sale TR-XXXXXX. The same customer cannot be recorded twice. Check the name and phone number. If they are correct, this sale is a duplicate and does not need to be saved."
- **What the caller is told.** The rule is global; the identifiers are not. Another sale is named (in the refusal, and in `shares_phone_with`) only when the caller's own access already lets them read it, which is all the old caller-scoped check ever showed. Otherwise the refusal says "another sale" and the list leaves it out. The check runs last, after the stove and payment checks and before any write.
- `non-interference` spec updated to the new rule; new specs for every case under "How it is proven".
- Old phone app: still blocks any reused number before sending (stricter, safe); a refused sale shows the message above on its card; the batch carries on (each queued sale is synced on its own).

**Phase 2. The web form and the screens that state the old rule.** Built and tested 2026-10-14 on #146's test database (not released).
- Sell Stove's live check makes one small read per typing pause (300 ms, as before) and shows a note for a shared number, an error for the same buyer. No list is downloaded.
  - The read is `visible_sales_on_phone` (migration `20261014120200`). It is security invoker, so the caller's own row rules decide what it returns, and it reads `idx_sales_phone_tail` (EXPLAIN on production: bitmap index scan).
  - The names are compared in the browser with `_shared/buyerKey.ts` itself, so the rule is written once.
  - It shows nothing about sales the caller cannot see. A repeat on one of those is still refused by `create-sale` on save.
  - Measured on the preview: median 308 ms, 253 to 567 ms over 8 lookups.
- The result has its own state. The form no longer clears its error by matching the start of a message.
- An edit is checked only when its number or name changes, and only once its original values have loaded.
- After a save on a shared number, the Sell Stove confirmation names the other sales. It does not say "noted", because nothing is registered until Phase 4.
- The Stove record lists up to 50 other sales on the number, oldest first, each marked `same_buyer` or not. A shared number is amber. A repeat of the same customer is red, with that row tagged.
- The user guide, `STOVE-RECORD.md`, the app documentation and the API docs state the new rule.
- Found while building the spec, and live today:
  - Previous stove type is required by the field rules but shows no message, so a save the form refused looked like a button that did nothing.
  - A refused save now lists what is missing in the banner, and the banner is scrolled into view.
- Results:
  - `host-phone-buyer-screens` passes 8 of 8. Each case was run against today's code first and failed as predicted.
  - The case includes a partner saving a real sale through the screen, with the sale, its address and the sold stove checked.
  - With groundwork, the server rule, `non-interference`, the Stove record, page loads and field parity, 76 of 76 pass.
- An independent review found no serious defect. Its two points are fixed: the edit form loading, and the cap of 5 rows.

**Phase 3. The phone app's list, and the handoff.** Built and tested 2026-10-15 on #146's test database (not released).
- `get-end-user-phones` keeps `data` as phone app 1.0.18 reads it. Its content is the same; the list is now sorted and read in a fixed page order, so the same sales always give the same body.
- Beside `data` it adds:
  - `buyerKeys`: keys only, never names.
  - `buyerKeyRules`: the served title list and its version.
  - An ETag: an unchanged list costs a 304 and no download.
- **The keys cover the live sales the signed-in account can read**, through `buyer_key_inputs` (migration `20261014120300`): security invoker, one JSON array, one round trip. This is the same scope as the Sell Stove check in Phase 2. A repeat of a customer the account cannot read is refused by `create-sale` at sync, with the message on the card.
- **The gateway passes the ETag on as a weak tag** (`W/"..."`). The function accepts it in either form. Without that no phone would ever get a 304.
- Speed on production data (5,740 live sales):
  - the key read takes 11 ms warm;
  - computing the keys takes 110 to 160 ms;
  - the keys add about 109 KB, downloaded only when the list changed;
  - today's call has a median of 1.7 s.
- Results:
  - `host-phone-buyer-list` passes 6 of 6. Against today's function, the data check passes (it pins the contract) and the keys, scope and ETag checks fail as predicted.
  - With groundwork and `non-interference`, 17 of 17.
- **The handoff** (`docs/contractor/sales-mobile-phone-buyer-rule.md`) was rewritten against sales-mobile `ff16cf6`, the newest code on both remotes. It covers every surface the app touches, file by file, and goes to Brain-codes when the server is live.
- **What it found in the app:**
  - The network layer drops an error body, so `code` never reaches the app.
  - The live check ignores names.
  - A refused queued sale retries forever and re-uploads its photos.
  - Sync never adds a saved sale's number to the cache.
  - The create and sync calls have no timeout.
  - The in-memory phone set outlives a logout.
- **Until 1.0.19:** 1.0.18 blocks any reused number on the device, so a family member's sale on a shared number is entered on the web.

**Phase 4. The call centre sees the flag**
- The import writes `kind = 'same_buyer'` for digitised repeats. "Needs a decision" counts same-buyer rows separately and opens them first; the shared-phone page shows the kind; agents tick confirmed with a note as today.
- Shared numbers from Sell Stove and the phone app are registered (source `sales_app`), after the reply is sent so the seller never waits. They hold crediting until a call confirms them, as digitised ones do (decision 1, settled 2026-10-15).
- **Built and tested 2026-10-15 on #146's test database (not released).** Decision D65 in `src/app/data-center/decisions.md`.
- **The writer.** `register_shared_phone` (migration `20261014120400`, server only) is called by `create-sale` after every save on a full number, and by `update-sale` when an edit changes the number.
  - It registers every live sale on the number, both ends, unconfirmed when new.
  - Sell Stove and the phone app register as `sales_app`; the import as `digitalisation`. The import no longer depends on what the typist can see, because `create-sale` reads every partner.
  - `same_buyer` is never downgraded. Rows already there keep their source, confirmed flag and note, and are rewritten only when something changed.
  - A sale that moves takes its open row with it, and a number left with one sale leaves the register.
  - All three writers (this, the import's commit, the call centre's confirm) take rows in sale id order. The register gives up on a lock after 5 s.
- **The read.** Each row carries its kind; each number an open count and a same-customer flag. Open repeats are listed first and can be filtered to. The whole register is counted in the database.
- **Needs a decision** has a line for the same customer twice that opens the register narrowed to repeats. It counts from those totals; it used to read the first 200 numbers, and a confirmed number that gained a sale looked closed.
- **Consequence to know at release.** A sale already verified and creditable is held again when a new sale lands on its number and that number is not yet on the register, until the call centre confirms it. On a number the call centre has already confirmed, only the new sale is held. That is decision 1 applied to a new suspicion, and creditable counts will dip as field sales share numbers.
- **Results:**
  - `host-phone-buyer-register` passes 12 of 12. Against today's functions, the registration, kind, count and screen checks failed as predicted, and the no-write guard passed.
  - An independent review found no security problem. It found four defects, now fixed and tested: two first sales at once unregistered, a deadlock risk with the import, needless rewrites, and missing tests.
  - Wide regression: 108 of 113. The five failures are the test database's fixtures, not this change:
    - two pass with the suite's own setup;
    - reassignment is refused for agent capacity after that setup;
    - two import-chain tests need 6 uncalled sales, and this database holds 7 sales in all.
    - None of those paths reads the register.

**Phase 5. The existing repeats.** Built and tested 2026-10-15 on #146's test database (not run on production).
- **Three scripts in `supabase/scripts/`, run by hand.** They are not migrations because they are for the rows production already holds, and they must run after the Phase 4 functions are live, which is after the migrations.
  - `phone-buyer-kind-backfill-dryrun.sql` reads only and counts what would change.
  - `phone-buyer-kind-backfill.sql` keeps each row's kind in a snapshot table, then marks the repeats, in one statement. It is safe to run twice and leaves `updated_at` alone, so the list's order does not jump.
  - `phone-buyer-kind-backfill-undo.sql` puts the snapshot back.
- **Which rows.** A register row is marked when another row on its number belongs to a sale with the same buyer key, with the call's corrected phone or name in place of the written one. Archived sales are left out. It is a label only: no sale moves in or out of the creditable count.
- **The key is written a second time, in SQL,** so the script picks its rows at the moment it runs instead of carrying a list that goes stale. On production all 5,740 live name keys agree with `buyerKey.ts`, and so do the 416 rows it would mark. The spec checks it against the shared vectors and against whitespace the vectors do not carry.
- **Dry run on production, 2026-10-15, read only:**
  - The key reproduces the 14 October baseline exactly, 188 groups and 474 sales, when archived sales are counted as that baseline counted them. Live sales alone: 185 groups, 467 sales.
  - With the calls' corrections: 171 groups, 418 sales. Calls split 28 written groups (in 15 a phone was corrected to another number, in 8 a name on part of a pair, in 5 every name) and joined 6.
  - To mark: 416 rows on 166 numbers, none of them confirmed. Two more repeat sales sit on no shared written number (only a correction joins them), so they have no register row and are left alone.
- **Results:** `host-phone-buyer-backfill` passes 5 of 5 on the test database (marks repeats and only repeats across nine numbers, including corrected names and corrected phones; the second run changes nothing; the undo restores everything). Broken on purpose four ways (corrected names ignored, corrected phones ignored, a whitespace-only correction taken as a name, the no-break space missing), it failed every time.
- **Independent review:** nothing that blocks a production run. Taken from it: the backfill locks its rows first, in sale id order like every register writer, so a row create-sale marks during the run is never snapshotted with a kind the backfill did not change; a correction of only whitespace is no correction; the corrected-phone cases above.
- **Release step:** run the dry run, then the backfill, after the functions are deployed. From then on `create-sale` marks every new repeat itself.
- What to do with the verified sales the register still holds **waits on decision 2**, now with the dry run's figures.

**The release.** Phases 1 to 5 and decision 2 go to production together, in the order and with the checks and rollback points in [phone-and-buyer-rule-release.md](phone-and-buyer-rule-release.md). Written 2026-10-15; it runs on the operator's release word.

**Phase 6. Brain-codes: phone app 1.0.19.** From the handoff, against the live server.

## How it is proven

One test per behaviour, each watched failing on today's code first:

- Same phone, different name, other partner: saves, and `shares_phone_with` names the first sale.
- Same name and phone, other partner: 409 `SAME_BUYER_SAME_PHONE`.
- Same name and phone written differently (order swapped, `+234` against `080`, a title, an alias in brackets): 409.
- **Disconfirming:** same name, different phone: saves. A name alone never refuses.
- A retried sale whose first attempt saved: recognised as already saved, not refused.
- A cancelled sale's number: free to use.
- Digitisation, same name and phone: saves, and `same_buyer: true` on the earlier sale.
- Edit without touching phone or name: saves. Edit the name so it matches another sale on the same number: 409.
- Phone app 1.0.18 against the new server, including a batch with one refused sale: the others sync.
- Parity: the key over production reproduces 188 groups and 474 sales.
- Speed: `create-sale` response time no worse than the baseline.

## Invariants

- No new sale or edit from Sell Stove or the phone app leaves two live sales with the same buyer key. Digitisation may, and every such repeat is in the register as `same_buyer` until a call confirms it.
- A shared number never blocks a sale by itself.
- The key is computed the same way everywhere; the vectors file is the oracle.
- The phone app never receives buyer names in bulk.
- `get-end-user-phones` keeps its `data` list unchanged.

## Non-goals

- Fuzzy name matching (typos, nicknames beyond brackets, accented letters). A mismatch falls to the safe side: the sale saves and is noted.
- Merging, cancelling or deleting any sale.
- A database-level unique index.
- Changing who may read the phone list.

## Later

- A database backstop if a race between two simultaneous sales is ever seen.
- Accent folding, if non-ASCII names start appearing.

## Decided

- **Digitisation and one buyer with several stoves** (2026-10-14): digitisation records the repeat and does not refuse; the repeat is flagged for the call centre to confirm. Sell Stove and the phone app refuse.
- **Order** (2026-10-14): here first, then the phone app.
- **Field sales on shared numbers** (2026-10-15, decision 1): held until a call confirms them, like digitised ones. D65.
- **Verified sales held only by the register** (2026-10-15, decision 2): confirm the different-name ones by script after release; the same customer twice waits for a call. D66.

## Waiting on the operator

1. **Do shared numbers from Sell Stove and the phone app wait for a call before they count as creditable?** Today every shared number in the register is held out of the creditable count until a call confirms it (decision D23: "the call is how a suspicion becomes a fact"). Registering field sales the same way keeps one rule; registering them as notes that do not hold crediting keeps their numbers moving. Proposal: hold them, like digitised ones. **Decided 2026-10-15 by the operator: hold them.**
2. **Calls that already verified the stoves.** 299 verified sales are held by the register today (291 on 14 October). For 147 of them the register is not the only thing in the way, mostly the household question, so ticking it would not make them creditable. The other 152 pass every other gate and would become creditable:
   - 104 are different names on a shared number. Each stove was verified with its own holder.
   - 48 are the same customer twice, in 34 groups. Every group has a different stove ID on each sale, so these are separate stoves, not one stove entered twice. In 22 of the 34 groups every call answered "only stove" in the household, which sits badly with one customer holding two.
   - Proposal: after release, confirm the 104 on the register by script, the operator running it, with a dry run and an undo as in Phase 5. Leave the 48 for a call that asks about the second stove. **Decided 2026-10-15 by the operator: as proposed** (D66).
   - **Built and tested 2026-10-15 on #146's test database (not run on production).** Three scripts in `supabase/scripts/`:
     - `phone-buyer-confirm-verified-dryrun.sql` reads only.
     - `phone-buyer-confirm-verified.sql` snapshots each row, then confirms it.
     - `phone-buyer-confirm-verified-undo.sql` restores the snapshot, leaving alone any row the call centre has confirmed since.
   - **How it chooses.** It takes the open rows of sales that pass every other gate of the creditable count. It runs the analysis's own completeness rule, read from the database when it runs, so it carries no copy of it. It skips a repeat whether it carries the `same_buyer` label or is only found by the kind backfill's block. The confirmed row keeps its source and kind and gains a note that says why.
   - **Dry run on production (read only):** 104 rows on 62 numbers. All 104 sales leave the hold, and 15 numbers close completely. They are the same 104 sales the analysis's reason ladder gives, one for one.
   - **Tests:** `host-phone-buyer-confirm` passes 4 of 4 on the test database. It covers fourteen sales on seven numbers, one for each gate. Broken on purpose four ways (repeats not excluded, completeness ignored, the undo blind to a later call, the undo leaving the confirmation's time), it failed every time. An independent review found nothing blocking; its test points are in.
   - **Release step:** after the kind backfill, the dry run, then this, then the next analysis run. Creditable counts rise by about 104.
3. **The title list** and **what an agent is told about the other sale** (proposal: its transaction id only).
