# Phone number and buyer rule: plan

Status: agreed 2026-10-14, not started. The rule is the operator's of 2026-10-14. It replaces "one live sale per phone", which was parked on 2026-10-02. Digitisation decided the same day: it records a repeat buyer and does not refuse, and the repeat is flagged for the call centre.

## The rule

1. **Same phone, different buyer name: allowed, and noted.** The sale saves. The other sales on that number are reported back to whoever is entering it, and the sharing is visible on the record for review.
2. **Same phone, same buyer name: refused.** That is the same customer entered twice.
3. **It applies across every partner,** not only inside the seller's organisation.
4. **Digitisation is the exception.** A paper receipt records a stove already sold, so a repeat buyer there is saved, not refused, and flagged for the call centre to confirm on a call.
5. **One definition of "same name" is used everywhere:** the server, the web form and the phone app. It is written once, below, with test vectors all three must pass.

## What changes today, by entry point

| Entry point | Today | After |
|---|---|---|
| `create-sale` (web Sell Stove, phone app, Data Center commit) | Refuses any number already on a sale (409). Since 26 Sep the lookup runs as the caller, so it only sees the caller's own scope. | Looks across all sales as the server. Refuses same buyer and phone (409, code `SAME_BUYER_SAME_PHONE`); accepts a shared number and returns `shares_phone_with`. |
| `update-sale` (phone or name edit) | Refuses an edit that moves the phone onto a number already used. Already runs as the server. | Same rule as create, checked when the phone or the name changes, excluding the sale itself. |
| Web Sell Stove live check | Reads `sales` as the caller (scope-limited) and blocks any reused number. | Uses the same list the phone app uses (`get-end-user-phones`). A shared number shows a note; same buyer and phone shows an error. |
| Phone app (APK) | Blocks any reused number, offline, against a cached list of every number. | Same as the web form, offline. Brain-codes' slice: see `docs/contractor/sales-mobile-phone-buyer-rule.md`. Until it ships, the app stays stricter than the rule, which is safe. |
| Data Center digitisation | Sends `allowSharedPhone: true`; a reused number is reported and recorded in `data_center.shared_phones`. | Still never refused. `create-sale` says which of the other sales are the same buyer; the import records those in the same register marked as the same buyer, and they appear in the call centre's "needs a decision" block for a call. |
| Call centre | The shared-phone register (`data_center.shared_phones`) holds digitisation's shared numbers, each with a source and a confirmed tick, shown in "needs a decision" and on its own page. | The register gains one field, `kind`: `shared_number` or `same_buyer`. Same-buyer rows are shown first and say "same buyer on more than one stove: confirm on a call". Shared numbers from Sell Stove and the phone app are registered too (source `sales_app`, a value the register already allows). |

## What production holds (measured 2026-10-14)

- 5,765 sales. 375 numbers sit on more than one sale (964 sales). 220 of those numbers carry more than one buyer name.
- 188 groups where the same buyer and phone repeat (474 sales). Group sizes: 140 pairs, 30 of three, and a tail up to one buyer on 13 sales. 16 groups span more than one partner.
- **471 of those 474 sales came through Data Center digitisation.** Field sales almost never repeat a buyer.
- Names: 1 of 5,765 carries a non-ASCII character (a curly apostrophe). 64 carry bracketed text (aliases such as "[Mama Ade]"). Honorifics appear about 130 times (Alhaji 47, Baba 31, Malam 20, Mrs 10).

The rule applies to new sales and edits. Nothing already stored is changed or deleted.

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
- **Title list** (configuration, served by the server, not typed into any client): `mr mrs miss ms dr alhaji alhaja hajia hajiya malam mallam chief madam`. "Mama" and "Baba" are kept, because they are often the name a person goes by ("Mama Ngozi"). See open question 2.
- **Buyer key:** the first 16 hex characters of SHA-256 over the UTF-8 text `<tail>|<name key>`. The phone app compares keys, so a device never holds a list of customer names.

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

The vectors live in one file, `supabase/functions/_shared/buyer-key-vectors.json`, which the Deno tests read and which is handed to the phone app as is.

## Slices, in order

Each slice ships on its own and leaves the system working.

**S1. Server rule, and the list the clients need** (one PR with S2)
- `_shared/buyerKey.ts`: phone tail, name key, buyer key, title list; Deno test over the vectors file.
- `create-sale`: the phone lookup moves to the server client and compares buyer keys. Same key: 409 with `code: "SAME_BUYER_SAME_PHONE"` and the other sale's transaction id. Shared number only: save, and return `shares_phone_with` always (today only when `allowSharedPhone` is sent), each entry now carrying `same_buyer: true|false`. With `allowSharedPhone` (digitisation only) a same-buyer repeat saves instead of refusing, and is reported the same way. The 409 message must not contain the words "transaction id" and "already exists" together, because the phone app reads that pair as "already saved".
- `update-sale`: the same check when the phone or the name changes, excluding the sale itself.
- `get-end-user-phones`: adds `buyerKeys` (array) and `buyerKeyRules` (`{ version, titles }`) beside the existing list. Additive: today's app ignores both.
- Proof: Deno vectors test; a parity check that runs the key over every production sale and matches the counts above (188 groups, 474 sales); preview-branch specs for the cases under "How it is proven".

