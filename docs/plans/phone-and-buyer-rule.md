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

**Phase 3. The phone app's list, and the handoff**
- `get-end-user-phones` keeps `data` exactly as it is and adds `buyerKeys` and `buyerKeyRules`, with an ETag so an unchanged list costs nothing.
- The handoff goes to Brain-codes the day this is live.

**Phase 4. The call centre sees the flag**
- The import writes `kind = 'same_buyer'` for digitised repeats. "Needs a decision" counts same-buyer rows separately and opens them first; the shared-phone page shows the kind; agents tick confirmed with a note as today.
- Shared numbers from Sell Stove and the phone app are registered (source `sales_app`), after the reply is sent so the seller never waits. **Waits on decision 1.**

**Phase 5. The existing repeats**
- `kind` set to `same_buyer` on the existing register rows of the 188 groups, using corrected values where a call recorded them. A dry run reports the counts first; the operator runs it. This changes no crediting.
- What happens to the 48 groups verified on every stove, and to the 291 verified-but-held sales, **waits on decision 2.**

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

## Waiting on the operator

1. **Do shared numbers from Sell Stove and the phone app wait for a call before they count as creditable?** Today every shared number in the register is held out of the creditable count until a call confirms it (decision D23: "the call is how a suspicion becomes a fact"). Registering field sales the same way keeps one rule; registering them as notes that do not hold crediting keeps their numbers moving. Proposal: hold them, like digitised ones.
2. **Calls that already verified the stoves.** 48 repeat-buyer groups are fully verified on every stove, and 291 verified sales across the register are held only because the register was never ticked. Ticking them would raise the creditable count. Proposal: decide after Phase 5's dry run shows exactly which sales would move.
3. **The title list** and **what an agent is told about the other sale** (proposal: its transaction id only).
