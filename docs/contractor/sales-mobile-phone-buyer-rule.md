# Sales app (mobile): the phone number and buyer rule

For Brain-codes. Canonical copy: `docs/contractor/sales-mobile-phone-buyer-rule.md` in the sales-web repo; the plan behind it is `docs/plans/phone-and-buyer-rule.md`. Written 2026-10-14. The server side ships first; we will confirm the date it is live before you start.

## Why this exists

Today a phone number can only be on one sale. The app enforces this offline, against the cached list from `get-end-user-phones`, and `create-sale` refuses a reused number with a 409.

ACSL has changed the rule:

1. **Same phone, different buyer name: allowed, and noted.** A family often shares one phone, so two stoves on one number is normal. The sale saves, and the person entering it is told the number is already on another sale.
2. **Same phone, same buyer name: refused.** That is the same customer entered twice.

The rule applies across every partner. The web form, the server and the phone app must agree on what "same name" means, so it is defined once below with test vectors.

## What the server guarantees

- **Today's app keeps working, unchanged.** It stays stricter than the new rule (it blocks every reused number), which is safe.
- **`create-sale` refuses same buyer and phone** with HTTP 409 and a body of the form `{ success: false, error: "<message>", code: "SAME_BUYER_SAME_PHONE", transactionId: "<the other sale>" }`. The message will not contain the words "transaction id" and "already exists" together, so `_alreadyCreated` in `lib/core/services/sync_service.dart` will not mistake it for "already saved".
- **`create-sale` accepts a shared number** and returns `shares_phone_with: [{ sale_id, transaction_id, same_buyer }]` in its success body. From the phone app `same_buyer` is always false, because a same-buyer sale is refused.
- **`update-sale` applies the same rule** when the phone or the name changes, and never matches a sale against itself.
- **`GET get-end-user-phones` gains two fields** beside the list it returns today: `buyerKeys` (an array of 16-character keys, one per buyer and phone on file) and `buyerKeyRules` (`{ version, titles }`). Nothing else in the response changes, and an app that ignores the new fields sees exactly what it sees now.

## The buyer key

The app never receives customer names. It receives keys, computes the same key for the sale on screen, and compares.

- **Phone tail.** Exactly `PhoneUtils.normalizePhone` today: digits only, fewer than 10 means none, otherwise the last 10.
- **Name source.** First name and surname joined with a space when either is filled, otherwise the joined name (`endUserName`).
- **Name key.**
  1. Remove text in square or round brackets, brackets included.
  2. Lower-case A to Z only (ASCII).
  3. Turn whitespace, commas and slashes into one space.
  4. Delete every other character that is not a to z or a space.
  5. Split on spaces, drop empty words and any word in `buyerKeyRules.titles`, sort the words, join with one space.
- **Buyer key.** The first 16 hex characters (lower case) of SHA-256 over the UTF-8 text `<tail>|<name key>`. In Dart, `package:crypto` `sha256.convert(utf8.encode(...))`.
- **No key** when the tail or the name key is empty. Then only the shared-number note can apply.
- **Titles come from the server**, never from the app's code. Before the first successful fetch, use an empty list: the server remains the final check, and a mismatch only ever falls to the safe side (the sale saves and is noted).

### Test vectors

Your implementation must reproduce every row, with the title list `mr mrs miss ms dr alhaji alhaja hajia hajiya malam mallam chief madam`. The same rows are in `supabase/functions/_shared/buyer-key-vectors.json` in the sales-web repo, for a Dart test to read directly.

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

## What changes on the phone app, in order

Each step can ship on its own; none of them breaks the one before. Steps 1 and 3 need nothing from the server and can start now; the rest need the server change, which goes live first.

1. **Carry the error code.** `lib/core/services/supabase_service.dart` (around lines 141 to 150) keeps only the message and the status code from an error body. Keep `code` and `transactionId` too, so the app decides on `code`, not on wording.
2. **Cache the keys and the rules.** In `_refreshEndUserPhones` (`lib/core/services/data_refresh_service.dart`, around 422 to 450), read `buyerKeys` and `buyerKeyRules` when present and store them beside the phone list in `LocalCacheService`, under keys of their own. Keep the existing `truncated` handling for both.
3. **The key function and its test.** One function, for example `PhoneUtils.buyerKey(phone, firstName, surname, joinedName, titles)`, plus a unit test over the vectors file.
4. **The live check.** `checkEndUserPhoneDuplicate` in `lib/features/sales/create/create_sale_controller.dart` (around 172 to 197) runs when the phone changes; it must also run when the first name or surname changes. Then:
   - **Buyer key found** in the cache or the pending queue: an error that blocks, exactly as today's duplicate error does through `validateAll()`. Suggested text: "This customer is already registered with this phone number. The same person cannot be entered twice."
   - **Only the phone tail found:** a note, not an error. Shown under the field, not added to `validateAll()`. Suggested text: "This phone number is already on another sale. You can still save; the shared number will be noted."
   - **Neither:** nothing, as today.
