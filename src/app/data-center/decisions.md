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

## Observations recorded, not acted on

- 181 live sales carry a payment model outside their partner's entitlement.
- The host form keeps its own hard-coded previous-stove list.
