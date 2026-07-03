# Payment Models: decoupling from partners

**Audience:** whoever maintains `sales-monitoring-web` (web app + Supabase edge functions).
**Status:** behaviour change requested by product. No destructive schema migration required.
**Date:** 2026-06-28

## Summary of the change

**Before:** a payment model had to be *assigned to a partner* (organization) via the
`organization_payment_models` join table. At point of sale, the user could only pick
from the models assigned to that partner, and `create-sale` **rejected** the sale if
the org wasn't linked to the chosen model.

**After:** **every partner can use every active payment model.** Payment models are no
longer assigned to partners. At point of sale the user selects any active payment model
directly; there is no per-partner filtering and no assignment step.

## Why no schema migration is needed

`payment_models` already exposes an `authenticated_read_active` RLS policy (SELECT),
so any authenticated user can already read all active models. Decoupling is therefore a
**logic change**, not a data-model change.

`organization_payment_models` is **left in place** (non-destructive) but is **no longer
used for gating**. It can be ignored, or dropped later once the web UI stops referencing
it. Do **not** drop it as part of this change if the web "assign model to partner" screen
still reads it — just stop enforcing it.

## Required edge-function change — `create-sale`

In `supabase/functions/create-sale/index.ts`, the installment branch currently verifies
org↔model assignment and rejects otherwise:

```ts
// REMOVE THIS BLOCK — no longer gate by org assignment
const { data: orgModelLink, error: linkError } = await supabase
  .from("organization_payment_models")
  .select("id")
  .eq("organization_id", organizationId)
  .eq("payment_model_id", paymentModelId)
  .maybeSingle();
if (linkError || !orgModelLink) {
  return jsonError("This organization does not have access to the selected payment model", 403);
}
```

Keep everything else (fetch the model, check `is_active`, use `fixed_price`, validate
`min_down_payment`). The net effect: any active payment model is accepted for any org.

## Installment request contract — `create-sale`

When creating an installment sale, the request body **must** use these exact field
names. `create-sale` reads only these; any other name (e.g. `downPayment`,
`initialPayment`, `firstPayment`, `downPaymentAmount`, `amountReceived`) is ignored
and the down payment is treated as `0`.

| Field | Type | Required | Notes |
|---|---|---|---|
| `isInstallment` | boolean | yes | Must be `true` to enter the installment path. |
| `paymentModelId` | uuid | yes | Must reference an **active** payment model. |
| `initialPaymentAmount` | number | yes | The down payment. Must be `> 0` and `>= min_down_payment`, and `<= fixed_price`. |
| `initialPaymentMethod` | string | no | Defaults to `"cash"`. |
| `initialPaymentProofImageId` | uuid | no | Empty string is normalized to `null`. |

Notes:
- For installment sales the sale `amount` is taken from the model's `fixed_price`;
  the client-supplied `amount` is ignored.
- A missing/zero/non-numeric `initialPaymentAmount` returns
  `"A down payment (initialPaymentAmount) is required for installment sales"` (400),
  **not** the minimum-down-payment message.

## Required web UI changes (informational)

- **Point of sale:** list **all active** payment models (`GET payment-models`) instead of
  `organization-payment-models/{orgId}`. Remove the per-partner filtering.
- **Admin "assign payment model to partner" screen:** no longer required for sales to work.
  Can be hidden/removed at the team's discretion. Sales no longer depend on it.

## Mobile app behaviour (already implemented)

The mobile app reads payment models from the global `payment-models` endpoint and lets the
seller pick any active model at point of sale — no org filtering. See
`lib/features/sales/...` and `docs/memory.md`.

## Rollback

Re-introduce the `organization_payment_models` check block in `create-sale` and restore the
org-filtered selection in the UI. No data was destroyed.
