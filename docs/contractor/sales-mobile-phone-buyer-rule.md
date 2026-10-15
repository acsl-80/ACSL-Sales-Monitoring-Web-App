# Sales app (mobile): the phone number and buyer rule

For Brain-codes, release 1.0.19. Canonical copy: `docs/contractor/sales-mobile-phone-buyer-rule.md` in the sales-web repo. The plan behind it is `docs/plans/phone-and-buyer-rule.md` in the same repo.

- **Written:** 2026-10-14, revised 2026-10-15 after an independent review against the app's code.
- **Checked against:** sales-mobile `main` at `ff16cf6` (1.0.18+10018), the newest code on both `acsl-80` and `Brain-codes`. Every line number below is from that commit.
- **Attached:** `buyer-key-vectors.json` (the test cases for section 3).
- **Server status:** built and tested, not live yet. We will send you the date it goes live and a test environment to build against. Please do not release 1.0.19 before we confirm the server is live (section 8).

---

## 1. The change in one page

**The old rule:** one phone number, one sale.

**The new rule:**

| Case | What happens | Why |
|---|---|---|
| Same phone, **different** customer name | **Allowed.** The sale saves, and the agent is told the number is already in use. | A family often shares one phone. |
| Same phone, **same** customer name | **Refused.** | It is the same customer entered twice. |
| Same name, different phone | Allowed, as today. | A name alone never refuses a sale. |

"Same name" is decided by one rule, the **buyer key** (section 3). It ignores word order, capital letters, spaces, punctuation, titles such as Mrs or Alhaji, and a nickname in brackets. The server, the web app and the phone app must compute it the same way. The attached test cases prove it.

**What the agent sees after 1.0.19:**

- **A number already in use:** a yellow note under the phone field. The sale can be saved, after one confirmation.
- **The same customer:** a red error under the phone field. The sale cannot be submitted.
- **A queued sale the server refuses:** the card says why in plain words and offers Edit. It is no longer retried by "sync all" until it is edited.

**What stays the same:**

- Everything else on the form.
- The transaction id logic.
- How a sale that already saved is recognised.
- The batch sync carrying on past a failed sale.

**One thing to keep in mind throughout:** the device knows only part of the picture. The server is the final check. So the device may warn, but it never decides that a sale already sent is refused. Only the server's reply decides that.

---

## 2. What the server sends (the contract)

Nothing here removes or renames a field. An app that ignores the new fields keeps working, so 1.0.18 is unaffected (section 8).

### 2.1 `GET get-end-user-phones`

```json
{
  "success": true,
  "data": ["7031234567", "8031234567"],
  "count": 2,
  "scanned": 2,
  "truncated": false,
  "buyerKeys": ["144af3b241a14237", "a98b6aac661bef64"],
  "buyerKeyRules": {
    "version": "2026-10-14.1",
    "titles": ["mr", "mrs", "miss", "ms", "dr", "alhaji", "alhaja", "hajia", "hajiya", "malam", "mallam", "chief", "madam"]
  }
}
```

- **`data`** is unchanged: every number on file as its last 10 digits.
  - It includes cancelled sales, as today.
  - It is now sorted, but treat it as a set, as `LocalCacheService.saveEndUserPhones` already does.
- **`buyerKeys`** (new) holds 16-character keys, one per customer and number. There are never any names.
  - They cover the live (not cancelled) sales **the signed-in account can see in its own sales list**:
    - a partner agent: their own sales;
    - a partner: their partner's sales;
    - an ACSL agent or manager: the partners they cover;
    - a super admin: all.
  - A repeat of a customer the account cannot see is not in the list. The server refuses it when the sale is sent (2.2), and the agent sees why.
- **`buyerKeyRules`** (new) is the title list the key drops, plus its version. It can change without an app release.
- **`buyerKeys` and `buyerKeyRules` come together or not at all.** They are absent only when the server could not build them. Then keep what is cached, and don't wipe it.
- **`ETag` header** (new). Send it back on the next refresh as `If-None-Match`. When nothing changed, the answer is **`304` with no body**: keep the cache.
  - The tag may arrive weak, as `W/"9a107dfa8625a259"`. Store the header value exactly as received and send it back exactly as stored.
- **`truncated: true`** means the list is partial. Keep today's handling: ignore that download and keep the cache. This applies to the keys too, and the ETag of a truncated reply is never stored.

### 2.2 `POST create-sale`

