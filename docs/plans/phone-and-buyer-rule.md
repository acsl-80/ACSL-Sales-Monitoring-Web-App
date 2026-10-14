# Phone number and buyer rule: plan

Status: proposed 2026-10-14, not started. The rule is the operator's of 2026-10-14. It replaces "one live sale per phone", which was parked on 2026-10-02.

## The rule

1. **Same phone, different buyer name: allowed, and noted.** The sale saves. The other sales on that number are reported back to whoever is entering it, and the sharing is visible on the record for review.
2. **Same phone, same buyer name: refused.** That is the same customer entered twice.
3. **It applies across every partner,** not only inside the seller's organisation.
4. **One definition of "same name" is used everywhere:** the server, the web form and the phone app. It is written once, below, with test vectors all three must pass.

## What changes today, by entry point

| Entry point | Today | After |
|---|---|---|
| `create-sale` (web Sell Stove, phone app, Data Center commit) | Refuses any number already on a sale (409). Since 26 Sep the lookup runs as the caller, so it only sees the caller's own scope. | Looks across all sales as the server. Refuses same buyer and phone (409, code `SAME_BUYER_SAME_PHONE`); accepts a shared number and returns `shares_phone_with`. |
| `update-sale` (phone or name edit) | Refuses an edit that moves the phone onto a number already used. Already runs as the server. | Same rule as create, checked when the phone or the name changes, excluding the sale itself. |
| Web Sell Stove live check | Reads `sales` as the caller (scope-limited) and blocks any reused number. | Uses the same list the phone app uses (`get-end-user-phones`). A shared number shows a note; same buyer and phone shows an error. |
| Phone app (APK) | Blocks any reused number, offline, against a cached list of every number. | Same as the web form, offline. Brain-codes' slice: see `docs/contractor/sales-mobile-phone-buyer-rule.md`. Until it ships, the app stays stricter than the rule, which is safe. |
| Data Center digitisation | Sends `allowSharedPhone: true`; a reused number is reported and recorded in `data_center.shared_phones`. | Depends on open question 1. |

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
- `create-sale`: the phone lookup moves to the server client and compares buyer keys. Same key: 409 with `code: "SAME_BUYER_SAME_PHONE"` and the other sale's transaction id. Shared number only: save, and return `shares_phone_with` always (today only when `allowSharedPhone` is sent). The 409 message must not contain the words "transaction id" and "already exists" together, because the phone app reads that pair as "already saved".
- `update-sale`: the same check when the phone or the name changes, excluding the sale itself.
- `get-end-user-phones`: adds `buyerKeys` (array) and `buyerKeyRules` (`{ version, titles }`) beside the existing list. Additive: today's app ignores both.
- Proof: Deno vectors test; a parity check that runs the key over every production sale and matches the counts above (188 groups, 474 sales); preview-branch specs for the cases under "How it is proven".

**S2. Web Sell Stove** (same PR as S1)
- The live check calls `get-end-user-phones` once per form, computes the key in the browser with the served titles, and shows a note for a shared number, an error for same buyer and phone. It replaces the scope-limited `sales` read.
- After a save that returns `shares_phone_with`, the success state says the number is shared and names the other transaction ids.
- Proof: preview screenshots of the note and the error; the existing Sell Stove specs stay green.

**S3. Brain-codes: the phone app.** Starts when S1 is live. The handoff is the contract.

**S4. The note is visible for review**
- A shared number is derived from the data (the phone tail is indexed), not stored a second time. The sale's detail shows "This number is also on" with the other transaction ids, and the sales export gains a "Shares phone with" column.
- Proof: a sale on a shared number shows the line; the export column matches a SQL count.

**S5. Review list of the existing repeats.** A one-off list of the 188 same-buyer groups for the team to judge. Nothing is changed by it; any merge or cancellation is a person's decision through the existing screens.

## How it is proven

Before any code, one test per behaviour, each watched failing on today's code first:

- Same phone, different name, other partner: saves, and `shares_phone_with` names the first sale.
- Same name and phone, other partner: 409 `SAME_BUYER_SAME_PHONE`.
- Same name and phone written differently (order swapped, `+234` against `080`, a title, an alias in brackets): 409.
- **Disconfirming:** same name, different phone: saves. A name alone never refuses.
- Edit a sale without touching phone or name: saves (no self-match).
- Edit the phone onto another sale's number under the same name: 409.
- Phone app on today's build, against the new server: unchanged behaviour (stricter, nothing breaks).
- Parity: the TypeScript key over production reproduces 188 groups and 474 sales; the phone app's Dart key reproduces every vector.

## Invariants

- No new sale or edit leaves two live sales with the same buyer key, unless it came through a path the operator exempts (open question 1).
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
- Retiring `allowSharedPhone` once digitisation follows the same rule.

## Open questions

1. **Digitisation and one buyer with several stoves.** 471 of the 474 existing repeats came from paper receipts, up to 13 stoves for one name and number. Either a buyer can genuinely hold several stoves (a household head, a bulk buyer), or these are receipts typed more than once. Proposal: the Sell Stove form and the phone app refuse; digitisation records the repeat and does not refuse, because the stoves on a receipt are already sold. Needs the operator's call before S1 merges.
2. **The title list.** Proposed above, with Mama and Baba kept as names. The list is configuration, so it can change without a release.
3. **What an agent is told about the other sale.** Proposal: its transaction id only, never the other buyer's name or partner.
