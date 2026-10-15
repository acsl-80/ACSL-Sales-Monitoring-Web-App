# Sales app (mobile): the phone number and buyer rule

For Brain-codes, release 1.0.19. Canonical copy: `docs/contractor/sales-mobile-phone-buyer-rule.md` in the sales-web repo. The plan behind it is `docs/plans/phone-and-buyer-rule.md` in the same repo.

- **Written:** 2026-10-14, revised 2026-10-15.
- **Checked against:** sales-mobile `main` at `ff16cf6`, version 1.0.18+10018, which is the newest code on both `acsl-80` and `Brain-codes`.
- **Server status:** the server side is built and tested but not live. We will send you the date it goes live and a test environment to build against. Every line number below is from `ff16cf6`.

---

## 1. The change in one page

**The old rule:** one phone number, one sale.

**The new rule:**

| Case | What happens | Why |
|---|---|---|
| Same phone, **different** customer name | **Allowed.** The sale saves. The agent is told the number is already on another sale. | A family often shares one phone. |
| Same phone, **same** customer name | **Refused.** | It is the same customer entered twice. |
| Same name, different phone | Allowed, as today. | A name alone never refuses a sale. |

"Same name" is decided by one rule, the **buyer key** (section 3). It ignores word order, capital letters, spaces, punctuation, titles such as Mrs or Alhaji, and a nickname in brackets. The server, the web app and the phone app must all compute it the same way. A test vectors file proves it.

**What the agent sees after 1.0.19:**

- **A shared number:** a yellow note under the phone field, and the sale saves. One confirmation appears before the preview.
- **The same customer:** a red error under the phone field. The sale cannot be submitted, online or offline.
- **A queued sale the server refuses:** the card says why in plain words and offers Edit. It stops retrying until the agent edits it.

**What stays the same:**

- Everything else on the form.
- The transaction id logic.
- How a sale that already saved is recognised.
- The batch sync carrying on past a failed sale.

---

## 2. What the server sends (the contract)

Nothing here removes or renames a field. An app that ignores the new fields keeps working, so 1.0.18 is unaffected (section 8).

### 2.1 `GET get-end-user-phones`