5. **The pending queue.** `getPendingEndUserPhones()` (`lib/core/services/offline_queue_service.dart`, around 231 to 246) returns the phones of unsynced sales. Add the buyer keys of unsynced sales too, computed from each queued payload's `phone`, `endUserFirstName`, `endUserSurname` and `endUserName`, so two offline sales of the same buyer are caught on the device.
6. **After a save.** Where the online create adds the phone to the cache (create controller, around 2238 to 2241), add the buyer key as well.
7. **Editing.** Alongside `_editingOriginalPhoneKey`, keep the sale's original buyer key, so an edit that changes neither the phone nor the name never matches itself.
8. **One confirmation before the preview** when the note applies. The submit path already shows `_SaleValidationSheet` and then `_SalePreviewSheet` (`create_sale_screen.dart`, around 316 to 329). A short sheet or dialog between the two, in the manner of `_confirmExit`, lets the agent check the number once more before continuing.
9. **Sync.** In `sync_service.dart`, a 409 with `code == "SAME_BUYER_SAME_PHONE"` is a real failure: record it with `markError` and a readable message, so the pending card offers edit. It is never treated as "already created".

Optional: when a success body carries `shares_phone_with`, the success toast can say the number is shared.

### Sync and speed, in the same release

10. **Fetch the list only when it changed.** `get-end-user-phones` will send an `ETag`. Send it back as `If-None-Match`; a `304` means keep the cache. Today the full list is downloaded on every refresh.
11. **Check the queue when the list arrives.** After a refresh, run the buyer-key check over every unsynced sale. A queued sale that now matches a buyer on file is marked on its card with the same message the server would send, before any sync attempt, so the agent learns while still near the customer and no photos are uploaded for a sale that will be refused.
12. **A refused sale stops retrying until it is edited.** A 409 with `code == "SAME_BUYER_SAME_PHONE"` (or any 4xx other than "already saved") will never succeed on retry. Mark it, skip it in later "sync all" runs, and retry only after the agent edits it. Network errors and 5xx keep retrying as today.
13. **Keep uploaded photo ids.** Today a queued sale whose photos uploaded but whose sale was then refused uploads the photos again on every retry. Store the returned ids on the queue row after each successful upload and reuse them.
14. **Time limits on sync calls.** `upload-image` and `create-sale` inside `syncPendingSales` have no timeout, so one hung request holds the whole batch. Use the same pattern as the online create (`.timeout(...)`, around 45 s for an upload, 30 s for the sale); a timeout is a network failure and the batch moves on.

A batch already carries on past a refused sale today (each queued sale is in its own `try`), and that must stay true.

### What the agent reads today, before your release

Until 1.0.19 ships, a refused sale shows the server's message on its pending card exactly as sent. It reads: "Not saved: this customer is already registered with this phone number on sale TR-XXXXXX. The same customer cannot be recorded twice. Check the name and phone number; if they are correct, this sale is already recorded and can be deleted from the phone." The server also now recognises a retry of a sale that already saved, so a lost reply no longer strands a sale.

## How to check it

- The Dart unit test passes every vector.
- Against the preview we name for you, with two test partners:
  - same phone, different name, on another partner: the note shows; the sale saves online and offline.
  - same name and phone, written differently (`+234` against `080`, names swapped, "Mrs" added): blocked on the device, online and offline.
  - two offline sales of the same buyer: the second is blocked before it is queued.
  - edit a sale without changing phone or name: saves.
  - a sale queued offline that the server refuses with `SAME_BUYER_SAME_PHONE`: the card shows the message and offers edit.
- Today's build against the new server: unchanged.

## What we would like back

- The PR link and the APK version that carries it.
- The unit test output.
- Screenshots of the note, the blocking error, and a refused queued sale on its pending card.
