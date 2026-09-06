# Sales app (mobile): the sale record, aligned with the User Agreement

Canonical copy: `docs/contractor/sales-mobile-field-alignment.md` in the sales-web repo (the parity brief beside it covers caps and paging). The copy beside the repos is written from this file. Field table generated from `supabase/functions/_shared/sale-dictionary.json` version 2026-09-06.2 on 2026-09-06.

## Why this exists

The paper User Agreement is the standard. The web app, the Data Center and the phone app all read one dictionary of the sale record: the agreement's wording for every field, where it lives, which payload key carries it, its options and the day it becomes mandatory. The web side has finished its half (slices F1 to F4, 2026-09-05 and 2026-09-06). This document is what the phone app needs to do to match, and what the server guarantees while it catches up.

## The one rule that makes this modular

Read the dictionary at run time, do not copy it. `GET /functions/v1/sale-dictionary` with the signed-in user's token answers `{ version, source, groups, fields }`. Each field carries `key`, `label` (the wording to show), `payload` (the key to send), `type`, `group`, `order`, `mandatoryFrom` (a day, or null), `correctable`, and for a choice field `options` as `[{ value, label }]`. Labels, options and dates change without a release: the endpoint's `ETag` moves when they do, so cache the answer and revalidate with `If-None-Match`.

Three things follow from it:

1. **Labels come from `label`.** No field name is typed into the app.
2. **Required follows `mandatoryFrom`.** A field is required on the form when `mandatoryFrom` is on or before the sale's date. A record is judged by the rules of its own day, so an old draft is never refused for a rule that came later.
3. **Choices come from `options`.** Show the `label`, send the `value`. A retired value is not offered, and a record that already holds one keeps it.

## What the server guarantees during the transition

- `create-sale` and `update-sale` accept every payload key in the table below today. Nothing already sent stops working.
- The server does not refuse a sale that lacks a field the rules require; it marks the status incomplete, the way it marks a missing LGA today. The forms are where a record is refused (D31). Until the app ships the new fields, its sales keep saving.
- Free text sent for a choice field is placed on the list where the rules can (market to Purchase it, farm to Collect it, kitchen to Indoor, outdoors to Outdoor, wood stove to Firewood) and kept in a note column where they cannot. Nothing is lost.
- The joined name (`endUserName`) keeps working: the server splits it by rule and says so on the record. Sending the two parts is what stops the guessing.
- The option lists are also callable directly through PostgREST as the RPC `sale_options` (optional argument `p_list`), for an app that caches choices offline.

## The fields

| The agreement's wording | Payload key | Send | Mandatory |
|---|---|---|---|
| Sales date | `salesDate` | YYYY-MM-DD | since the form existed |
| Serial number | (derived, not sent) | text | since the form existed |
| Surname | `endUserSurname` | text | from 2026-09-08 (live date from the endpoint) |
| First name | `endUserFirstName` | text | from 2026-09-08 (live date from the endpoint) |
| Customer name | `endUserName` | text | since the form existed |
| Also known as | `aka` | text | optional |
| Buyer Name | `contactPerson` | text | optional |
| Telephone number | `phone` | a Nigerian number; 080..., +234... and 234... all work | since the form existed |
| Other telephone number | `otherPhone` | a Nigerian number; 080..., +234... and 234... all work | optional |
| Contact phone | `contactPhone` | a Nigerian number; 080..., +234... and 234... all work | optional |
| Address | `addressData.fullAddress` | inside `addressData` | since the form existed |
| City/town/village | `addressData.city` | inside `addressData` | from 2026-09-08 (live date from the endpoint) |
| LGA | `lgaBackup` | text | since the form existed |
| State | `stateBackup` | text | since the form existed |
| Sales agent's name | `salesAgentName` | text | from 2026-09-08 (live date from the endpoint) |
| Sales model | `paymentModelId` | a payment model id from `payment_models` | optional |
| Sales partner | `partnerName` | text | since the form existed |
| Retailer/sales branch/agency | `retailerBranch` | text | optional |
| Pots quantity | `potQuantity` | one of 0, 1, 2; send the `value` | from 2027-01-05 (live date from the endpoint) |
| Wonderbox | `heatRetentionDevice` | true or false | from 2027-01-05 (live date from the endpoint) |
| Payment type | `isInstallment` | true for an installment purchase, false for cash; the sales model goes in `paymentModelId` | optional |
| Total Amount (full stove price) | `amount` | a number, naira | since the form existed |
| Total paid to date | `amountReceived` | a number, naira | optional |
| Amount paid (first installment) | (derived, not sent) | a number, naira | optional |
| Installment term | (derived, not sent) | a whole number | optional |
| Baseline stove | `previousStoveType` | one of the endpoint's `options` values (Firewood, Charcoal, LPG today); send the `value` | from 2026-09-08 (live date from the endpoint) |
| Baseline stove, other | `previousStoveOther` | text | optional |
| Fuel source | `cookingFuelSource` | one of the endpoint's `options` values (Collect it, Purchase it today); send the `value` | from 2027-01-05 (live date from the endpoint) |
| Cooking location | `cookingLocation` | one of the endpoint's `options` values (Indoor, Outdoor, Semi-indoor today); send the `value` | optional |
| Meals per day | `mealsPerDay` | text | optional |
| CPA (Terms and Conditions) | `termsAccepted` | an object of the six consents, each true | from 2026-09-08 (live date from the endpoint) |
| Signature | `signature` | a data URL of the drawn signature, or the upload id | optional |
| Agreement photo | (derived, not sent) | the upload id from the images endpoint | optional |
| Stove photo | (derived, not sent) | the upload id from the images endpoint | optional |

Sent as well, outside the agreement and unchanged: `transactionId`, `organizationId`, `stoveImageId`, `initialPaymentAmount`, `initialPaymentMethod`, `initialPaymentProofImageId`.

## What changes on the phone app, in order

1. **Read the endpoint** at sign-in and on resume; keep the last good answer offline. Render every sale field's label from it.
2. **The name in two fields.** Surname and first name, sent as `endUserSurname` and `endUserFirstName`. Keep sending `endUserName` joined as well until the web side says it can go.
3. **City/town/village** inside `addressData.city`. **Sales agent's name** as `salesAgentName`, defaulting to the signed-in person and editable.
4. **Baseline stove, Fuel source, Cooking location as dropdowns** from `options`. Send the `value`.
5. **Required from `mandatoryFrom`.** Surname, first name, city, sales agent, baseline stove and the six consents from 2026-09-08; pots, Wonderbox and fuel source from 2027-01-05; both dates live on the endpoint and an administrator can move them.
6. **Payment type as its own control** (Cash purchase, Installment purchase) with the sales model for an installment. The payload does not change: `isInstallment` and `paymentModelId`.
7. **Pots quantity** as the dropdown 0, 1, 2. **Wonderbox** is the label. **CPA (Terms and Conditions)** is the heading of the six consents.

## How to check it

- The web repo's `e2e/host-payload-contract.spec.ts` sends every payload key in the table to `create-sale` and reads each back from its column; it also scans this app's Dart sources for every key the rules require today. It goes red the day a required key is missing from the app, so run it against a preview branch before a release.
- `e2e/host-field-dictionary-parity.spec.ts` proves the endpoint serves the wording; the phone app's screens should show the same words.

## What we would like back

A short note per item above: shipped, or what stands in the way. The web side changes nothing about the payload without a version bump on the endpoint and a line here.