The request body is unchanged.

**Saved, number in use elsewhere** (HTTP 200). The usual body, plus:

```json
"shares_phone_with": [
  { "sale_id": "…", "transaction_id": "TR-8C94F1", "same_buyer": false }
]
```

- Present only when the number is on other live sales the account can see.
- It can list several sales, and `transaction_id` can be `null`.
- From the phone app, `same_buyer` is always `false`, because the same customer is refused.

**Refused, same customer** (HTTP 409):

```json
{
  "success": false,
  "code": "SAME_BUYER_SAME_PHONE",
  "transactionId": "TR-8C94F1",
  "message": "Not saved: this customer (same name and phone number) is already registered on sale TR-8C94F1. The same customer cannot be recorded twice. Check the name and phone number. If they are correct, this sale is a duplicate and does not need to be saved."
}
```

- When the other sale is not one the account can see, `transactionId` is `null` and the message says "another sale" in place of the transaction id.
- The message never contains "transaction id", so `_alreadyCreated` cannot mistake it for an already-saved sale. Decide on `code`, not on the words.

**Already saved** (HTTP 409, unchanged). A retry of a sale that did save gets the same refusal as today: `A sale with transaction ID "TR-8C94F1" already exists`. `_alreadyCreated` reads it as saved.

- **Changed on the server, nothing for you to do:** this check now runs first. Before, a retried sale that had saved could be refused as a duplicate phone and stay queued forever.

Every other refusal (stove taken, missing field, and so on) is unchanged.

### 2.3 `POST update-sale?id=…`

- **When it checks:** only when the phone or the customer's name changes. A sale is never compared with itself.
- **The refusal:** a 409 with `code: "SAME_BUYER_SAME_PHONE"`. The wording is slightly shorter than create-sale's.
- **What it never sends:** `shares_phone_with`.
- **Naming the other sale:** it names it for a super admin, and for anyone but a partner agent when the other sale belongs to the same partner. Otherwise it says "another sale".

### 2.4 Nothing to send for "noted"

The server records shared numbers for the call centre itself. The app sends nothing extra.

---

## 3. The buyer key

The app never receives names. It computes the key for the sale on screen and looks it up in `buyerKeys`.

**Add the dependency:** `crypto: ^3.0.3` in `pubspec.yaml`. Today it is only a transitive dependency (`pubspec.lock:220`).

**The function.** This is the server's logic (`supabase/functions/_shared/buyerKey.ts`) written in Dart. Dart's regular expressions follow the same rules for `\s` and `\D`, so this is exact:

```dart
import 'dart:convert';
import 'package:crypto/crypto.dart';

String phoneTail(String? phone) {            // = PhoneUtils.normalizePhone today
  final digits = (phone ?? '').replaceAll(RegExp(r'\D'), '');
  return digits.length < 10 ? '' : digits.substring(digits.length - 10);
}

String nameKey(String? first, String? surname, String? joined, List<String> titles) {
  final parts = [first, surname].map((s) => (s ?? '').trim()).where((s) => s.isNotEmpty).toList();
  var s = parts.isNotEmpty ? parts.join(' ') : (joined ?? '');
  s = s.replaceAll(RegExp(r'\[[^\]]*\]|\([^)]*\)'), ' ');   // brackets become a space
  s = s.replaceAllMapped(RegExp(r'[A-Z]'), (m) => m[0]!.toLowerCase());
  s = s.replaceAll(RegExp(r'[\s,/]+'), ' ');
  s = s.replaceAll(RegExp(r'[^a-z ]'), '');
  final words = s.split(' ').where((w) => w.isNotEmpty && !titles.contains(w)).toList()..sort();
  return words.join(' ');
}

String buyerKey(String? phone, String? first, String? surname, String? joined, List<String> titles) {
  final tail = phoneTail(phone);
  final name = nameKey(first, surname, joined, titles);
  if (tail.isEmpty || name.isEmpty) return '';  // no key: only the note can apply
  return sha256.convert(utf8.encode('$tail|$name')).toString().substring(0, 16);
}
```

**In words:**

- **Which name.** Trim the first name and the surname. If either is still filled, use them, joined with one space. Otherwise use the joined name (`endUserName`). The alias (`aka`) is never used.
- **Brackets.** Text in square or round brackets is replaced by a space, brackets included. An unmatched bracket is left in place and then deleted as punctuation.
- **Letters.** Only A to Z are lower-cased, in ASCII. Everything that is not `a` to `z` or a space is deleted.
- **Words.** Titles from the served list are dropped. Repeated words are kept. The remaining words are sorted alphabetically.