**S2. Web Sell Stove** (same PR as S1)
- The live check calls `get-end-user-phones` once per form, computes the key in the browser with the served titles, and shows a note for a shared number, an error for same buyer and phone. It replaces the scope-limited `sales` read.
- After a save that returns `shares_phone_with`, the success state says the number is shared and names the other transaction ids.
- Proof: preview screenshots of the note and the error; the existing Sell Stove specs stay green.

**S3. Brain-codes: the phone app.** Starts when S1 is live. The handoff is the contract.

**S4. The call centre sees the flag** (runs here while S3 is with Brain-codes)
- Migration: `data_center.shared_phones` gains `kind text not null default 'shared_number' check (kind in ('shared_number','same_buyer'))`. Written as a file with the query that proves it landed, for the operator to run.
- `data-center-import`: it already records `shares_phone_with`; it now writes `kind = 'same_buyer'` for entries with `same_buyer: true`, source `digitalisation`, unconfirmed.
- `create-sale`: a shared number from Sell Stove or the phone app is registered with source `sales_app` and `kind = 'shared_number'`, through a server-only database function (the `data_center` schema stays out of PostgREST).
- Call centre: "needs a decision" counts same-buyer rows separately and opens them first; the shared-phone page shows the kind and lets the agent tick confirmed with a note, as it does today.
- Proof: a digitised repeat appears in "needs a decision" as same buyer; a Sell Stove sale on a shared number appears in the register as `sales_app`; confirming one clears it from the count.

**S5. Backfill the existing repeats into the call centre.** The 188 same-buyer groups (474 sales, 471 of them digitised) are written into the register as `same_buyer`, unconfirmed, so the call centre works through them with the same screen. A dry run first that reports the counts it would write; the operator runs the real one. Nothing about the sales themselves changes.

## How it is proven

Before any code, one test per behaviour, each watched failing on today's code first:

- Same phone, different name, other partner: saves, and `shares_phone_with` names the first sale.
- Same name and phone, other partner: 409 `SAME_BUYER_SAME_PHONE`.
- Same name and phone written differently (order swapped, `+234` against `080`, a title, an alias in brackets): 409.
- **Disconfirming:** same name, different phone: saves. A name alone never refuses.
- Digitisation, same name and phone: saves, and `shares_phone_with` marks the earlier sale `same_buyer: true`.
- Edit a sale without touching phone or name: saves (no self-match).
- Edit the phone onto another sale's number under the same name: 409.
- Phone app on today's build, against the new server: unchanged behaviour (stricter, nothing breaks).
- Parity: the TypeScript key over production reproduces 188 groups and 474 sales; the phone app's Dart key reproduces every vector.

## Invariants

- No new sale or edit from Sell Stove or the phone app leaves two live sales with the same buyer key. Digitisation may, and every such repeat is in the register as `same_buyer` until a call confirms it.
- A shared number never blocks a sale by itself.
- The key is computed the same way in every place; the vectors file is the oracle.
- No stored sale changes because of this work.
- The phone app never receives buyer names in bulk.

## Non-goals

- Fuzzy name matching (typos, nicknames beyond brackets, accented letters). A mismatch falls to the safe side: the sale saves and the number is noted.
- Merging, cancelling or deleting the existing repeats.
- A database-level unique index. Two people entering the same buyer in the same second is not a real risk today; it moves to "later" if it is ever seen.
- Changing the transaction id duplicate guard, the stove claim, or who may read the phone list.

## Later

- A database backstop if a race is ever observed.
- Accent folding, if non-ASCII names start appearing.

## Implementation order: here first, then the phone app

The server goes first, because it is the rule every channel ends at and the phone app's half depends on it:

1. **S1 and S2 here**, one PR, proven on a preview branch, then live. Today's APK keeps working against it unchanged (it stays stricter).
2. **S3 with Brain-codes** from the day S1 is live: the new list fields and the error code exist for them to build and test against. Two of their steps need nothing from us and can start now: carrying the error code, and the key function with its test over the vectors file.
3. **S4 and S5 here** while Brain-codes work, since they touch only the Data Center.

Building the phone app first would leave it nothing to test against, and its offline check would disagree with a server that still refuses every reused number.

## Decided

- **Digitisation and one buyer with several stoves** (2026-10-14): digitisation records the repeat and does not refuse; the repeat is flagged for the call centre to confirm. Sell Stove and the phone app refuse.

## Open questions

1. **The title list.** Proposed above, with Mama and Baba kept as names. The list is configuration, so it can change without a release.
2. **What an agent is told about the other sale.** Proposal: its transaction id only, never the other buyer's name or partner.