```json
{
  "success": true,
  "data": ["8031234567", "7031234567"],
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

- **`data`** is unchanged: every number on file as its last 10 digits, cancelled sales included. It is now sorted, but treat it as a set, as `LocalCacheService.saveEndUserPhones` already does.
- **`buyerKeys`** (new) holds 16-character keys, one per customer and number. There are never any names.
  - The keys cover the sales **the signed-in account can see**. For a partner agent, that is their own sales.
  - A repeat of a customer the account cannot see is not in the list. The server refuses it when the sale is sent (2.2), and the card shows why.
- **`buyerKeyRules`** (new) is the title list the key drops, plus its version. It can change without an app release.
- **Either new field can be missing** if the server could not build it. Then keep what you have cached, and don't wipe it.
- **`ETag` header** (new). Send it back on the next refresh as `If-None-Match`. If nothing changed, the answer is **`304` with no body**: keep the cache.
  - The tag may arrive weak, as `W/"9a107dfa8625a259"`. Store the header value exactly as received and send it back exactly as stored. The server accepts both forms.
- **`truncated: true`** means the list is partial. Keep today's handling: ignore that download and keep the cache. That applies to the keys too.

### 2.2 `POST create-sale`

The request body is unchanged.

**Saved, number shared** (HTTP 200). The usual body, plus:

```json
"shares_phone_with": [
  { "sale_id": "…", "transaction_id": "TR-8C94F1", "same_buyer": false }
]
```

- Present only when the number is on other live sales that the account can see.
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

- When the other sale is not one the account can see, `transactionId` is `null` and the message says "another sale" instead of the transaction id.
- The message never contains "transaction id", so `_alreadyCreated` cannot mistake it for an already-saved sale. Still, decide on `code`, not on the words.

**Already saved** (HTTP 409, unchanged). A retry of a sale that did save gets the same refusal as today ("A sale with transaction ID ... already exists"), and `_alreadyCreated` reads it as saved.

- **Changed on the server, nothing for you to do:** this check now runs first. Before, a retried sale that had saved could be refused as a duplicate phone and stay queued forever.

Every other refusal (stove taken, missing field, and so on) is unchanged.

### 2.3 `POST update-sale?id=…`

The same rule as `create-sale`, applied only when the phone or the customer's name changes. A sale is never compared with itself. The refusal is the same 409 body with `code: "SAME_BUYER_SAME_PHONE"`, with slightly shorter wording.

### 2.4 Nothing to send for "noted"

The server records shared numbers for the call centre itself. The app does not send anything extra.

---

## 3. The buyer key

The app never receives names. It computes the key for the sale on screen and looks it up in `buyerKeys`.

**Steps**

1. **Phone tail.** Exactly `PhoneUtils.normalizePhone` today (`lib/core/utils/phone_utils.dart:27-32`): digits only; fewer than 10 means no tail; otherwise the last 10.
2. **Name source.** First name and surname joined with one space, when either is filled. Otherwise the joined name (`endUserName`). The alias (`aka`) is never used.
3. **Name key**, in this order:
   1. Remove text in square or round brackets, brackets included.
   2. Lower-case A to Z (ASCII only).
   3. Turn every run of whitespace, commas and slashes into one space.
   4. Delete every character that is not `a` to `z` or a space.
   5. Split on spaces, drop empty words and any word in `buyerKeyRules.titles`, sort the words alphabetically, and join them with one space.
4. **Buyer key.** The first 16 hex characters (lower case) of SHA-256 over the UTF-8 text `<tail>|<name key>`. In Dart: `sha256.convert(utf8.encode('$tail|$nameKey')).toString().substring(0, 16)` with `package:crypto`.
5. **No key** when the tail or the name key is empty. Then only the shared-number note can apply.

**Titles come from the server, never from the app's code.** Before the first successful fetch, use an empty list. The server is the final check, and a mismatch always falls on the safe side.

### Test vectors

Your code must reproduce every row, with the title list `mr mrs miss ms dr alhaji alhaja hajia hajiya malam mallam chief madam`. The same rows are in `supabase/functions/_shared/buyer-key-vectors.json` in the sales-web repo, for a Dart test to read directly.

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

---

## 4. Every surface in the app, before and after

| # | Surface | Today (1.0.18) | After (1.0.19) |
|---|---|---|---|
| A | Network layer: an error reply | Keeps only `message` and the status; the body is dropped | Also keeps `code` and `transactionId` |
| B | Phone list refresh | Full download every time; only `data` is read | Sends `If-None-Match`; also stores `buyerKeys`, `buyerKeyRules` and the ETag |
| C | Cache on logout | Storage is erased, but the in-memory phone set survives | Phones, keys, rules and ETag are all cleared, in memory too |
| D | Sell form, live check | Phone only; re-runs only when the phone changes | Phone and name; re-runs when the phone, first name or surname changes |
| E | Sell form, shared number | Red error, cannot submit | Yellow note, can submit, one confirmation |
| F | Sell form, same customer | Red error (as a duplicate phone) | Red error with the new wording, cannot submit |
| G | Offline: two queued sales of one customer | Caught by phone | Caught by buyer key; two family members on one number are allowed |
| H | Online submit refused (409) | Server message in a 4-second toast | The error under the phone field, plus a dialog that stays until closed |
| I | Online submit saved, number shared | The usual success toast | The same toast, adding which sale shares the number (S1) |
| J | After an online save | Phone added to the cache | Phone and buyer key added |
| K | Sync: a queued sale refused | Card shows the error; retried on every sync, photos re-uploaded each time | Card shows the reason and Edit; not retried until edited; photo ids reused |
| L | Sync: a queued sale saved | Removed from the queue; the phone is not added to the cache | Phone and buyer key added to the cache |
| M | Sync: a hung request | No timeout; it can hold the batch | Timeouts; the batch moves on |
| N | After a list refresh | Nothing | Queued sales are re-checked against the new keys and marked before any upload |
| O | Edit a synced sale (online) | Phone-only check; server message in a toast | Phone and name check; never matches itself; error under the field |
| P | Edit a queued sale | Phone-only check | Phone and name check; never matches itself |
| Q | `docs/memory.md` | Describes one number, one sale | Describes the new rule |

---

## 5. The changes, file by file

Each step is small. They can land in separate commits, and none breaks the one before. Steps 1, 3 and 14 to 16 need nothing from the server and can start now.

### Step 1. Keep the error code (surface A)

`lib/core/services/supabase_service.dart:139-150` parses an error body for `message` and returns `SupabaseApiResponse.error(errorMsg, code: response.statusCode)`; the rest of the body is lost (`lib/core/model/supabase_api_response.dart:51-58`).

- Keep the parsed body on the error response, for example in `data`, or as two new fields `errorCode` and `errorTransactionId`.
- No caller changes behaviour from this step alone.

**Done when:** a 409 from `create-sale` gives the caller `code == "SAME_BUYER_SAME_PHONE"` and `transactionId`.

### Step 2. Cache the keys, the rules and the ETag (surfaces B and C)

**`lib/core/services/data_refresh_service.dart:422-450`, `_refreshEndUserPhones()`**

- Send the stored ETag as `If-None-Match`, with `returnHeaders: true`. This is the same pattern as `lib/core/services/sale_dictionary_service.dart:102-118`.
- On `304`, keep everything and return.
- On `200`:
  - Save `data` as today.
  - Save `buyerKeys` and `buyerKeyRules` when present; when absent, keep the old ones.
  - Save the `ETag` header exactly as received.
- `truncated: true`: keep today's behaviour (ignore the download), for all of it.

**`lib/core/services/local_cache_service.dart`**

- Add keys beside `cache_end_user_phones` (:20-21). For example: `cache_buyer_keys`, `cache_buyer_key_rules`, `cache_end_user_phones_etag`.
- Add a set in memory for the keys, like `_phoneSetCache` (:174), plus `getBuyerKeys()`, `addBuyerKey(key)`, `getBuyerKeyTitles()`.
- Add one `clear()` that empties every in-memory set.

**`lib/core/services/auth_service.dart:102`**

- After `GetStorage().erase()`, call that `clear()`.
- **This matters now:** the keys depend on who is signed in, and today the in-memory phone set outlives a logout.

**Done when:**
- A second refresh with nothing changed gets a 304 and downloads nothing.
- Logging out and in as another user shows that user's keys only.

### Step 3. The key function and its test

- Add one function, for example `PhoneUtils.buyerKey(phone, firstName, surname, joinedName, titles)`, and `PhoneUtils.nameKey(...)`, following section 3.
- Add `test/buyer_key_test.dart`. It reads every row of `buyer-key-vectors.json` (copy the file into `test/fixtures/`) and checks the name key and the buyer key.

**Done when:** every vector passes.

### Step 4. The live check (surfaces D, E and F)

**`lib/features/sales/create/create_sale_controller.dart`**

- **`onEndUserPhoneChanged` (:155-169):** keep the 300 ms debounce and the under-6-characters skip.
- **`onEndUserIdentityChanged` (:118-127):** it only mirrors the contact fields today. Make it also restart the same debounced check, so typing a name re-checks.
- **`checkEndUserPhoneDuplicate` (:172-197):** compute the tail and the buyer key, then pick one of three outcomes.

| Found | Show | Blocks submit? |
|---|---|---|
| Buyer key in the cached keys **or** the pending queue (step 5) | Red error (message E1, section 6) | Yes: keep it in `phoneDuplicateError`, which `validateAll()` reads at :1899-1904 |
| Only the tail, in the cached phones or the pending queue | Yellow note (message N1) in a new observable, for example `phoneSharedNote` | No: never added to `validateAll()` |
| Neither | Nothing | No |

**`lib/features/sales/create/create_sale_screen.dart:684-694`**

- Under the phone field, show the error as today (`_FieldMessage(isError: true)`).
- Show the note with `isError: false`, styled as a warning.

**Done when:**
- Typing a known customer's name and number shows the red error.
- Changing the first name to a different name turns the error into the note, without touching the phone field.

### Step 5. The pending queue (surface G)

`lib/core/services/offline_queue_service.dart:231-246`, `getPendingEndUserPhones()`, returns the phones of unsynced rows.

- Add `getPendingBuyerKeys()`: the same rows, with the key computed from each payload's `phone`, `endUserFirstName`, `endUserSurname` and `endUserName`.
- Use it in step 4 beside the cached keys. When editing a queued sale, leave out that sale's own row.

**Done when:**
- Two offline sales of the same customer: the second is blocked before it is queued.
- Two offline sales of different people on one number: both queue.

### Step 6. One confirmation for a shared number (surface E)

- The submit path shows `_SaleValidationSheet`, then `_SalePreviewSheet` (`create_sale_screen.dart:314-329`).
- When the note applies, show a short dialog between the two, in the manner of `_confirmExit`:
  - Text: message N2.
  - Buttons: "Check again" (back to the form) and "Continue".

### Step 7. Online submit (surfaces H, I and J)

**`create_sale_controller.dart:2233-2258`**

- **Saved (:2233-2244):**
  - Keep adding the phone to the cache.
  - Also add the buyer key (`addBuyerKey`).
  - If the body has `shares_phone_with`, extend the success text: message S1.
- **Refused with `code == "SAME_BUYER_SAME_PHONE"` (:2245-2246):**
  - Set `phoneDuplicateError` to the server's `message`, so it shows under the field and blocks a resubmit until the phone or name changes.
  - Show it in a dialog with an OK button, not the 4-second toast (`_showError`, :2444-2446). The message is long and the agent must read it.
  - **Do not queue the sale.**
- **Any other refusal:** as today.

**`lib/features/sales/create/create_sale_service.dart:107-109`**

- The `create-sale` call has no timeout (`supabase_service.dart:91-103`). Add `.timeout(const Duration(seconds: 30))`.
- A timeout goes to the existing exception path, which queues the sale. That is safe: the server recognises the retry by its transaction id.

### Step 8. Editing (surfaces O and P)

- **The original key:** beside `_editingOriginalPhoneKey` (set at :1006 for a queued sale and :1169 for a synced sale, cleared in `resetForm` at :967), keep `_editingOriginalBuyerKey`, computed from the values the form was filled with. When the current key equals it, show nothing, as the phone check does today at :180.
- **A gap to watch:** `SaleModel.toJson` (`sale_model.dart:273`) writes only `end_user_name`. Make sure a synced sale opened for editing fills the first name and surname from `end_user_first_name` and `end_user_surname` (read at :176-179). Otherwise the original key is computed from the joined name. That still gives the same key, but only if the parts were not dropped along the way.
- **`update-sale` refused** with `code == "SAME_BUYER_SAME_PHONE"` (controller :2301): handle it as step 7 does. Error under the field, a dialog, nothing saved.

### Step 9. Sync: a refused sale (surface K)

**`lib/core/services/sync_service.dart`**

- At :125-136, a 409 with `code == "SAME_BUYER_SAME_PHONE"`:
  - `markError(id, message)` with the server's message.
  - Also mark the row **refused**: a new column `refused INTEGER DEFAULT 0` on `offline_sales` (schema at `offline_queue_service.dart:18-34`; add a migration).
- **`_alreadyCreated` (:174-178):** add `if (resp.code == 409 && resp.errorCode == "SAME_BUYER_SAME_PHONE") return false;` at the top. This is belt and braces; the wording already cannot match.
- **`getPending()`:** skip rows marked refused in "sync all" runs.
- **`updateQueued` (:98-131):** clears `error`; make it clear `refused` too, so an edited sale is sent again.
- **Network errors and 5xx keep retrying** as today. Only a definite refusal stops.
- **The card** (`sales_list_screen.dart:385`, :399-411) and the detail sheet (:501-511):
  - Show the refusal reason. Keep the server message in the detail sheet.
  - On the card, use message R1, which fits two lines.
  - The Edit button (:600-608) stays.
- **The batch must still carry on past a refused sale.** It does today (each row has its own try), and it must stay that way.

### Step 10. Sync: a saved sale (surface L)

When `markSynced` runs (after a 200 or `_alreadyCreated`), add the phone and the buyer key to the cache. Today they drop out of `getPendingEndUserPhones` on sync and look free until the next full refresh.

### Step 11. Sync: keep uploaded photo ids (surface K)

- `sync_service.dart:65-123` re-uploads every image from base64 on every attempt. The returned ids live only in memory.
- After each successful upload, store the id on the queue row (for example in the payload as `stoveImageId` or `agreementImageId`), and skip that upload next time.

**Done when:** a refused sale that is retried uploads nothing the second time.

### Step 12. Sync: time limits (surface M)

The upload calls and `create-sale` inside the sync loop have no timeout. Use 45 seconds for an upload, as the online path already does (controller :2342), and 30 seconds for the sale, as in step 7. A timeout counts as a network failure: mark the error and move on to the next row.

### Step 13. Re-check the queue after a refresh (surface N)

- At the end of a successful `_refreshEndUserPhones` (200, not truncated), run the buyer-key check over every unsynced, not-refused row.
- A row whose key is now in `buyerKeys`:
  - Mark it refused, with message R2.
  - Do this before any upload, so the agent learns while still near the customer and no photos are spent on a sale that will be refused.
- Rows whose number only is shared are left alone.

### Step 14. Messages in one place

Put the texts of section 6 in one file of constants, so they read the same everywhere.

### Step 15. Tests (none exist today beyond `test/phone_utils_test.dart`)

- `test/buyer_key_test.dart`: the vectors (step 3).
- **`_alreadyCreated`** returns `true` for each of these:
  - 409 "Transaction ID TR-1 already exists"
  - and `false` for each of these:
  - 409 with `code: "SAME_BUYER_SAME_PHONE"` and its message
  - 409 with any other message
  - 500
- **The error parsing (step 1):** `code` and `transactionId` survive.
- **The live check (step 4):** each row of its table, with a fake cache.
- **Pending keys (step 5):** two rows of one customer, and two rows of a family.

### Step 16. `docs/memory.md:498-530`

Replace the one-number, one-sale description with this rule, and link to this document.

---

## 6. The messages

Use these words. They match the web app.

| Id | Where | Text |
|---|---|---|
| N1 | Note under the phone field | This number is already on another sale under a different name. A family can share one phone, so this sale can still be saved. |
| N2 | Confirmation before the preview | This phone number is already on another sale. Check it is the customer's own number, then continue. |
| E1 | Error under the phone field (from the device's own check) | This customer (same name and phone number) is already registered. The same customer cannot be recorded twice. |
| E2 | Error and dialog from the server (409 `SAME_BUYER_SAME_PHONE`) | Show the server's `message` as sent. |
| S1 | Added to the success text | This number is also on sale TR-X under a different name. |
| R1 | Card of a refused queued sale (two lines) | Not saved: this customer is already registered. Tap to see why, or Edit. |
| R2 | Card of a queued sale caught after a refresh | Will not save: this customer is already registered. Check the name and phone, or delete this sale. |

---

## 7. What the agent must never experience

- A sale that sits in the queue and silently retries forever.
- A refusal they cannot read: a toast that vanishes, or a card cut off with no detail.
- A sale refused because of a family member's sale.
- A whole batch stopped by one sale.
- Photos uploaded again for a sale that was refused.

---

## 8. Rollout and compatibility

**1.0.18 against the new server keeps working.** Its own offline check stays stricter than the rule: it blocks every reused number. So until 1.0.19 is installed:

- **A family member's sale on a shared number cannot be entered in the phone app.** The agent uses the web Sell Stove page for those. We tell the field team.
- **A same-customer sale** that reaches the server is refused with the full message on its card.

**1.0.19 against the old server, before ours is live:**

- The new fields are absent, so the app keeps its cached keys (none), and `code` is never set.
- The app then behaves exactly like 1.0.18, except that a shared number shows the note instead of the error, and the old server refuses it with "This end user phone is already used on sale TR-X. Each sale must have a unique end user phone number."
- **So please hold the release until we confirm the server is live.**

**Release:**

- We publish 1.0.19 through `app_releases` (`manage-app-release`).
- Today the update prompt shows only on pull-to-refresh of the dashboard or profile (`dashboard_screen.dart:79`, `profile_screen.dart:30`), and `checkAndShowUpdatePrompt` is never called.
- **Please call it once on app start when online**, so agents learn of 1.0.19 without hunting for it. We will decide with ACSL whether to set `is_force_update`.

---

## 9. How we check it together

Against the test environment we send you, with two test partners, on a real phone:

1. The Dart tests pass, including every vector.
2. **Same phone, different name, another partner:** the note, the confirmation, and the sale saves. Do this online and offline (queued, then synced).
3. **Same name and phone, written differently** (`+234` against `080`, names swapped, "Mrs" added): blocked on the device, online and offline.
4. **Two offline sales of one customer:** the second is blocked before it is queued. Two family members on one number: both queue and sync.
5. **The same customer recorded by another partner** (not in this account's keys): queues offline, then sync shows R1 on the card and the server message in the detail sheet. It stops retrying. Edit it to a different name, and it syncs.
6. **A batch of three queued sales with the middle one refused:** the first and third save.
7. **A refused sale retried:** no photo is uploaded again.
8. **Refresh twice with nothing changed:** the second is a 304 (visible in the debug log).
9. **Log out, log in as the other partner:** that partner's keys only.
10. **Edit a sale** without changing the phone or name: saves. Change the name to match another sale on that number: refused, error under the field.
11. **Airplane mode during a sync:** the batch finishes with the rest marked as network errors, and nothing hangs.
12. **1.0.18 on the same environment:** unchanged behaviour.

---

## 10. What we would like back

- The PR link and the APK version (1.0.19 and its build number).
- The output of the Dart tests.
- Screenshots of these screens:
  - the note and the confirmation
  - the red error from the device
  - the server refusal dialog online
  - a refused queued sale on its card and in its detail sheet
- A note of anything here that did not match the code you found. Line numbers drift, and we would rather fix this document than have you guess.