**Titles come from the server, never from the app's code.** Before the first successful fetch, use an empty list.

**Never store a computed key on a queue row.** Compute it when it is needed, with the current titles. A change to the title list then needs no migration.

### Test vectors

The attached `buyer-key-vectors.json` is the authority: 18 cases, read it directly in the Dart test. The table is for reading. In row 3, the spaces inside the names matter, and the JSON has them exactly.

| First name | Surname | Joined name | Phone | Tail | Name key | Buyer key |
|---|---|---|---|---|---|---|
| Aisha | Bello | | 08031234567 | 8031234567 | aisha bello | a98b6aac661bef64 |
| BELLO | aisha | | +2348031234567 | 8031234567 | aisha bello | a98b6aac661bef64 |
| "  Aisha " | " Bello" | | 234 803 123 4567 | 8031234567 | aisha bello | a98b6aac661bef64 |
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
| Bello[Mama]Ade | | | 08031234567 | 8031234567 | ade bello | 3adb0b2d704ecd20 |
| "   " (spaces only) | | Aisha Bello | 08031234567 | 8031234567 | aisha bello | a98b6aac661bef64 |
| Aisha Aisha | Bello | | 08031234567 | 8031234567 | aisha aisha bello | c15d8f837d1d7e2c |

---

## 4. Every surface in the app, before and after

| # | Surface | Today (1.0.18) | After (1.0.19) |
|---|---|---|---|
| A | Network layer: an error reply | Keeps only `message` and the status; the body is dropped | Also keeps `errorCode` and `errorTransactionId` |
| B | Phone list refresh | Full download every time; only `data` is read | Sends `If-None-Match`; also stores `buyerKeys`, `buyerKeyRules` and the ETag |
| C | A different user signs in | Storage is erased (`wipeAllData`), but the in-memory phone set survives | Phones, keys, rules and ETag are all cleared, in memory too |
| D | Sell form, live check | Phone only; re-runs only when the phone changes | Phone and name; re-runs when the phone, first name or surname changes |
| E | Sell form, number in use | Red error, cannot submit | Yellow note, can submit after one confirmation |
| F | Sell form, same customer | Red error, as a duplicate phone | Red error with the new wording, cannot submit |
| G | Offline: two queued sales on one number | Second is blocked | Blocked only when it is the same customer; two family members both queue |
| H | Online submit refused (409, same customer) | Server message in a 4-second toast | Error under the phone field, plus a dialog that stays until closed |
| I | Online submit saved, number in use | The usual success toast | The same toast, adding which sale shares the number (S1) |
| J | After an online save | Phone added to the cache | Phone and buyer key added |
| K | Sync: a queued sale refused | Card shows the error; retried on every sync; photos re-uploaded each time | Card shows the reason and Edit; skipped by "sync all" until edited; photo ids reused |
| L | Sync: a queued sale saved | Marked `synced = 1`; the phone is not added to the cache | Phone and buyer key added to the cache |
| M | Sync: a hung request | No timeout; it can hold the batch | Timeouts; the batch moves on |
| N | After a list refresh | Nothing | Queued sales that match a known customer get a warning on their card |
| O | Edit a synced sale (online) | Phone-only check; server message in a toast | Phone and name check; never matches itself; error under the field |
| P | Edit a queued sale | Phone-only check | Phone and name check; never matches itself or its own row |
| Q | Offline cache debug screen | Phone count | Also the key count and the rules version |
| R | `docs/memory.md` | Describes one number, one sale | Describes this rule |

These are all the places that create, edit or send a sale. `create-sale` and `update-sale` have no other callers in the app. There is no bulk import and no other screen that writes a sale.

---

## 5. The changes, file by file

Each step is small. They can land in separate commits, and none breaks the one before. Steps 1, 3 and 14 to 16 need nothing from the server and can start now.

### Step 1. Keep the error code (surface A)

`lib/core/services/supabase_service.dart:139-150` parses an error body for `message` only, and returns `SupabaseApiResponse.error(errorMsg, code: response.statusCode)`. The rest of the body is lost (`lib/core/model/supabase_api_response.dart:51-58`).

