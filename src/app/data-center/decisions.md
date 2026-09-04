# Data Center decisions

The why behind the choices that are not obvious from the code. Numbering
continues from the table in PLAN.md (D1 to D16 there).

## D17. Align the sales app's status rule (2026-09-04, awaiting the owner's word)

Three implementations of `sales.status` exist: two SQL functions named
`calculate_sale_status` (the record-typed one wins, applied last by
`trigger_update_sale_status`) and `resolveSaleStatus` in `_shared/saleStatus.ts`.
The SQL ones require a stove image and an agreement image the Sell Stove form
made optional, so all 2,205 live sales read `incomplete`. The recommendation is
one SQL function mirroring the TypeScript rule, one trigger, a recompute. The
Flutter app prints the word raw, so the owner decides.

## D18. Complete for a digitised paper receipt (2026-09-04)

`completeness_required_fields` names `signature`. Paper receipts are imported
with `import.require_paper_agreement` and carry no drawn signature, so the
module's own rule called 2,151 of them incomplete. Evidence becomes
configurable: a drawn signature or a commit through a receipt batch that
asserted the paper agreement.

## D19. Where the transfer's sales model lives (2026-09-04, awaiting the owner's word)

`stove_transfer_history` has no model column. `external-csv-sync` reads the
ERP's Order Sales Model, mirrors it onto `organization_payment_models`, and
drops it. The fact should live on the transfer row, written by the sync, as
three additive nullable columns. This is the one `ALTER TABLE` in `public` in
the programme; it is the host's table and the host's sync, so it is a host-lane
change.

## D20. Reps with no account (2026-09-04)

The send-back stays routed to the standing recipients and any data manager,
who fix it on the rep's behalf; the episode records `fixed_on_behalf`. A
`delegate_user_id` on `sales_rep_accounts` lets an administrator name a
delegate. Creating accounts is outside the module.

## D21. Recall is derived, and the saved phone is the truth after a fix (2026-09-04)

A record whose fix the call centre closed with "ring again" needs calls
again, and it had usually used up its three. No flag is set: the episode
snapshots `attempts_at_close`, and `v_callable_records` tests
`attempt_count - attempts_at_close` against the same `callback_limit`. The
engine reads the view and needs no change, and a second close gives a
second allowance without anything to reset.

The call centre's `corrected_phone` was a note of what the buyer said before
Sales saved anything. Once Sales has saved the same number (same last ten
digits, however typed) the note is cleared on close, so the queue dials one
number. When the two differ nothing happens on its own: the review panel
shows both and the reviewer chooses. The record is never edited by the
module; `public.sales.phone` stays where the sales app put it.

## Observations recorded, not acted on

- 181 live sales carry a payment model outside their partner's entitlement.
- The host form keeps its own hard-coded previous-stove list.
- The sales app's own audit (`create_sales_history()`) tracks nine columns,
  none of them the phone, and writes nothing when no session user is set,
  which is the case for every edit `update-sale` makes under its service
  client. So the host's history does not see the module's fixes. The
  episode's `before` and `after` snapshots are the audit of a correction;
  the review panel shows the host's rows as a supplement and says so.