- Add two fields to `SupabaseApiResponse`: `errorCode` (the body's `code`) and `errorTransactionId` (the body's `transactionId`). Fill them in that same `catch` block.
- No caller changes behaviour from this step alone.

**Done when:** a 409 from `create-sale` gives the caller `errorCode == "SAME_BUYER_SAME_PHONE"`.

### Step 2. Cache the keys, the rules and the ETag (surfaces B, C and Q)

**`lib/core/services/data_refresh_service.dart:422-450`, `_refreshEndUserPhones()`**

- Send the stored ETag as `If-None-Match`, with `returnHeaders: true`. The pattern is `lib/core/services/sale_dictionary_service.dart:102-118`.
- Send it **only when the phones and the keys are both in storage**. Otherwise send no ETag, and get the full list.
- On `304`, keep everything and return.
- On `200`:
  - If `truncated` is true, keep today's behaviour: ignore the download, and store nothing, including the ETag.
  - Otherwise, save `data` as today.
  - When `buyerKeys` is present, save it together with `buyerKeyRules`. When it is absent, keep the old pair.
  - Save the `ETag` header exactly as received.

**`lib/core/services/local_cache_service.dart`**

- Add keys beside `cache_end_user_phones` (:20-21). For example: `cache_buyer_keys`, `cache_buyer_key_rules`, `cache_end_user_phones_etag`.
- Add an in-memory set for the keys, like `_phoneSetCache` (:174), with `getBuyerKeys()`, `addBuyerKey(key)` and `getBuyerKeyTitles()`.
- Add `clear()`, which empties every in-memory set.

**`lib/core/services/auth_service.dart`**

- `signOut` (:78-89) keeps the caches on purpose. Leave it.
- In `wipeAllData` (:95-105), which runs when a different user signs in (`login_controller.dart:60`), call `clear()` after `GetStorage().erase()`.
- **This matters now:** the keys depend on who is signed in, and the in-memory set outlives the wipe.

**`lib/features/profile/offline_cache_debug_screen.dart:150`:** beside the phone count, show the key count and `buyerKeyRules.version`.

**Done when:**
- A second refresh with nothing changed is a 304 and downloads nothing.
- Signing in as another user shows that user's keys only.

### Step 3. The key function and its test

- Put the section 3 code in `lib/core/utils/phone_utils.dart`, beside `normalizePhone`.
- Add `test/buyer_key_test.dart`. It reads every case of `buyer-key-vectors.json` (copy it to `test/fixtures/`) and checks `phoneTail`, `nameKey` and `buyerKey`, with the file's `titles`.

**Done when:** all 18 cases pass.

### Step 4. The live check (surfaces D, E and F)

**`lib/features/sales/create/create_sale_controller.dart`**

- **`onEndUserPhoneChanged` (:155-169):** keep the 300 ms debounce and the skip under 6 characters.
- **`onEndUserIdentityChanged` (:118-127):** it only mirrors the contact fields today. Make it also restart the same debounced check, so typing a name re-checks.
- **`checkEndUserPhoneDuplicate` (:172-197):** compute the tail and the buyer key, then:

| Found | Show | Blocks submit? |
|---|---|---|
| The buyer key, in the cached keys **or** the pending keys (step 5) | Red error E1, in `phoneDuplicateError` | Yes: `validateAll()` already reads it at :1899-1904 |
| Only the tail, in the cached phones **or** the pending phones | Yellow note N1, in a new observable `phoneSharedNote` | No: never added to `validateAll()` |
| Neither | Nothing | No |

**When editing (steps 8 and 5):**
- Show nothing while the key equals the original key.
- Skip the note while the tail equals the original tail. The sale's own number is in the cache, so it would otherwise always say "in use".

**`lib/features/sales/create/create_sale_screen.dart:684-694`**

- Under the phone field, show the error as today (`_FieldMessage(isError: true)`).
- Show the note as a warning. `_FieldMessage` has no warning style yet: add one using `AppColors.warning` (`lib/core/constants/app_colors.dart:34`).

**Why the note says "If this is a different person":** the device cannot always know the name on the other sale. `data` includes cancelled sales and the sales of other partners, but the keys do not. So a number in use may still turn out to be the same customer, and the server then refuses it.

**Done when:**
- A known customer's name and number show the red error.
- Changing the first name to another name turns the error into the note, without touching the phone field.

### Step 5. The pending queue (surface G)

`lib/core/services/offline_queue_service.dart:231-246`, `getPendingEndUserPhones()`, returns the phones of unsynced rows.

- Add `getPendingBuyerKeys()`: the same rows, with the key computed (now, with the current titles) from each payload's `phone`, `endUserFirstName`, `endUserSurname` and `endUserName`.
- Give both functions an `excludeId` parameter. When editing a queued sale, pass its id, so its own row is left out of both the phones and the keys.

**Done when:**
- Two offline sales of one customer: the second is blocked before it is queued.
- Two offline sales of different people on one number: both queue.

### Step 6. One confirmation when the number is in use (surface E)

`_handleSubmitRequest` (`create_sale_screen.dart:314-329`) shows **either** the validation sheet (when `validateAll()` returns errors) **or** the preview.

- When there are no errors **and** the note is showing, show a short dialog first, in the manner of `_confirmExit` (:119):
  - Text: N2.
  - Buttons: "Check again" (closes the dialog, back to the form) and "Continue" (opens the preview).

### Step 7. Online submit (surfaces H, I and J)

**`create_sale_controller.dart:2232-2258`** (the call at :2232; success at :2233-2244; failure at :2245-2246)

- **Saved:**
  - Keep adding the phone to the cache, and also add the buyer key (`addBuyerKey`).
  - If `shares_phone_with` names one or more sales (non-null `transaction_id`), extend the success text with S1, listing the named ids. Leave S1 out when none is named.
- **Refused with `errorCode == "SAME_BUYER_SAME_PHONE"`:**
  - Set `phoneDuplicateError` to the server's `message`, so it shows under the field and blocks a resubmit until the phone or name changes.
  - Show the same message in a dialog with an OK button, not the 4-second toast (`_showError`, :2444-2446). The message is long and the agent must read it.
  - Open the dialog with `showDialog` on `rootNavigatorKey.currentContext`, as `_showCameraBlockedDialog` does (:2451-2454). `Get.dialog` has no navigator in this app.
  - **Do not queue the sale.**
  - **If this was a queued sale being edited** (`_editingQueueId` set): leave that queue row as it was, neither deleted nor changed. The agent fixes the name or phone and submits again, or goes back.
- **Any other refusal:** as today.

**`lib/features/sales/create/create_sale_service.dart:107-109`**

- The call has no timeout (`supabase_service.dart:91-103`). Add `.timeout(const Duration(seconds: 30))`.
- A timeout goes to the existing exception path, which queues the sale. That is safe: the server recognises a retry by its transaction id.

### Step 8. Editing (surfaces O and P)

- **The original key:** beside `_editingOriginalPhoneKey` (set at :1006 for a queued sale and :1169 for a synced sale, cleared in `resetForm` at :967), keep `_editingOriginalBuyerKey` and `_editingOriginalTail`. Compute them from the values the form was filled with.
- **The name parts:** `SaleModel` reads `end_user_first_name` and `end_user_surname` (`sale_model.dart:176-179`). Make sure `hydrateFromSale` (:1117) fills both fields from them. Otherwise the original key is computed from the joined name alone.
- **`update-sale` refused** with `errorCode == "SAME_BUYER_SAME_PHONE"` (failure at :2301): handle it as step 7 does. Error under the field, a dialog, nothing saved.

### Step 9. Sync: a refused sale (surface K)

**The queue table (`offline_queue_service.dart:18-34`)**

- Raise `openDatabase` to version 3 (it is 2 at :21).
- Add `refused INTEGER NOT NULL DEFAULT 0`, in `onCreate` and under `oldVersion < 3`.
- Sales queued under 1.0.18 get 0 and sync as normal.

**`lib/core/services/sync_service.dart`**

- **At :125-136**, a 409 with `errorCode == "SAME_BUYER_SAME_PHONE"`:
  - Call `markError(id, message)` with the server's message.
  - Set `refused = 1`.
- **`_alreadyCreated` (:174-178):** add `if (resp.errorCode == "SAME_BUYER_SAME_PHONE") return false;` at the top. The wording already cannot match, so this is a second safeguard.
- **Do not change `getPending()`.** The sales list is built from it (`sales_list_controller.dart:195-198`), so filtering there would hide the refused cards.
- **In `syncPendingSales` (:23):** when `onlyIds == null` ("sync all"), leave out rows with `refused = 1`.
  - "Synchronize this sale" (`sales_list_screen.dart:590`) and multi-select sync (:205) still send a refused row, if the agent asks.
- **`updateQueued` (:98-131):** clears `error`. Make it clear `refused` too, so an edited sale is sent again.
- **Network errors and 5xx keep retrying** as today. Only a definite refusal stops.
- **The counts:** count refused rows apart from `pendingCount` (`offline_queue_service.dart:249-251`), the way `needsResolutionCount` is counted.
- **The toast** at `sync_service.dart:226-231`: say "N not saved (same customer)" for refused rows, not "will retry".
- **The card** (`sales_list_screen.dart:385`, :399-411) and the detail sheet (:501-511):
  - Pass `refused` through `_loadPendingSales` (`sales_list_controller.dart:195`) into the card model.
  - On the card, show R1 (it fits two lines). Keep the server's full message in the detail sheet. Keep the Edit button (:600-608).
- **A refused row still holds its stove and its phone on the device** (`getPendingStoveIds` at :210, `getPendingEndUserPhones`) until it is edited or deleted.
- **The batch must still carry on past a refused sale.** It does today (each row has its own try), and it must stay that way.

### Step 10. Sync: a saved sale (surface L)

When `markSynced` runs (after a 200 or `_alreadyCreated`), add the phone and the buyer key to the cache. Today a synced row (`synced = 1`) drops out of `getPendingEndUserPhones`, and its number looks free until the next full refresh.

### Step 11. Sync: keep uploaded photo ids (surface K)

- `sync_service.dart:65-123` re-uploads every image from base64 on every attempt, and keeps the returned ids only in memory.
- After each successful upload, store the id on the queue row (in the payload as `stoveImageId`, `agreementImageId` or `initialPaymentProofImageId`), and skip that upload next time.
- In `updateQueued`, keep the stored ids unless that photo was replaced in the edit. `_buildPayload` does not carry them.

**Done when:** a refused sale that is sent again uploads nothing.

### Step 12. Sync: time limits (surface M)

The uploads and `create-sale` inside the sync loop have no timeout.

- An upload gets 45 seconds, as the online path already uses (controller :2342).
- The sale gets 30 seconds, as in step 7.
- A timeout counts as a network failure: mark the error, keep the row for the next sync, and move on to the next row.

### Step 13. A warning after a refresh (surface N)

- At the end of a successful `_refreshEndUserPhones` (200, not truncated), compute the key of every unsynced, not-refused row.
- When a key is now in `buyerKeys`, show R2 on that row's card as a **warning only**.
  - **Never set `refused` from this check, and never skip the row in a sync.** The server decides.
  - If the reply to a sale that did save was lost, that sale's own key is now in the list. The server will answer "already exists" and the row clears normally.

### Step 14. Messages in one place

Put the texts of section 6 in one file of constants, so they read the same everywhere.

### Step 15. Tests

Today there is `test/phone_utils_test.dart`, plus an empty `test/widget_test.dart`. Add:

- **`test/buyer_key_test.dart`:** the vectors (step 3).
- **`_alreadyCreated`:**
  - returns `true` for a 409 with `A sale with transaction ID "TR-1" already exists`;
  - returns `false` for a 409 with `errorCode: "SAME_BUYER_SAME_PHONE"` and its message;
  - returns `false` for any other 409, and for a 500.
- **The error parsing (step 1):** `errorCode` and `errorTransactionId` survive.
- **The live check (step 4):** each row of its table, with a fake cache, plus the two editing cases.
- **Pending keys (step 5):** two rows of one customer; two rows of a family; the edited row left out.
- **The queue migration (step 9):** a version 2 database opens as version 3, with its rows intact and `refused = 0`.

### Step 16. `docs/memory.md:491-542`

Replace the section "End-user phone: unique, offline (Jul 2026)" with this rule, and link to this document.

---

## 6. The messages

Use these words, so every agent reads the same thing.

| Id | Where | Text |
|---|---|---|
| N1 | Note under the phone field | This number is already on another sale. If this is a different person, a family can share one phone and the sale can be saved. |
| N2 | Confirmation before the preview | This phone number is already on another sale. Check it is the right number for this customer, then continue. |
| E1 | Error under the phone field (the device's own check) | This customer (same name and phone number) is already registered. The same customer cannot be recorded twice. |
| E2 | Error and dialog from the server (409 `SAME_BUYER_SAME_PHONE`) | The server's `message`, exactly as sent. |
| S1 | Added to the success text | This number is also on sale TR-X. (List each named id.) |
| R1 | Card of a refused queued sale (two lines) | Not saved: this customer is already registered. Tap to see why, or Edit. |
| R2 | Card warning after a refresh | This customer may already be registered. Check the name and phone before syncing. |
| T1 | Sync toast, refused rows | N not saved (same customer) |

---

## 7. What the agent must never experience

- A sale that sits in the queue and silently retries forever.
- A refusal they cannot read: a toast that vanishes, or a card cut off with no way to see more.
- A sale refused because of a family member's sale.
- A whole batch stopped by one sale.
- Photos uploaded again for a sale that was refused.
- A refused sale disappearing from the list.
- A sale that already saved being marked refused.

---

## 8. Rollout and compatibility

**1.0.18 against the new server keeps working.** Its own check stays stricter than the rule: it blocks every reused number. So until 1.0.19 is installed:

- **A family member's sale on a number already in use cannot be entered in the phone app.** The agent uses the web Sell Stove page for those. We tell the field team.
- **A same-customer sale** that reaches the server is refused, with the full message on its card. On 1.0.18 it is retried on every sync, and its photos are re-uploaded each time, until the agent edits or deletes it.

**1.0.19 against the old server, before ours is live:**

- The new fields are absent and `errorCode` is never set.
- The app behaves like 1.0.18, except that a number in use shows the note instead of the error. The old server then refuses it with "This end user phone is already used on sale TR-X. Each sale must have a unique end user phone number."
- **So please hold the release until we confirm the server is live.**

**Device edge cases:**

- **First install while offline:** no phones and no keys, so there is no check on the device. The server decides at sync, and R1 shows any refusal.
- **Offline for days:** the keys go stale. The server's refusal and R1 cover what the device missed.
- **Sales queued under 1.0.18, then the app updated to 1.0.19:** they sync normally (`refused = 0`), and the step 13 warning applies after the first refresh.

**Release:**

- We publish 1.0.19 through `app_releases` (`manage-app-release`).
- Today the update prompt shows only on pull-to-refresh of the dashboard or profile (`dashboard_screen.dart:79`, `profile_screen.dart:30`), and `checkAndShowUpdatePrompt` (`update_prompt_sheet.dart:69`) is never called.
- **Please call it once on app start when online**, so agents learn of 1.0.19 without hunting for it. We will decide with ACSL whether to set `is_force_update`.

---

## 9. How we check it together

On a real phone, against the test environment we send you, with two test partners:

1. The Dart tests pass, including all 18 vectors.
2. **Same phone, different name, same partner:** the note, the confirmation, and the sale saves with S1 naming the other sale. Do this online and offline (queued, then synced).
3. **Same name and phone, written differently** (`+234` against `080`, names swapped, "Mrs" added): blocked on the device, online and offline.
4. **Two offline sales of one customer:** the second is blocked before it is queued. Two family members on one number: both queue and sync.
5. **The same customer from another partner, online:** the note shows, then the refusal dialog with "another sale". Nothing is queued.
6. **The same customer from another partner, offline:** it queues, then sync shows R1 on the card and the server's message in the detail sheet. "Sync all" skips it afterwards. Edit it to a different name, and it syncs.
7. **A batch of three queued sales with the middle one refused:** the first and third save, and the toast says "1 not saved (same customer)".
8. **A refused sale sent again with "Synchronize this sale":** no photo is uploaded again.
9. **Refresh twice with nothing changed:** the second is a 304. The debug screen shows the key count and the rules version.
10. **Sign in as the other partner on the same phone:** that partner's keys only.
11. **Edit a sale** without changing the phone or name: no note, and it saves. Change the name to match another sale on that number: refused, with the error under the field.
12. **Airplane mode during a sync:** the batch finishes with the rest marked as network errors, and nothing hangs.
13. **A sale whose reply was lost** (turn data off just after tapping submit, then on): it ends up saved once, and is never marked refused.
14. **1.0.18 on the same environment:** unchanged behaviour.

---

## 10. What we would like back

- The PR link and the APK version (1.0.19 and its build number).
- The output of the Dart tests.
- Screenshots of these screens:
  - the note and the confirmation;
  - the red error from the device;
  - the server's refusal dialog online;
  - a refused queued sale on its card and in its detail sheet;
  - the debug screen with the key count.
- A note of anything here that did not match the code you found. Line numbers drift, and we would rather fix this document than have you guess.
